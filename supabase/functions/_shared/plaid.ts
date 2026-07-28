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
