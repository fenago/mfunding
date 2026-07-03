-- Pluggable LLM provider layer.
--
-- Two tables let a super_admin switch the platform's AI provider/model without a
-- redeploy, and store each provider's API key server-side only:
--
--   llm_settings       — single active-config row (id fixed at 1). Holds the
--                        active provider + model, plus optional per-task
--                        overrides (e.g. run reply-classification on a cheaper
--                        provider than lender-recommendation). super_admin R/W.
--   llm_provider_keys  — one row per provider holding its API key. RLS is ENABLED
--                        with NO policies, so the key is unreadable from any
--                        browser session; only the service role (edge functions)
--                        and Postgres owner can touch it.
--
-- The anthropic key is NOT seeded here (a migration file must never contain a
-- literal secret) — it is seeded by direct SQL from the local .env after this
-- migration applies. See llm-admin's set_key action for rotating keys later.
--
-- Zero-regression: callLLM() (supabase/functions/_shared/llm.ts) falls back to
-- anthropic + claude-sonnet-4-6 when no llm_settings row exists, so nothing
-- breaks if the seed row is ever removed.

-- ---- Active config (single row) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.llm_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider       TEXT NOT NULL DEFAULT 'anthropic',
  model          TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  -- { "<task>": { "provider": "...", "model": "..." }, ... }
  task_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;

-- super_admin may read AND write the active config. Service role bypasses RLS,
-- so edge functions read it regardless of these policies.
DROP POLICY IF EXISTS "Super admins manage llm_settings" ON public.llm_settings;
CREATE POLICY "Super admins manage llm_settings" ON public.llm_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'));

-- ---- Provider API keys (service-role only, never client-readable) ------------
CREATE TABLE IF NOT EXISTS public.llm_provider_keys (
  provider   TEXT PRIMARY KEY,
  api_key    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS on, ZERO policies: no authenticated/anon session can select, insert, or
-- update. Only the service role (edge functions) and the table owner reach it.
ALTER TABLE public.llm_provider_keys ENABLE ROW LEVEL SECURITY;

-- ---- Keep updated_at fresh ---------------------------------------------------
DROP TRIGGER IF EXISTS llm_settings_updated_at ON public.llm_settings;
CREATE TRIGGER llm_settings_updated_at BEFORE UPDATE ON public.llm_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS llm_provider_keys_updated_at ON public.llm_provider_keys;
CREATE TRIGGER llm_provider_keys_updated_at BEFORE UPDATE ON public.llm_provider_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---- Seed the single active-config row (anthropic + claude-sonnet-4-6) -------
INSERT INTO public.llm_settings (id, provider, model, task_overrides)
VALUES (1, 'anthropic', 'claude-sonnet-4-6', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Belt-and-suspenders: RLS-with-no-policies already denies clients, but drop
-- the default grants too so the keys table is service-role only at every layer.
revoke all on table public.llm_provider_keys from anon, authenticated;
