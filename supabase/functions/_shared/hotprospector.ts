// HotProspector (hookscall.com) — the PowerDialer API. Shared auth + request helper.
//
// Credentials are NEVER hardcoded. get_hotprospector_config() (SECURITY DEFINER,
// service-role only) reads HOTPROSPECTOR_API_UID + HOTPROSPECTOR_API_KEY from the
// Supabase vault — same shape as get_plaid_config() / get_ghl_config().
//
// AUTH: two steps. POST /auth/token with {api_uId, api_key} returns a bearer
// access_token valid 6h (expires_in 21600); every data call is a POST to /request
// with that bearer and a {"Method": "..."} body. HOTPROSPECTOR_USERNAME/PASSWORD
// exist in the vault but the v2 API does not use them.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const HOTPROSPECTOR_BASE = "https://service.hookscall.com/glu/api/v2";

export interface HotProspectorConfig {
  apiUid: string;
  apiKey: string;
}

/** Read the API credentials from the vault. Throws if either is missing. */
export async function getHotProspectorConfig(db: SupabaseClient): Promise<HotProspectorConfig> {
  const { data, error } = await db.rpc("get_hotprospector_config");
  if (error) throw new Error(`get_hotprospector_config failed: ${error.message}`);
  const apiUid = data?.api_uid as string | undefined;
  const apiKey = data?.api_key as string | undefined;
  if (!apiUid || !apiKey) {
    throw new Error("HotProspector credentials missing from vault (HOTPROSPECTOR_API_UID / HOTPROSPECTOR_API_KEY)");
  }
  return { apiUid, apiKey };
}

export interface HotProspectorTokenResult {
  ok: boolean;
  status: number;
  token: string | null;
  expiresIn: number | null;
  error?: string;
}

/** Exchange uid+key for a 6-hour bearer token. Never throws on an HTTP failure —
 * the caller decides what a bad status means. */
export async function hotProspectorToken(
  cfg: HotProspectorConfig,
  timeoutMs = 15000,
): Promise<HotProspectorTokenResult> {
  const res = await fetch(`${HOTPROSPECTOR_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_uId: cfg.apiUid, api_key: cfg.apiKey }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: { success?: boolean; message?: string; data?: { access_token?: string; expires_in?: number } } | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON handled below */ }

  if (!res.ok) {
    return { ok: false, status: res.status, token: null, expiresIn: null, error: (body?.message ?? text).slice(0, 180) };
  }
  const token = body?.data?.access_token ?? null;
  if (body?.success !== true || !token) {
    return {
      ok: false,
      status: res.status,
      token: null,
      expiresIn: null,
      error: body?.message ? String(body.message).slice(0, 180) : "auth response had no access_token",
    };
  }
  return { ok: true, status: res.status, token, expiresIn: body?.data?.expires_in ?? null };
}

/** POST a {"Method": ...} data request with a bearer token. Returns the parsed body. */
export async function hotProspectorRequest<T = Record<string, unknown>>(
  token: string,
  method: string,
  extra: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const res = await fetch(`${HOTPROSPECTOR_BASE}/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Method: method, ...extra }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data: T | null = null;
  try { data = text ? JSON.parse(text) as T : null; } catch { /* leave null */ }
  if (!res.ok) return { ok: false, status: res.status, data, error: text.slice(0, 180) };
  return { ok: true, status: res.status, data };
}
