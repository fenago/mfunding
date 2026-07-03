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

async function getKey(db: SupabaseClient, provider: string): Promise<string> {
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

// ---- Adapters ---------------------------------------------------------------

async function callAnthropic(key: string, model: string, o: CallLLMOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: o.maxTokens ?? 4096,
    messages: [{ role: "user", content: o.prompt }],
  };
  if (o.system) body.system = o.system;
  if (o.temperature != null) body.temperature = o.temperature;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${bodyPrefix(text)}`);
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

export async function callLLM(db: SupabaseClient, opts: CallLLMOptions): Promise<string> {
  const { provider, model } = await resolveConfig(db, opts.task);
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
