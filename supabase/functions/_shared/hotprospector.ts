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

// ---- Retry / backoff --------------------------------------------------------
//
// HotProspector fails two DIFFERENT ways under load, and a bulk lead load must
// survive both:
//   1) HTTP-level: 429 (rate limit) / 5xx / a dropped connection.
//   2) APP-level: HTTP 200 with a body of {"response":"false","message":"Unable
//      to queue leads — Redis is unavailable. Please try again shortly."}. This
//      is the queue backend being briefly down; the HTTP status is 200, so an
//      HTTP-only retry would treat it as success and silently lose the leads.
// hotProspectorRequestRetry retries BOTH classes with exponential backoff+jitter.

const HP_MAX_RETRIES = 4;              // 5 attempts total
const HP_BASE_BACKOFF_MS = 500;        // 500ms → 1s → 2s → 4s (before jitter)

const hpSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hpJitter = (ms: number): number => Math.round(ms * (0.8 + Math.random() * 0.4));

/** App-level transient markers HP returns in a 200 body's `message`. */
const HP_TRANSIENT_RE = /redis|unavailable|try again|temporarily|timeout|too many|rate.?limit/i;

/** Pull HP's `message` out of whatever wrapper it used (bare object OR
 * single-element array), for transient-error detection. */
function hpMessage(data: unknown): string {
  const o = Array.isArray(data) ? data[0] : data;
  if (o && typeof o === "object") {
    const m = (o as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** Did HP return an app-level failure ({"response":"false"}) in a 200 body? */
function hpSaysFailed(data: unknown): boolean {
  const o = Array.isArray(data) ? data[0] : data;
  if (o && typeof o === "object") {
    const r = (o as Record<string, unknown>).response;
    return r === "false" || r === false;
  }
  return false;
}

/**
 * hotProspectorRequest with retry on transient HTTP failures (429/5xx/network)
 * AND transient app-level failures (200 body says response:"false" with a
 * "Redis unavailable / try again" style message). A NON-transient app failure
 * (e.g. a validation error) is returned immediately — retrying won't fix bad
 * data. Never throws; a final network error returns { ok:false, status:0 }.
 */
export async function hotProspectorRequestRetry<T = Record<string, unknown>>(
  token: string,
  method: string,
  extra: Record<string, unknown> = {},
  timeoutMs = 20000,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string; attempts: number }> {
  let last: { ok: boolean; status: number; data: T | null; error?: string } = {
    ok: false, status: 0, data: null, error: "not attempted",
  };

  for (let attempt = 0; attempt <= HP_MAX_RETRIES; attempt++) {
    try {
      last = await hotProspectorRequest<T>(token, method, extra, timeoutMs);
    } catch (e) {
      // AbortSignal.timeout / network drop — treat as transient.
      last = { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
    }

    const httpTransient = !last.ok && (last.status === 0 || last.status === 429 || last.status >= 500);
    const appTransient = last.ok && hpSaysFailed(last.data) && HP_TRANSIENT_RE.test(hpMessage(last.data));

    if (!httpTransient && !appTransient) {
      // Success, or a terminal (non-retryable) failure — return as-is.
      return { ...last, attempts: attempt + 1 };
    }
    if (attempt < HP_MAX_RETRIES) {
      const wait = hpJitter(HP_BASE_BACKOFF_MS * 2 ** attempt);
      console.warn("[hp] transient failure — backing off", JSON.stringify({
        method, attempt: attempt + 1, wait_ms: wait,
        kind: httpTransient ? `http_${last.status}` : "app_transient",
        message: appTransient ? hpMessage(last.data).slice(0, 120) : last.error,
      }));
      await hpSleep(wait);
      continue;
    }
    console.error("[hp] REQUEST FAILED (retries exhausted)", JSON.stringify({
      method, attempts: attempt + 1, status: last.status,
      message: (appTransient ? hpMessage(last.data) : last.error ?? "").slice(0, 200),
    }));
  }
  return { ...last, attempts: HP_MAX_RETRIES + 1 };
}

// ---- Leads ------------------------------------------------------------------

export interface HpLead {
  firstname?: string | null;
  lastname?: string | null;
  company?: string | null;
  /** Landline. HP's dialer uses Mobile primarily; set at least one. */
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  countrycode?: string | null;
  /** Comma-separated tag NAMES (HP resolves/creates tag ids server-side). */
  tags?: string | null;
  /** Arbitrary UCC context → HP "Lead_Custom_Fields". */
  custom_fields?: Record<string, string | number> | null;
}

/** One lead in the AddMultipleLeads payload. Field names are the PROVEN snake_case
 * set (note the capital I in additional_Info). */
export interface HpLeadRow {
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  source?: string;
  additional_Info?: string;
}

/**
 * Bulk-add leads straight into HP's dialer store (the reliable direction — HP
 * then syncs UP to GHL). Retries the Redis-unavailable transient + HTTP 429/5xx.
 *
 * VERIFIED shape (live): { Method, groupId (top-level STRING), leads_array:[...],
 * tagId:[NUMERIC ids] }. Success body: [{"response":"true","message":"...submitted
 * to the queue..."}] — ASYNC: leads appear after HP processes the queue.
 */
export async function addMultipleLeads(
  token: string,
  leadsArray: HpLeadRow[],
  groupId: string,
  tagIds: number[] = [],
  timeoutMs = 30000,
) {
  return await hotProspectorRequestRetry(
    token,
    "AddMultipleLeads",
    { groupId: String(groupId), leads_array: leadsArray, tagId: tagIds },
    timeoutMs,
  );
}

/** Did HP return an app-level success ({"response":"true"}) in the body? */
function hpOk(data: unknown): boolean {
  const o = Array.isArray(data) ? data[0] : data;
  if (o && typeof o === "object") {
    const r = (o as Record<string, unknown>).response;
    return r === "true" || r === true;
  }
  return false;
}

const firstObj = (data: unknown): Record<string, unknown> =>
  (Array.isArray(data) ? data[0] : data) as Record<string, unknown> ?? {};

/**
 * Reuse-or-create an HP group by exact title (case-insensitive). Returns its
 * GroupId as a string, or null on failure. HP groups are the unit an HP dialer
 * campaign targets, so the per-batch group is the reliable batch target.
 */
export async function ensureHpGroup(token: string, title: string): Promise<string | null> {
  const list = await hotProspectorRequestRetry(token, "FetchAllGroups");
  if (list.ok) {
    const groups = (firstObj(list.data).group ?? []) as Array<Record<string, unknown>>;
    const hit = groups.find((g) => String(g.GroupTitle ?? "").trim().toLowerCase() === title.trim().toLowerCase());
    if (hit?.GroupId != null) return String(hit.GroupId);
  }
  const created = await hotProspectorRequestRetry(token, "AddGroup", { GroupTitle: title });
  if (created.ok && hpOk(created.data)) {
    const id = firstObj(created.data)["Added GroupId"];
    if (id != null) return String(id);
  }
  // Lost a create race? Re-list.
  const relist = await hotProspectorRequestRetry(token, "FetchAllGroups");
  if (relist.ok) {
    const groups = (firstObj(relist.data).group ?? []) as Array<Record<string, unknown>>;
    const hit = groups.find((g) => String(g.GroupTitle ?? "").trim().toLowerCase() === title.trim().toLowerCase());
    if (hit?.GroupId != null) return String(hit.GroupId);
  }
  return null;
}

/**
 * Resolve a set of tag TITLES to numeric HP TagIds, creating any that don't
 * exist (AddTag). HP's AddMultipleLeads `tagId` takes NUMERIC ids, not names.
 * Best-effort: a tag that can't be resolved/created is simply omitted.
 */
export async function ensureHpTags(token: string, titles: string[]): Promise<number[]> {
  const wanted = Array.from(new Set(titles.map((t) => t.trim()).filter(Boolean)));
  if (wanted.length === 0) return [];
  const byTitle = new Map<string, number>();
  const list = await hotProspectorRequestRetry(token, "FetchAllTags");
  if (list.ok) {
    for (const t of (firstObj(list.data).tag ?? []) as Array<Record<string, unknown>>) {
      const title = String(t.TagTitle ?? "").trim().toLowerCase();
      const id = Number(t.TagId);
      if (title && Number.isFinite(id)) byTitle.set(title, id);
    }
  }
  const out: number[] = [];
  for (const w of wanted) {
    const existing = byTitle.get(w.toLowerCase());
    if (existing != null) { out.push(existing); continue; }
    const created = await hotProspectorRequestRetry(token, "AddTag", { TagTitle: w });
    const id = Number(firstObj(created.data)["Added TagId"]);
    if (created.ok && hpOk(created.data) && Number.isFinite(id)) out.push(id);
  }
  return out;
}

/** Search HP's lead store within a location. NOTE: SearchByUserInput ignores
 * `searchText` on this account (returns the location's leads regardless), so
 * callers ENUMERATE the Results and match client-side (by phone/company). */
export async function searchHpLeads(
  token: string,
  searchText: string,
  locationId: string,
  timeoutMs = 20000,
) {
  return await hotProspectorRequestRetry(
    token,
    "SearchByUserInput",
    { searchText, locationId },
    timeoutMs,
  );
}
