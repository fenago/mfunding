// Shared Plaid client for Supabase edge functions.
//
// Credentials are NEVER hardcoded. get_plaid_config() (SECURITY DEFINER,
// service-role only) reads PLAID_CLIENT_ID + the per-environment secret from the
// Supabase vault. Plaid authenticates by putting client_id + secret in the REQUEST
// BODY (not headers), so plaidFetch merges them into every call.
//
// ENVIRONMENT: Limited Production uses PRODUCTION keys against production.plaid.com.
// The active environment is a runtime setting (platform_settings.plaid.environment,
// default 'production'); sandbox is switchable for testing. Each stored item records
// the environment it was created under, so pulls always use the right base URL.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PlaidEnv = "sandbox" | "production";

const BASE_URL: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  baseUrl: string;
}

/** Read the active environment from platform_settings (default production). */
export async function resolveEnv(db: SupabaseClient, override?: string | null): Promise<PlaidEnv> {
  if (override === "sandbox" || override === "production") return override;
  const { data } = await db.from("platform_settings").select("value").eq("key", "plaid").maybeSingle();
  const env = (data?.value as { environment?: string } | null)?.environment;
  return env === "sandbox" ? "sandbox" : "production";
}

/** Read Plaid settings (products, statements toggle) from platform_settings. */
export async function getPlaidSettings(
  db: SupabaseClient,
): Promise<{ environment: PlaidEnv; products: string[]; statements_enabled: boolean }> {
  const { data } = await db.from("platform_settings").select("value").eq("key", "plaid").maybeSingle();
  const v = (data?.value ?? {}) as { environment?: string; products?: string[]; statements_enabled?: boolean };
  return {
    environment: v.environment === "sandbox" ? "sandbox" : "production",
    products: Array.isArray(v.products) && v.products.length ? v.products : ["transactions"],
    statements_enabled: v.statements_enabled !== false,
  };
}

/** Load client_id + the correct secret for `env` from the vault. */
export async function getPlaidConfig(db: SupabaseClient, env: PlaidEnv): Promise<PlaidConfig> {
  const { data, error } = await db.rpc("get_plaid_config");
  if (error) throw new Error(`get_plaid_config failed: ${error.message}`);
  const clientId = data?.client_id as string | undefined;
  const secret = (env === "sandbox" ? data?.secret_sandbox : data?.secret_production) as string | undefined;
  if (!clientId || !secret) {
    throw new Error(`Plaid credentials missing from vault (client_id / secret_${env})`);
  }
  return { clientId, secret, env, baseUrl: BASE_URL[env] };
}

export interface PlaidResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  errorType?: string;
  errorCode?: string;
  requestId?: string;
}

/** Keys that must never reach a log line. */
const REDACT = new Set(["secret", "client_id", "access_token", "public_token", "processor_token", "link_token"]);
function redact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) out[k] = REDACT.has(k) ? "[redacted]" : v;
  return out;
}

/** POST to a Plaid endpoint. Merges client_id + secret into the body. Never throws
 * on a non-2xx — surfaces Plaid's error_type/error_code so callers can branch (e.g.
 * OAuth-institution errors get a human "coming soon, use upload" message). */
export async function plaidFetch<T = Record<string, unknown>>(
  cfg: PlaidConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<PlaidResponse<T>> {
  const payload = { client_id: cfg.clientId, secret: cfg.secret, ...body };
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error("[plaid] network error", JSON.stringify({ path, error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }

  if (!res.ok) {
    const err = (parsed ?? {}) as { error_type?: string; error_code?: string; error_message?: string; display_message?: string; request_id?: string };
    console.error("[plaid] REQUEST FAILED", JSON.stringify({
      path, status: res.status, request: redact(body),
      error_type: err.error_type, error_code: err.error_code, error_message: err.error_message,
    }));
    return {
      ok: false, status: res.status, data: null,
      error: err.error_message ?? (typeof parsed === "string" ? parsed : JSON.stringify(parsed)),
      errorType: err.error_type, errorCode: err.error_code, requestId: err.request_id,
    };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// ── Integration health snapshot ───────────────────────────────────────────────
// One shape, two consumers: system-health-check embeds it as its `plaid` section,
// and plaid-institutions (action:'status') serves it to /admin/plaid + the System
// Monitor card. Built here so the two can never drift.
//
// HONESTY: `api_reachable` is a LIVE probe result. Everything under `products` /
// `oauth_*` is a RECORDED dashboard snapshot (platform_settings.plaid_status) — Plaid
// exposes no API for either — so the shape carries `oauth_as_of` + `oauth_source` and
// the UI must label it as such. Key presence is presence ONLY; values never leave here.

export interface PlaidHealth {
  api_reachable: boolean | null; // null = not probed on this call
  env: PlaidEnv;
  products_enabled: string[];
  products: Record<string, { status?: string; date?: string | null }>;
  statements_enabled: boolean;
  connected_items: number;
  oauth_enabled: string[];
  oauth_enabled_count: number;
  oauth_request_needed: string[];
  oauth_as_of: string | null;
  oauth_source: string | null;
  keys_present: { client_id: boolean; secret_production: boolean; secret_sandbox: boolean };
  keys_rotated_at: string | null;
}

interface PlaidStatusRecord {
  products?: Record<string, { status?: string; date?: string | null }>;
  keys_rotated_at?: string | null;
  oauth_institutions?: { enabled?: string[]; request_needed?: string[]; as_of?: string | null; source?: string | null };
}

/** Assemble the Plaid integration health snapshot. Never throws — a failure in any
 * one source degrades that field (false/0/[]) rather than the whole call.
 *
 * `apiReachable`: pass an already-known probe result to avoid a second Plaid call
 * (system-health-check does this); pass undefined to probe here; pass null to skip. */
export async function buildPlaidHealth(
  db: SupabaseClient,
  apiReachable?: boolean | null,
): Promise<PlaidHealth> {
  const settings = await getPlaidSettings(db).catch(() => ({
    environment: "production" as PlaidEnv, products: ["transactions"], statements_enabled: true,
  }));

  const { data: statusRow } = await db.from("platform_settings").select("value").eq("key", "plaid_status").maybeSingle();
  const status = (statusRow?.value ?? {}) as PlaidStatusRecord;
  const products = status.products ?? {};
  const oauth = status.oauth_institutions ?? {};
  const oauthEnabled = Array.isArray(oauth.enabled) ? oauth.enabled : [];
  const oauthNeeded = Array.isArray(oauth.request_needed) ? oauth.request_needed : [];

  const { count } = await db.from("plaid_items").select("id", { count: "exact", head: true });

  // Vault presence only — the RPC returns the real values, which we immediately
  // reduce to booleans and never propagate.
  let keys = { client_id: false, secret_production: false, secret_sandbox: false };
  try {
    const { data } = await db.rpc("get_plaid_config");
    const d = (data ?? {}) as Record<string, unknown>;
    keys = {
      client_id: typeof d.client_id === "string" && d.client_id.length > 0,
      secret_production: typeof d.secret_production === "string" && d.secret_production.length > 0,
      secret_sandbox: typeof d.secret_sandbox === "string" && d.secret_sandbox.length > 0,
    };
  } catch { /* leave all false — the UI renders that as a red "missing" state */ }

  let reachable: boolean | null = apiReachable ?? null;
  if (apiReachable === undefined) {
    try {
      const cfg = await getPlaidConfig(db, settings.environment);
      const res = await plaidFetch(cfg, "/institutions/get", { count: 1, offset: 0, country_codes: ["US"] });
      reachable = res.ok;
    } catch { reachable = false; }
  }

  return {
    api_reachable: reachable,
    env: settings.environment,
    products_enabled: Object.entries(products).filter(([, v]) => v?.status === "enabled").map(([k]) => k).sort(),
    products,
    statements_enabled: settings.statements_enabled,
    connected_items: count ?? 0,
    oauth_enabled: oauthEnabled,
    oauth_enabled_count: oauthEnabled.length,
    oauth_request_needed: oauthNeeded,
    oauth_as_of: oauth.as_of ?? null,
    oauth_source: oauth.source ?? null,
    keys_present: keys,
    keys_rotated_at: status.keys_rotated_at ?? null,
  };
}

/** Plaid error codes that mean "this institution needs Full Production / OAuth we
 * don't have yet". On Limited Production, OAuth (Chase/BofA-class) banks fail here. */
const OAUTH_BLOCKED_CODES = new Set([
  "INSTITUTION_NOT_SUPPORTED",
  "INSTITUTION_NO_LONGER_SUPPORTED",
  "INSTITUTION_NOT_AVAILABLE",
  "INSTITUTION_DOWN",
  "PRODUCTS_NOT_SUPPORTED",
  "OAUTH_NOT_SUPPORTED",
  "OAUTH_INVALID_CONFIGURATION",
]);

export function isOAuthBlocked(r: { errorCode?: string; errorType?: string }): boolean {
  return !!r.errorCode && OAUTH_BLOCKED_CODES.has(r.errorCode);
}

/** Merchant-facing, compliance-safe message for a bank we can't reach yet. No
 * "loan" language; steers them to the upload link. */
export const OAUTH_BLOCKED_MESSAGE =
  "This bank needs our full bank-connection access, which is coming soon. For now, " +
  "please use your secure upload link to send your last 3 months of bank statements instead.";
