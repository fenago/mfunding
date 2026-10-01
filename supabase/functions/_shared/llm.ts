// Pluggable LLM client for Supabase edge functions.
//
// callLLM(db, opts) resolves the active provider/model from the DB (llm_settings,
// with optional per-task overrides), loads that provider's API key from
// llm_provider_keys via the service-role client (keys are NEVER client-readable),
// dispatches to the right protocol adapter, and returns the assistant's text.
//
// Providers (7), grouped by wire protocol:
//   anthropic         → POST https://api.anthropic.com/v1/messages
//   gemini            → POST https://generativelanguage.googleapis.com/v1beta/...
//   openai-compatible → POST {baseUrl}/chat/completions  (Bearer key)
//                        openai | openrouter | deepinfra | nvidia | ollama_cloud
//
// Zero-regression guarantee: if no llm_settings row exists, we fall back to
// anthropic + claude-sonnet-4-6 — the model the platform was hardcoded to before
// this layer existed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6";

// OpenAI-compatible providers and their /chat/completions base URLs.
const OPENAI_COMPATIBLE_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  nvidia: "https://integrate.api.nvidia.com/v1",
  ollama_cloud: "https://ollama.com/v1",
};

export const SUPPORTED_PROVIDERS = ["anthropic", "gemini", ...Object.keys(OPENAI_COMPATIBLE_BASE)] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

export interface CallLLMOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Strip ```json fences from the returned text (the model still returns text). */
  jsonMode?: boolean;
  /** Look up a per-task override in llm_settings.task_overrides before the active config. */
  task?: string;
  /** Sampling temperature. Sent to providers that accept it; omitted when undefined. */
  temperature?: number;
  /** Explicit model override — wins over llm_settings/task resolution for THIS call. */
  model?: string;
  /** Explicit provider override — pairs with `model` when the caller pins both. */
  provider?: string;
}

export interface ResolvedConfig {
  provider: string;
  model: string;
}

/** Read the active provider/model, applying a per-task override when present. */
export async function resolveConfig(db: SupabaseClient, task?: string): Promise<ResolvedConfig> {
  const { data } = await db
    .from("llm_settings")
    .select("provider, model, task_overrides")
    .eq("id", 1)
    .maybeSingle();

  let provider = (data?.provider as string) || DEFAULT_PROVIDER;
  let model = (data?.model as string) || DEFAULT_MODEL;

  if (task && data?.task_overrides && typeof data.task_overrides === "object") {
    const ov = (data.task_overrides as Record<string, { provider?: string; model?: string }>)[task];
    if (ov?.provider) provider = ov.provider;
    if (ov?.model) model = ov.model;
  }
  return { provider, model };
}

export async function getKey(db: SupabaseClient, provider: string): Promise<string> {
  const { data, error } = await db
    .from("llm_provider_keys")
    .select("api_key")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`Could not read key for provider "${provider}": ${error.message}`);
  const key = data?.api_key as string | undefined;
  if (!key) throw new Error(`No API key configured for provider "${provider}". Set it in Admin → Integrations → AI Provider.`);
  return key;
}

// Truncated response body for error messages — enough to diagnose, never a secret.
function bodyPrefix(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

// Newer Anthropic models reject the `temperature` parameter, 400ing with
// "`temperature` is deprecated for this model." We handle this two ways:
//  (a) fast path — skip sending temperature for models we KNOW deprecate it (the
//      Claude 5 tier + Opus 4.8), so the common case never wastes a round trip;
//  (b) self-healing net — anthropicFetch retries once WITHOUT temperature on that
//      exact 400, so any future model that drops the param just works.
function anthropicOmitsTemperature(model: string): boolean {
  return /claude-(?:opus|sonnet|haiku|fable|mythos)-5(?:$|[-_])/i.test(model)
    || /claude-opus-4-8/i.test(model);
}

// ── MODEL CAPABILITY: FORCED TOOL USE ────────────────────────────────────────
// Some newer Claude models REMOVED forced tool use. `tool_choice: {type:"tool"}`
// (or "any") returns a hard 400 on them:
//   `tool_choice: type "tool" and "any" are not supported for this model.`
// VERIFIED 2026-10-01 against the live API: claude-opus-5-5 rejects it, while
// claude-opus-5 and claude-sonnet-5 accept it. Anthropic's own tool-use pricing
// table corroborates — it lists an "any, tool" system-prompt token count for
// Opus 5 (406) and leaves it BLANK for Opus 5.5 and Sonnet 5.5.
//
// This matters because a caller that NEEDS a guaranteed structured reply (the
// underwriter's per-statement extraction) is not merely degraded by such a model —
// every single call 400s. Both model fields are super-admin switchable from the
// UI, so the wrong pick has to fail LOUDLY and name the model, never silently.
//
// Deliberately a PATTERN list, not an exhaustive allowlist: a model id we have
// never seen is treated as CAPABLE (we do not block on ignorance) and the runtime
// net below catches it if the API disagrees. That keeps a future model working
// without an edit here, while the known-bad ones are refused before any spend.
const REJECTS_FORCED_TOOL_USE: RegExp[] = [
  /claude-opus-5-5(?:$|[-_])/i,
  /claude-sonnet-5-5(?:$|[-_])/i,
  /claude-fable-5-1(?:$|[-_])/i,
  /claude-mythos-5-1(?:$|[-_])/i,
  /claude-mythos-preview/i,
];
export function anthropicRejectsForcedToolUse(model: string): boolean {
  return REJECTS_FORCED_TOOL_USE.some((re) => re.test(model));
}

// Does an Anthropic error body say the model refused forced tool use? Used to turn
// a generic "HTTP 400: {...}" into a named, actionable misconfiguration error even
// for a model that is not in the list above (released after this was written).
export function isForcedToolUseRejection(msg: unknown): boolean {
  return /tool_choice[\s\S]{0,80}not supported for this model/i.test(String(msg ?? ""));
}

/** Thrown when a configured model cannot do what its ROLE requires. Never degrade
 *  to another model on this — a verdict from a model the owner did not choose is
 *  the defect, not the fix. */
export class ModelCapabilityError extends Error {
  readonly model: string;
  readonly role: string;
  constructor(model: string, role: string, detail: string) {
    super(
      `Model "${model}" cannot be used for ${role}: ${detail} ` +
      `Change the ${role} model in Admin → Settings (AI models). ` +
      `Nothing was run and nothing was saved — no fallback model was substituted.`,
    );
    this.name = "ModelCapabilityError";
    this.model = model;
    this.role = role;
  }
}

/** Preflight a model against a role's hard requirements. Throws
 *  ModelCapabilityError (loud, names the model) rather than returning a boolean,
 *  so a caller cannot accidentally ignore it. */
export function assertModelCapableFor(
  model: string,
  role: string,
  needs: { forcedToolUse?: boolean },
): void {
  if (needs.forcedToolUse && anthropicRejectsForcedToolUse(model)) {
    throw new ModelCapabilityError(
      model,
      role,
      `it does not support forced tool use (tool_choice "tool"/"any"), which ${role} ` +
      `requires to guarantee every required field comes back.`,
    );
  }
}

// POST to Anthropic, returning the raw response text. On a temperature-deprecated
// 400, strip `temperature` from the body and retry once (body is mutated).
async function anthropicFetch(key: string, body: Record<string, unknown>): Promise<string> {
  const doFetch = () => fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  let res = await doFetch();
  let text = await res.text();
  if (!res.ok && res.status === 400 && "temperature" in body && /temperature[^]*deprecated/i.test(text)) {
    delete body.temperature;
    res = await doFetch();
    text = await res.text();
  }
  // RUNTIME NET for the forced-tool-use capability: a model we have not catalogued
  // may still refuse tool_choice "tool"/"any". A bare `HTTP 400: {...}` reads like a
  // transient provider blip and buries the actual cause (the configured model), so
  // name it. Deliberately NOT retried without tool_choice — dropping the forced call
  // would let required fields go missing and return a normal-looking result, which is
  // precisely the silent degradation this must avoid.
  if (!res.ok && res.status === 400 && isForcedToolUseRejection(text)) {
    throw new ModelCapabilityError(
      String(body.model ?? "unknown"),
      "this task",
      "the Anthropic API rejected forced tool use for it " +
      `(HTTP 400: ${bodyPrefix(text)}).`,
    );
  }
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${bodyPrefix(text)}`);
  return text;
}

// ---- Adapters ---------------------------------------------------------------

async function callAnthropic(key: string, model: string, o: CallLLMOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: o.maxTokens ?? 4096,
    messages: [{ role: "user", content: o.prompt }],
  };
  if (o.system) body.system = o.system;
  if (o.temperature != null && !anthropicOmitsTemperature(model)) body.temperature = o.temperature;

  const text = await anthropicFetch(key, body);
  const jsonRes = JSON.parse(text) as { content?: Array<{ type?: string; text?: string }> };
  return (jsonRes.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b?.text ?? "")
    .join("")
    .trim();
}

async function callGemini(key: string, model: string, o: CallLLMOptions): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      maxOutputTokens: o.maxTokens ?? 4096,
      ...(o.temperature != null ? { temperature: o.temperature } : {}),
    },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${bodyPrefix(text)}`);
  const jsonRes = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (jsonRes.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
}

async function callOpenAICompatible(
  provider: string,
  baseUrl: string,
  key: string,
  model: string,
  o: CallLLMOptions,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (o.system) messages.push({ role: "system", content: o.system });
  messages.push({ role: "user", content: o.prompt });

  const body: Record<string, unknown> = {
    model,
    max_tokens: o.maxTokens ?? 4096,
    messages,
  };
  if (o.temperature != null) body.temperature = o.temperature;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${bodyPrefix(text)}`);
  const jsonRes = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (jsonRes.choices?.[0]?.message?.content ?? "").trim();
}

// ---- Public entry point -----------------------------------------------------

// ---- Anthropic content-block call (native PDF / image document blocks) -------
//
// callLLM only accepts a plain text prompt. The underwriter's extraction pass
// needs to send bank-statement PDFs as native document blocks (the model reads
// the PDF directly). This helper talks straight to Anthropic with an explicit
// model + arbitrary content blocks, loading the anthropic key via the same
// service-role path as callLLM. jsonMode strips ```json fences from the reply.
//
// It intentionally forces provider "anthropic" — PDF document blocks are an
// Anthropic-native feature and the underwriter is spec'd on Claude models.
// deno-lint-ignore no-explicit-any
export type AnthropicContentBlock = Record<string, any>;

export async function callAnthropicBlocks(
  db: SupabaseClient,
  model: string,
  content: AnthropicContentBlock[],
  opts: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    // Force a single structured tool call so required fields can't be omitted.
    // When `tools` is set, the tool_use input is returned as JSON text (so the
    // caller can safeParseJson it exactly like a jsonMode reply).
    tools?: AnthropicContentBlock[];
    toolChoice?: AnthropicContentBlock;
  } = {},
): Promise<string> {
  const key = await getKey(db, "anthropic");
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: "user", content }],
  };
  if (opts.system) body.system = opts.system;
  if (opts.temperature != null && !anthropicOmitsTemperature(model)) body.temperature = opts.temperature;
  if (opts.tools) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;

  const text = await anthropicFetch(key, body);
  const jsonRes = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  };
  // Forced tool use: return the tool input as JSON text.
  if (opts.tools) {
    const toolUse = (jsonRes.content ?? []).find((b) => b?.type === "tool_use");
    if (toolUse && toolUse.input != null) return JSON.stringify(toolUse.input);
  }
  const out = (jsonRes.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b?.text ?? "")
    .join("")
    .trim();
  return opts.jsonMode ? stripFences(out) : out;
}

export async function callLLM(db: SupabaseClient, opts: CallLLMOptions): Promise<string> {
  const resolved = await resolveConfig(db, opts.task);
  // An explicit model/provider on the call wins over llm_settings/task resolution —
  // lets a feature pin its own model (e.g. the owner-switchable underwriter judge).
  const provider = opts.provider ?? resolved.provider;
  const model = opts.model ?? resolved.model;
  const key = await getKey(db, provider);

  let out: string;
  if (provider === "anthropic") {
    out = await callAnthropic(key, model, opts);
  } else if (provider === "gemini") {
    out = await callGemini(key, model, opts);
  } else if (provider in OPENAI_COMPATIBLE_BASE) {
    out = await callOpenAICompatible(provider, OPENAI_COMPATIBLE_BASE[provider], key, model, opts);
  } else {
    throw new Error(`Unknown LLM provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}.`);
  }

  return opts.jsonMode ? stripFences(out) : out;
}
