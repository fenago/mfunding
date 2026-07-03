// AI Provider settings — super_admin only.
//
// The active provider/model + per-task overrides live in the `llm_settings`
// table (RLS: super_admin read/write), edited directly from the browser here.
// Provider API keys are write-only: they go through the `llm-admin` edge function
// (set_key / key_status / test) and are NEVER read back into the browser.

import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

// The 7 switchable providers, in display order, with a suggested default model.
export const LLM_PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-sonnet-4-6" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini" },
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "meta-llama/llama-3.3-70b-instruct" },
  { id: "deepinfra", label: "DeepInfra", defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct" },
  { id: "nvidia", label: "NVIDIA NIM", defaultModel: "meta/llama-3.3-70b-instruct" },
  { id: "ollama_cloud", label: "Ollama Cloud", defaultModel: "gpt-oss:120b" },
] as const;

export type LLMProviderId = (typeof LLM_PROVIDERS)[number]["id"];

// Tasks that can override the active provider/model.
export const LLM_TASKS = [
  { id: "recommend_lenders", label: "Funder recommendations (recommend-lenders)" },
  { id: "classify_reply", label: "Funder reply classification (poll-funder-replies)" },
] as const;

export interface TaskOverride {
  provider?: string;
  model?: string;
}

export interface LLMSettings {
  provider: string;
  model: string;
  task_overrides: Record<string, TaskOverride>;
}

/** Suggested default model for a provider (used to prefill the model input). */
export function defaultModelFor(provider: string): string {
  return LLM_PROVIDERS.find((p) => p.id === provider)?.defaultModel ?? "";
}

/** Load the single active-config row. Falls back to the anthropic default. */
export async function getLLMSettings(): Promise<LLMSettings> {
  const { data, error } = await supabase
    .from("llm_settings")
    .select("provider, model, task_overrides")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    provider: data?.provider ?? "anthropic",
    model: data?.model ?? "claude-sonnet-4-6",
    task_overrides: (data?.task_overrides ?? {}) as Record<string, TaskOverride>,
  };
}

/** Upsert the active-config row (super_admin only via RLS). */
export async function saveLLMSettings(settings: LLMSettings): Promise<void> {
  await mustWrite(
    "save LLM settings",
    supabase.from("llm_settings").upsert(
      {
        id: 1,
        provider: settings.provider,
        model: settings.model,
        task_overrides: settings.task_overrides,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ),
  );
}

/** Which providers have an API key set (booleans only — never the values). */
export async function getKeyStatus(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.functions.invoke("llm-admin", {
    body: { action: "key_status" },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.status ?? {}) as Record<string, boolean>;
}

/** Save (upsert) a provider's API key through the write-only edge function. */
export async function setProviderKey(provider: string, apiKey: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("llm-admin", {
    body: { action: "set_key", provider, api_key: apiKey },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

export interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  sample?: string;
  error?: string;
}

/** Run a trivial prompt against the ACTIVE config to prove key + model work. */
export async function testActiveProvider(): Promise<TestResult> {
  const { data, error } = await supabase.functions.invoke("llm-admin", {
    body: { action: "test" },
  });
  if (error) throw error;
  return data as TestResult;
}
