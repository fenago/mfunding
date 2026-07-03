// llm-admin — super_admin-only management of the pluggable LLM provider layer.
//
// verify_jwt = true. The caller must be a signed-in super_admin (checked against
// public.profiles). Provider API keys are written here but NEVER returned — the
// only readable signal is "is a key set for provider X?" (key_status).
//
// Actions (POST body { action, ... }):
//   { action: "set_key", provider, api_key }  → upsert llm_provider_keys row
//   { action: "key_status" }                  → { <provider>: boolean } (set/unset only)
//   { action: "test" }                        → run callLLM against the ACTIVE config,
//                                               return { ok, latency_ms, sample }  (first 80 chars)
//
// The active provider/model + per-task overrides live in llm_settings and are
// edited directly from the browser via RLS (super_admin R/W) — no action needed
// here for that. This function exists only for the write-only key store and the
// test button.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM, resolveConfig, SUPPORTED_PROVIDERS } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // --- Authn/Authz: super_admin only (this reads/writes provider secrets). ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  if (callerProfile?.role !== "super_admin") {
    return json({ error: "Forbidden — super admin only" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  try {
    // ---- set_key: upsert a provider's API key (write-only) ------------------
    if (action === "set_key") {
      const provider = String(body?.provider ?? "").trim();
      const apiKey = String(body?.api_key ?? "").trim();
      if (!SUPPORTED_PROVIDERS.includes(provider as never)) {
        return json({ error: `Unknown provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}.` }, 400);
      }
      if (!apiKey) return json({ error: "api_key is required" }, 400);
      const { error } = await db
        .from("llm_provider_keys")
        .upsert({ provider, api_key: apiKey, updated_at: new Date().toISOString() }, { onConflict: "provider" });
      if (error) return json({ error: `Could not save key: ${error.message}` }, 500);
      return json({ ok: true, provider });
    }

    // ---- key_status: which providers have a key set (never the values) ------
    if (action === "key_status") {
      const { data, error } = await db.from("llm_provider_keys").select("provider");
      if (error) return json({ error: `Could not read key status: ${error.message}` }, 500);
      const setProviders = new Set((data ?? []).map((r: { provider: string }) => r.provider));
      const status: Record<string, boolean> = {};
      for (const p of SUPPORTED_PROVIDERS) status[p] = setProviders.has(p);
      return json({ ok: true, status });
    }

    // ---- test: prove the active config's key + model actually work ----------
    if (action === "test") {
      const cfg = await resolveConfig(db);
      const started = Date.now();
      try {
        const out = await callLLM(db, {
          system: "You are a connectivity test. Reply with a very short greeting.",
          prompt: "Reply with exactly: OK — connection working.",
          maxTokens: 64,
          temperature: 0,
        });
        const latency_ms = Date.now() - started;
        return json({
          ok: true,
          provider: cfg.provider,
          model: cfg.model,
          latency_ms,
          sample: out.slice(0, 80),
        });
      } catch (e) {
        return json({
          ok: false,
          provider: cfg.provider,
          model: cfg.model,
          latency_ms: Date.now() - started,
          error: String(e instanceof Error ? e.message : e),
        });
      }
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
