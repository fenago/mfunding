// wavv-sync — mirror the WAVV dialer's call log into public.wavv_calls, and
// proxy the two on-demand per-call reads (recording, transcript).
//
// WHY. Setters dial with WAVV embedded in VibeReach; HotProspector is retired.
// WAVV Public API v3 is keyset-paginated newest-first, so it cannot answer the
// range/group-by questions a management scorecard asks. A 10-minute cron pulls
// new calls in here and /admin/setter-performance queries the table. WAVV is NOT
// on the GHL 200k/day quota — this feature spends zero GHL budget and touches no
// GHL endpoint.
//
// ── THE KEY IS READ AT REQUEST TIME, NEVER LOGGED ────────────────────────────
// The token comes from the vault via get_wavv_api_key() on every invocation, so
// replacing the vault secret takes effect on the next run with no redeploy. The
// key value is never printed, never echoed into an error, never stored in state.
//
// ── THE INVALID-KEY STATE IS A FIRST-CLASS OUTCOME, NOT A CRASH ──────────────
// The vault key is LIVE as of 2026-08-26 (GET /v3/calls returns 200 with real
// data). It was previously invalid, and the handling for that stays: every action
// branches on 401 and returns HTTP 200 with
//   { ok:false, key_invalid:true, error:"WAVV API key invalid …" }
// and stamps last_status:'key_invalid' into the sync state. This is deliberate:
// the page must be able to distinguish "the dialer had a quiet day" (real zeros)
// from "we cannot read WAVV at all" (unreadable). A silent empty result would
// render as a floor that made no calls — the exact failure-reads-as-success bug
// this codebase has been burned by. UNREADABLE IS NOT ZERO.
//
// ── `direction` IS REQUIRED, AND PAGING RUNS NEWEST-FIRST ────────────────────
// Two live-verified facts about GET /v3/calls that the original build got wrong:
//
//  1. `direction` is MANDATORY. Omitting it returns
//     HTTP 400 {"error":"direction is required and must be one of: inbound,
//     outbound"} — so the sync 400'd on every page and stored nothing. We now
//     page each direction separately and merge into the same upsert.
//
//  2. The feed is keyset-paginated NEWEST-FIRST: `nextCursor` is the startedAt of
//     the last (oldest) row on the page, and passing it walks strictly BACKWARD in
//     time. That inverts what a watermark means mid-descent. The old code advanced
//     the watermark to the NEWEST row it had stored and called that gap-free — but
//     on a descending scan the newest row arrives on page 1, so a truncated run
//     would jump the watermark past everything it had not yet read and silently
//     lose the entire older tail. See the resume-cursor design on SyncState.
//
// ── ACTIONS ──────────────────────────────────────────────────────────────────
//   sync       incremental pull from the watermark (minus overlap) to now,
//              upsert by wavv_call_id, advance the watermark.
//   status     sync state + row counts + newest/oldest call. No API spend.
//   recording  { url, expiresAt } for one call — signed, ~72h, fetched on demand
//              and NEVER stored (a stored URL would rot and leak).
//   transcript { transcript, summary } for one call (WAVV populates it async).
//   reparse    re-derive typed columns from the stored `raw`. NO API spend. This
//              is the escape hatch for any projection change: widen the field
//              mapping, deploy, run reparse once, and the whole stored history is
//              re-derived without touching WAVV.
//
// AUTH mirrors ghl-create-opportunities: trusted shared secret (?secret= or
// x-ghl-secret, matched against get_ghl_config().webhook_secret) for cron, OR a
// signed-in admin/super_admin JWT for the UI. Closers are never allowed — they
// must not read each other's dial stats.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const WAVV_BASE = "https://api.wavv.com/v3";
const STATE_KEY = "wavv_sync";

// WAVV caps limit at 200. The page budget is shared across BOTH directions, so it
// bounds the whole invocation. 60 pages ≈ 12,000 calls — enough to finish a cold
// 30-day start in one or two runs (the live floor produced ~8,000 outbound calls in
// 9 days) while still leaving BUDGET_MS as the real wall-clock guard. A run that
// hits either cap reports truncated:true and persists a per-direction resume
// cursor, so the next run continues the descent instead of restarting it.
const MAX_PAGES = 60;
const PAGE_LIMIT = 200;

// Re-pull a 10-minute window behind the watermark on every run. WAVV indexes by
// startedAt, but a call that is still in progress when we sync gets its final
// seconds/outcome/disposition later — the overlap re-reads those rows so the
// upsert corrects them. Costs one extra page at most; upsert makes it free of
// side effects.
const OVERLAP_MS = 10 * 60 * 1000;

// A cold start (no watermark) pulls this far back rather than all of history.
const COLD_START_DAYS = 30;

// Leave headroom under the edge runtime's wall clock so a long pull still gets
// to persist its watermark instead of being killed mid-page.
const BUDGET_MS = 50_000;

// GHL's edge blocks Python-urllib user agents; WAVV has not been observed to,
// but an explicit, honest UA is sent anyway so the traffic is attributable.
const USER_AGENT = "MFunding-WAVV-Sync/1.0 (+https://mfunding.net)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (v: unknown): string | null => {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const boolOrNull = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null;

/** Normalize a timestamp to ISO, or null. WAVV sends ISO 8601; epoch millis are
 * accepted defensively because we could not probe the live shape. */
function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** First non-empty value at any of the given dot-paths in an object. */
function pick(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const seg of path.split(".")) {
      if (cur === null || typeof cur !== "object") { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[seg];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

// ── The per-agent field does not exist. This is a finding, not a TODO. ───────
// Resolved live on 2026-08-26 against 8,015 real calls. The COMPLETE key set of a
// WAVV v3 call object is:
//
//   id teamId campaignId direction phone callerId contactId contactName
//   startedAt answeredAt endedAt seconds outcome disposition human note
//   summary recorded
//
// No user, member, seat, agent, owner or dialer field — under any spelling, at any
// depth. Three further probes close off the workarounds:
//   • The roster cannot be fetched: /v3/users, /v3/team, /v3/teams, /v3/members,
//     /v3/agents and /v3/campaigns ALL return 401 INVALID_API_KEY with the same
//     key that reads /calls fine. The token is scoped to calls only.
//   • /calls silently IGNORES unknown query params — userId=, agentId=, expand=user
//     all return 200 with unfiltered data rather than 400. So there is no hidden
//     user dimension to filter on either; a 200 here proves nothing exists.
//   • GET /v3/calls/{id} returns the same 18 fields as the list. No detail expansion.
//
// The paths below are kept ONLY so that if WAVV later adds the field, one deploy +
// action:'reparse' attributes the whole stored history with no re-pull. Today they
// all miss and agent_key stays NULL, which is the honest answer.
//
// DO NOT proxy attribution from caller_id or campaign_id. caller_id is two shared
// company numbers across the entire floor (9543354964 / 9542450661) and campaign_id
// is a dial LIST, not a person. Grouping by either would render a per-setter
// scorecard that looks authoritative and attributes calls to the wrong people —
// worse than showing "Unattributed", which is true.
const AGENT_KEY_PATHS = [
  "userId", "user.id", "user", "memberId", "member.id", "member",
  "agentId", "agent.id", "agent", "seatId", "seat.id", "seat",
  "dialerId", "salesRepId", "ownerId", "owner.id",
];
const AGENT_NAME_PATHS = [
  "userName", "user.name", "user.fullName", "user.displayName",
  "user.firstName", "memberName", "member.name", "member.fullName",
  "agentName", "agent.name", "agent.fullName", "agentEmail", "user.email",
  "member.email", "agent.email", "owner.name",
];

/** Project one raw WAVV call object onto the wavv_calls column set.
 * `raw` is stored untouched so this projection stays re-derivable (reparse). */
function projectCall(raw: Record<string, unknown>) {
  const agentRaw = pick(raw, AGENT_KEY_PATHS);
  // A candidate path may resolve to an object (e.g. user: {id,name}); only a
  // scalar is a usable key. An object without a usable id yields null — "not
  // attributed yet" — rather than "[object Object]".
  const agentKey =
    typeof agentRaw === "string" || typeof agentRaw === "number"
      ? String(agentRaw).trim() || null
      : null;
  const agentNameRaw = pick(raw, AGENT_NAME_PATHS);
  const agentName =
    typeof agentNameRaw === "string" || typeof agentNameRaw === "number"
      ? String(agentNameRaw).trim() || null
      : null;

  return {
    wavv_call_id: String(pick(raw, ["id", "callId", "call_id"]) ?? "").trim(),
    direction:    clean(pick(raw, ["direction"])),
    phone:        clean(pick(raw, ["phone", "number", "to"])),
    caller_id:    clean(pick(raw, ["callerId", "caller_id", "from"])),
    started_at:   isoOrNull(pick(raw, ["startedAt", "started_at"])),
    answered_at:  isoOrNull(pick(raw, ["answeredAt", "answered_at"])),
    ended_at:     isoOrNull(pick(raw, ["endedAt", "ended_at"])),
    seconds:      numOrNull(pick(raw, ["seconds", "duration", "talkTime"])),
    outcome:      clean(pick(raw, ["outcome"])),
    disposition:  clean(pick(raw, ["disposition"])),
    human:        boolOrNull(pick(raw, ["human"])),
    recorded:     boolOrNull(pick(raw, ["recorded"])),
    summary:      clean(pick(raw, ["summary"])),
    // Real fields the first build dropped on the floor. contact_id is the GHL
    // contact id in the MFunding location (verified live) — the only join key
    // between a WAVV call and a lead we own, so it is the closest thing to
    // attribution this feed offers.
    team_id:      clean(pick(raw, ["teamId", "team_id"])),
    campaign_id:  clean(pick(raw, ["campaignId", "campaign_id"])),
    contact_id:   clean(pick(raw, ["contactId", "contact_id"])),
    contact_name: clean(pick(raw, ["contactName", "contact_name"])),
    note:         clean(pick(raw, ["note"])),
    agent_key:    agentKey,
    agent_name:   agentName,
    raw,
  };
}

const DIRECTIONS = ["outbound", "inbound"] as const;
type Direction = typeof DIRECTIONS[number];

type SyncState = {
  /** Everything with startedAt > watermark has been COMPLETELY synced, both
   *  directions. Only advances when a full window finishes — never mid-descent. */
  watermark: string | null;
  /** Upper bound of a window still being walked across multiple invocations. It is
   *  pinned at the start of the descent so calls arriving mid-walk cannot shift the
   *  window under us; they are picked up by the next window instead. */
  run_before: string | null;
  /** Directions still owing work in the current window, each mapped to its resume
   *  cursor (null = start from the newest end). A direction is DELETED from this map
   *  once it is fully drained. Empty/absent map = the window is complete, which is
   *  the only condition under which the watermark may move. Presence-as-work-owed is
   *  what makes a truncated descending scan resumable without a gap. */
  pending: Partial<Record<Direction, string | null>> | null;
  last_sync_at: string | null;
  last_status: string;
  last_error: string | null;
  key_invalid: boolean;
  rows_upserted_last: number;
  truncated: boolean;
};

const EMPTY_STATE: SyncState = {
  watermark: null, run_before: null, pending: null,
  last_sync_at: null, last_status: "never_run",
  last_error: null, key_invalid: false, rows_upserted_last: 0, truncated: false,
};

async function loadState(db: SupabaseClient): Promise<SyncState> {
  const { data } = await db.from("platform_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  const v = (data?.value ?? null) as Partial<SyncState> | null;
  return { ...EMPTY_STATE, ...(v ?? {}) };
}

/** Persist sync state. LOUD on failure — a silently unsaved watermark would make
 * every subsequent run re-pull the same window and look healthy while doing it. */
async function saveState(db: SupabaseClient, patch: Partial<SyncState>) {
  const prev = await loadState(db);
  const value = { ...prev, ...patch };
  const { error } = await db.from("platform_settings")
    .upsert({ key: STATE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("[wavv-sync] saveState failed:", error.message);
  return value;
}

type WavvResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; keyInvalid: boolean; error: string };

/** One authenticated GET against WAVV. The key is passed in the header and never
 * appears in a URL, a log line, or a returned error message. */
async function wavvGet<T = Record<string, unknown>>(
  key: string, path: string, params?: Record<string, string>,
): Promise<WavvResult<T>> {
  const url = new URL(`${WAVV_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (e) {
    // A network failure is UNREADABLE, not empty. Never a silent success.
    return { ok: false, status: 0, keyInvalid: false, error: `WAVV request failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const text = await res.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { _raw: text.slice(0, 300) }; }

  if (!res.ok) {
    const b = body as Record<string, unknown>;
    const code = clean(b.code) ?? "";
    // 401 / INVALID_API_KEY is the one error with a specific human remedy, so it
    // is surfaced as its own flag all the way to the page banner.
    const keyInvalid = res.status === 401 || code === "INVALID_API_KEY";
    const detail = clean(b.error) ?? clean(b.message) ?? text.slice(0, 200) ?? "";
    return {
      ok: false,
      status: res.status,
      keyInvalid,
      error: keyInvalid
        ? `WAVV API key invalid (HTTP ${res.status}: ${detail || "INVALID_API_KEY"}). Update WAVV_API_KEY in the Supabase vault.`
        : `WAVV HTTP ${res.status}: ${detail || "unknown error"}`,
    };
  }
  return { ok: true, status: res.status, body: body as T };
}

/** Resolve the trusted webhook secret (vault via get_ghl_config, env fallback). */
async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);
  const startedMs = Date.now();

  // ── Auth: trusted secret (cron) OR a signed-in admin/super_admin (the UI) ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (providedSecret) {
    const expected = await webhookSecret(db);
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    // Managers only — a closer must not read the floor's per-rep stats.
    if (!role || !["admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — admin only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron / GET */ }

  const action = (clean(payload.action) ?? url.searchParams.get("action") ?? "sync").toLowerCase();
  const callId = clean(payload.call_id) ?? url.searchParams.get("call_id");

  // ── status — no API spend at all ──────────────────────────────────────────
  if (action === "status") {
    const state = await loadState(db);
    const { count } = await db.from("wavv_calls").select("id", { count: "exact", head: true });
    const { data: newest } = await db.from("wavv_calls")
      .select("started_at").not("started_at", "is", null)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: oldest } = await db.from("wavv_calls")
      .select("started_at").not("started_at", "is", null)
      .order("started_at", { ascending: true }).limit(1).maybeSingle();
    return json({
      ok: true,
      state,
      total_rows: count ?? 0,
      newest_started_at: newest?.started_at ?? null,
      oldest_started_at: oldest?.started_at ?? null,
    });
  }

  // ── reparse — re-derive typed columns from stored raw. NO API spend. ───────
  // The backfill path for the unknown per-agent field: extend AGENT_KEY_PATHS,
  // deploy, run this once, and the whole history is attributed.
  if (action === "reparse") {
    let scanned = 0, updated = 0, attributed = 0;
    const PAGE = 500;
    for (let offset = 0; ; offset += PAGE) {
      if (Date.now() - startedMs > BUDGET_MS) {
        return json({ ok: true, action: "reparse", scanned, updated, attributed, truncated: true,
          note: "Time budget reached — run reparse again to continue." });
      }
      const { data, error } = await db.from("wavv_calls")
        .select("id,raw").order("created_at", { ascending: true }).range(offset, offset + PAGE - 1);
      if (error) return json({ ok: false, error: `read failed: ${error.message}` }, 500);
      if (!data || data.length === 0) break;
      scanned += data.length;

      for (const row of data) {
        const raw = (row.raw ?? {}) as Record<string, unknown>;
        const p = projectCall(raw);
        if (!p.wavv_call_id) continue;
        const { wavv_call_id: _id, raw: _raw, ...cols } = p;
        const { error: upErr } = await db.from("wavv_calls").update(cols).eq("id", row.id);
        if (upErr) { console.error("[wavv-sync] reparse update failed:", upErr.message); continue; }
        updated++;
        if (cols.agent_key) attributed++;
      }
      if (data.length < PAGE) break;
    }
    return json({ ok: true, action: "reparse", scanned, updated, attributed, truncated: false });
  }

  // Everything below talks to WAVV, so it needs the key.
  const { data: apiKey, error: keyErr } = await db.rpc("get_wavv_api_key");
  if (keyErr || !apiKey || typeof apiKey !== "string") {
    const msg = "WAVV_API_KEY missing from the Supabase vault.";
    await saveState(db, { last_status: "error", last_error: msg, last_sync_at: new Date().toISOString() });
    return json({ ok: false, key_invalid: true, error: msg });
  }

  // ── recording / transcript — on-demand per-call proxies ───────────────────
  // The signed URL is returned to the caller and never persisted: it expires in
  // ~72h, so a stored copy would rot into a broken link that looks valid.
  if (action === "recording" || action === "transcript") {
    if (!callId) return json({ ok: false, error: "call_id is required" }, 400);
    const path = action === "recording" ? `/calls/${encodeURIComponent(callId)}/recording`
                                        : `/calls/${encodeURIComponent(callId)}/transcript`;
    const res = await wavvGet<Record<string, unknown>>(apiKey, path);
    if (!res.ok) {
      if (res.keyInvalid) {
        await saveState(db, { key_invalid: true, last_status: "key_invalid", last_error: res.error });
        return json({ ok: false, key_invalid: true, error: res.error });
      }
      // 404 means WAVV has no recording/transcript for this call — a real
      // answer, distinct from a failure to ask.
      if (res.status === 404) {
        return json({ ok: false, not_found: true,
          error: action === "recording" ? "No recording available for this call." : "No transcript available for this call yet." });
      }
      return json({ ok: false, error: res.error });
    }
    // A successful call proves the key works; clear a stale invalid flag.
    await saveState(db, { key_invalid: false });
    if (action === "recording") {
      return json({
        ok: true,
        url: clean(res.body.url) ?? clean(pick(res.body, ["recordingUrl", "signedUrl"])),
        expiresAt: clean(res.body.expiresAt) ?? clean(pick(res.body, ["expires_at"])),
      });
    }
    return json({
      ok: true,
      transcript: clean(res.body.transcript) ?? clean(pick(res.body, ["text"])),
      summary: clean(res.body.summary),
    });
  }

  if (action !== "sync") return json({ error: `unknown action "${action}"` }, 400);

  // ── sync — incremental pull, both directions ──────────────────────────────
  const state = await loadState(db);
  const nowIso = new Date().toISOString();

  // Resume an unfinished window rather than starting a new one, otherwise a floor
  // that out-produces one invocation would restart the descent forever and never
  // reach its own history.
  const resuming = !!(state.run_before && state.pending && Object.keys(state.pending).length > 0);
  const before = resuming ? state.run_before! : nowIso;
  const pending: Partial<Record<Direction, string | null>> = resuming
    ? { ...state.pending }
    : { outbound: null, inbound: null };

  // Watermark minus the overlap window; cold start reaches back COLD_START_DAYS
  // rather than pulling all of WAVV's history in one invocation.
  const startedAfter = state.watermark
    ? new Date(new Date(state.watermark).getTime() - OVERLAP_MS).toISOString()
    : new Date(Date.now() - COLD_START_DAYS * 86_400_000).toISOString();

  let pages = 0, upserted = 0, truncated = false;
  const perDirection: Record<string, number> = {};

  // Page budget and wall clock are shared across both directions — the runtime
  // kills the whole invocation, not one loop.
  outer:
  for (const dir of DIRECTIONS) {
    if (!(dir in pending)) continue;   // already drained in an earlier invocation
    let cursor: string | null = pending[dir] ?? null;
    perDirection[dir] = perDirection[dir] ?? 0;

    for (;;) {
      if (pages >= MAX_PAGES || Date.now() - startedMs > BUDGET_MS) {
        // Stop mid-descent. `cursor` is where this direction must resume from; it
        // is persisted below, so the older tail is not lost.
        pending[dir] = cursor;
        truncated = true;
        break outer;
      }

      const params: Record<string, string> = {
        direction: dir,               // REQUIRED — omitting it is a hard 400.
        startedAfter,
        startedBefore: before,
        limit: String(PAGE_LIMIT),
      };
      if (cursor) params.cursor = cursor;

      const res = await wavvGet<Record<string, unknown>>(apiKey, "/calls", params);
      if (!res.ok) {
        // Nothing partial is thrown away: pages already stored stay stored, and the
        // resume cursor is persisted so the next run picks the descent back up at
        // exactly this point. The watermark does NOT move — the window is unfinished.
        pending[dir] = cursor;
        const saved = await saveState(db, {
          run_before: before,
          pending,
          last_sync_at: nowIso,
          last_status: res.keyInvalid ? "key_invalid" : "error",
          last_error: res.error,
          key_invalid: res.keyInvalid,
          rows_upserted_last: upserted,
          truncated: true,
        });
        return json({
          ok: false, key_invalid: res.keyInvalid, error: res.error,
          upserted, pages, direction: dir, truncated: true, watermark: saved.watermark,
        });
      }
      pages++;

      const body = res.body;
      // Live shape is { data: [...], nextCursor }. The other wrappers are kept as
      // cheap tolerance in case WAVV renames the envelope.
      const items = (Array.isArray(body) ? body
        : Array.isArray(body.data) ? body.data
        : Array.isArray(body.calls) ? body.calls
        : Array.isArray(body.results) ? body.results
        : Array.isArray(body.items) ? body.items
        : []) as Record<string, unknown>[];

      const rows = items.map(projectCall).filter((r) => r.wavv_call_id.length > 0);
      if (rows.length) {
        const { error } = await db.from("wavv_calls")
          .upsert(rows, { onConflict: "wavv_call_id" });
        if (error) {
          pending[dir] = cursor;
          const saved = await saveState(db, {
            run_before: before, pending,
            last_sync_at: nowIso, last_status: "error",
            last_error: `upsert failed: ${error.message}`,
            rows_upserted_last: upserted, truncated: true,
          });
          return json({ ok: false, error: `upsert failed: ${error.message}`, upserted, pages, watermark: saved.watermark }, 500);
        }
        upserted += rows.length;
        perDirection[dir] += rows.length;
      }

      const next = clean(pick(body, ["nextCursor", "next_cursor", "paging.nextCursor"]));
      // No cursor, an empty page, or a cursor that failed to move = the end of this
      // direction's window. The equality guard matters: a cursor that repeats would
      // otherwise spin until the budget runs out and report a false truncation.
      if (!next || items.length === 0 || next === cursor) {
        delete pending[dir];
        break;
      }
      cursor = next;
    }
  }

  // The window is done only when BOTH directions have drained. Until then the
  // watermark stays put — moving it early is exactly the gap this design prevents.
  const complete = Object.keys(pending).length === 0;

  const saved = await saveState(db, {
    watermark: complete ? before : state.watermark,
    run_before: complete ? null : before,
    pending: complete ? null : pending,
    last_sync_at: nowIso,
    last_status: "ok",
    last_error: null,
    key_invalid: false,
    rows_upserted_last: upserted,
    truncated,
  });

  return json({
    ok: true, upserted, pages, truncated,
    complete, per_direction: perDirection,
    window: { startedAfter, startedBefore: before },
    watermark: saved.watermark,
    // Present only while a descent is still owed work — tells the caller to invoke
    // again rather than assume the pull finished.
    pending: complete ? null : pending,
  });
});
