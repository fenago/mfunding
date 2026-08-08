// hotprospector-sync — snapshot the HotProspector (hookscall.com) PowerDialer
// dashboard into hotprospector_agent_daily + hotprospector_account_daily.
//
// WHAT IT PULLS (one auth, then five bounded calls — the whole run is lean enough
// to fire hourly during business hours):
//   getMemberUsers            → roster (name/email/status per member)
//   getMemberDashboardData    → THE per-agent daily scorecard (HP's own report)
//   fetchCreditCount          → dialer credits remaining
//   checkMemberLimit          → seats total/active/remaining
//   FetchAllCampaigns         → campaign count (the disposition layer builds on this)
//   FetchUserCallLog          → bounded page sweep, ONLY to derive avg speed-to-lead
//                               per rep (HP does not put speed_to_lead on the
//                               dashboard object) plus a call-count sanity number.
//
// AUTH TOKEN: /auth/token issues a 6h bearer, but issuing a new one appears to
// invalidate the previous one, so we authenticate ONCE per run and reuse that
// token for every call. Never auth per-call.
//
// HONESTY LAW: a metric HotProspector didn't return is written as NULL, never 0.
// The account row is upserted on EVERY run (even a zero-agent day) so the page
// can tell "poller ran, HP has no active agents" from "poller never ran".
//
// AUTH (mirrors the other internal pollers): trusted cron via ?secret=<GHL
// webhook secret> + anon-key Bearer, OR a signed-in staff user (closer/admin/
// super_admin). A service-role bearer deliberately fails the role check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getHotProspectorConfig, hotProspectorToken, hotProspectorRequest } from "../_shared/hotprospector.ts";

const CALL_LOG_PAGE = 500;   // rows per FetchUserCallLog page
const CALL_LOG_MAX_PAGES = 6; // hard cap → at most 3,000 rows for one day
const MAX_CAMPAIGNS = 40;    // disposition pulls are one sequential call each — cap the fan-out

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Response shapes vary across methods ──────────────────────────────────────
// Some methods return a bare object, some return a single-element array wrapping
// the object. Normalize to "the first object".
function unwrap(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return (data[0] ?? {}) as Record<string, unknown>;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return {};
}

/** Tolerant number parse. HotProspector decorates its numbers for display —
 * "0 %", "1 m", "0.000000", "1,204" — so strip the decoration and read the
 * leading number. Returns null (NOT 0) for anything unparseable, so a metric
 * HotProspector omitted never shows up as a real zero.
 * Deliberately does NOT try to read durations ("00m :14s") — those go through
 * durationSeconds() and would otherwise silently become the number 0. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || s === "-" || s.toLowerCase() === "n/a") return null;
  if (/\d\s*[hms]\s*:/i.test(s)) return null; // a duration, not a scalar
  const m = s.replace(/,/g, "").match(/^[$]?\s*(-?\d+(?:\.\d+)?)\s*(?:%|[a-z]+)?$/i);
  return m ? Number(m[1]) : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Parse a HotProspector duration to seconds. Verified live, HP formats these as
 * unit-suffixed segments — "00m :14s", "01h :22m :10s" — and colon clocks
 * ("1:12:30") also appear. Returns null when the shape isn't recognized; the
 * verbatim string is always stored alongside, so a failed parse loses nothing. */
function durationSeconds(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Unit-suffixed segments: "00m :14s", "01h :22m :10s", "45s"
  const units = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)];
  if (units.length > 0) {
    const mult: Record<string, number> = { h: 3600, m: 60, s: 1 };
    return units.reduce((t, u) => t + Number(u[1]) * mult[u[2].toLowerCase()], 0);
  }

  // Colon clock: "1:12:30" (h:m:s) or "12:30" (m:s)
  const clock = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const a = Number(clock[1]), b = Number(clock[2]);
    return clock[3] !== undefined ? a * 3600 + b * 60 + Number(clock[3]) : a * 60 + b;
  }

  const plain = num(s);
  return plain; // bare number → assume seconds
}

/** Pick the first present key from a list of aliases (HP casing is inconsistent). */
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== "") return o[k];
  }
  return null;
}

/** The array of result rows, whatever HP called it this time. */
function results(o: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of ["Results", "results", "data", "message"]) {
    const v = o[k];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

interface SpeedStat { total: number; samples: number; calls: number }

/** Normalize a member's `dispositionStatus` into [{disposition, cnt}].
 * Shape is UNVERIFIED against live data (the account has no campaigns yet — see
 * the migration header), so both plausible shapes are accepted:
 *   • a map:   {"Hot Lead": "3", "Not Interested": "5"}
 *   • an array: [{status|disposition|name|title, count|cnt|total}]
 * Entries whose count doesn't parse are DROPPED rather than coerced to 0 — a
 * fake zero here would read as "this rep got no Hot Leads". */
function parseDispositions(v: unknown): { disposition: string; cnt: number }[] {
  const out: { disposition: string; cnt: number }[] = [];
  if (!v || typeof v !== "object") return out;

  if (Array.isArray(v)) {
    for (const e of v) {
      if (!e || typeof e !== "object") continue;
      const row = e as Record<string, unknown>;
      const label = str(pick(row, "status", "disposition", "dispositionStatus", "name", "title"));
      const cnt = int(pick(row, "count", "cnt", "total", "value"));
      if (label && cnt !== null) out.push({ disposition: label, cnt });
    }
    return out;
  }

  for (const [label, raw] of Object.entries(v as Record<string, unknown>)) {
    const cnt = int(raw);
    if (label.trim() && cnt !== null) out.push({ disposition: label.trim(), cnt });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* GET/cron */ }

  // Which day to snapshot. HotProspector reports in PST, so "today" is the PST day.
  const daysBack = int(payload.days_back ?? url.searchParams.get("days_back")) ?? 0;
  const explicitDate = str(payload.date ?? url.searchParams.get("date"));
  const pstNow = new Date(Date.now() - 8 * 3600_000);
  const target = explicitDate
    ?? new Date(pstNow.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);

  const started = Date.now();
  const warnings: string[] = [];

  // ── Authenticate ONCE ──────────────────────────────────────────────────────
  let cfg;
  try {
    cfg = await getHotProspectorConfig(db);
  } catch (e) {
    return json({ ok: false, stage: "config", error: e instanceof Error ? e.message : String(e) }, 500);
  }
  const auth = await hotProspectorToken(cfg);
  if (!auth.ok || !auth.token) {
    return json({ ok: false, stage: "auth", status: auth.status, error: auth.error ?? "auth failed" }, 502);
  }
  const token = auth.token;

  // ── Account-level facts ────────────────────────────────────────────────────
  const [creditsRes, limitRes, campaignRes, rosterRes] = await Promise.all([
    hotProspectorRequest(token, "fetchCreditCount"),
    hotProspectorRequest(token, "checkMemberLimit"),
    hotProspectorRequest(token, "FetchAllCampaigns"),
    hotProspectorRequest(token, "getMemberUsers"),
  ]);

  const creditsBody = unwrap(creditsRes.data);
  const credits = int(pick(creditsBody, "credits", "credit"));
  if (!creditsRes.ok) warnings.push(`fetchCreditCount HTTP ${creditsRes.status}`);

  const limitBody = unwrap(limitRes.data);
  const limitData = (limitBody.data ?? limitBody) as Record<string, unknown>;
  const seatsTotal = int(limitData.total_user);
  const seatsActive = int(limitData.active_user);
  const seatsRemaining = int(limitData.remaining_user);
  if (!limitRes.ok) warnings.push(`checkMemberLimit HTTP ${limitRes.status}`);

  const campaigns = results(unwrap(campaignRes.data));
  const campaignCount = campaigns.length;

  // Roster: member_id → {name, email}. Fills gaps the dashboard object leaves.
  const roster = new Map<string, { name: string | null; email: string | null }>();
  for (const m of results(unwrap(rosterRes.data))) {
    const id = str(pick(m, "memberId", "member_id", "id", "userId"));
    if (!id) continue;
    const first = str(pick(m, "first_name", "firstName", "fname")) ?? "";
    const last = str(pick(m, "last_name", "lastName", "lname")) ?? "";
    const name = str(pick(m, "name", "full_name")) ?? `${first} ${last}`.trim();
    roster.set(id, { name: name || null, email: str(pick(m, "email", "user_email")) });
  }

  // ── The scorecard ──────────────────────────────────────────────────────────
  const dashRes = await hotProspectorRequest(token, "getMemberDashboardData", { date: target });
  if (!dashRes.ok) {
    return json({ ok: false, stage: "getMemberDashboardData", status: dashRes.status, error: dashRes.error }, 502);
  }
  const dashBody = unwrap(dashRes.data);
  const agentRows = results(dashBody);
  const dashMessage = str(pick(dashBody, "message"));
  const dashLastUpdated = str(pick(dashBody, "last_updated", "lastUpdated"));

  // ── Speed-to-lead from the call log (bounded page sweep for the target day) ──
  // Call-log rows carry `caller_name`, not an agent id, so speed-to-lead is keyed
  // by lowercased name and joined onto the dashboard rows by agent name.
  const speedByName = new Map<string, SpeedStat>();
  let callsLogged = 0;
  let callLogFailed = false;
  for (let page = 0; page < CALL_LOG_MAX_PAGES; page++) {
    const clRes = await hotProspectorRequest(token, "FetchUserCallLog", {
      from_date: target,
      to_date: target,
      limit: CALL_LOG_PAGE,
      offset: page * CALL_LOG_PAGE,
    }, 25000);
    if (!clRes.ok) {
      callLogFailed = true;
      warnings.push(`FetchUserCallLog HTTP ${clRes.status} (speed-to-lead unavailable)`);
      break;
    }
    const body = unwrap(clRes.data);
    const rows = results(body);
    for (const r of rows) {
      callsLogged++;
      const who = (str(pick(r, "caller_name", "agent_name", "user_name")) ?? "").toLowerCase();
      if (!who) continue;
      const stl = num(r.speed_to_lead);
      const cur = speedByName.get(who) ?? { total: 0, samples: 0, calls: 0 };
      cur.calls++;
      if (stl !== null && stl >= 0) { cur.total += stl; cur.samples++; }
      speedByName.set(who, cur);
    }
    const hasMore = body.has_more === true || String(body.has_more) === "true";
    if (!hasMore || rows.length === 0) break;
    if (page === CALL_LOG_MAX_PAGES - 1) {
      warnings.push(`call log truncated at ${CALL_LOG_MAX_PAGES * CALL_LOG_PAGE} rows — speed-to-lead is a partial-day average`);
    }
  }

  // ── Map API rows → table rows ──────────────────────────────────────────────
  const now = new Date().toISOString();
  const upserts = agentRows.map((a) => {
    const memberId = str(pick(a, "agentId", "agent_id", "memberId", "member_id", "id")) ?? "unknown";
    const fromRoster = roster.get(memberId);
    const agentName = str(pick(a, "agentName", "agent_name", "name")) ?? fromRoster?.name ?? null;
    const speed = agentName ? speedByName.get(agentName.toLowerCase()) : undefined;
    const gapRaw = str(pick(a, "gapTime", "gap_time"));
    const hoursRaw = str(pick(a, "hours"));

    return {
      stat_date: target,
      member_id: memberId,
      agent_name: agentName,
      agent_email: str(pick(a, "agentEmail", "agent_email", "email")) ?? fromRoster?.email ?? null,

      first_call: str(pick(a, "firstCall", "first_call")),
      last_call: str(pick(a, "lastCall", "last_call")),
      gap_time: gapRaw,
      gap_time_seconds: durationSeconds(gapRaw),
      hours: hoursRaw,
      hours_seconds: durationSeconds(hoursRaw),

      outbound_calls: int(pick(a, "outboundCall", "outbound_call", "outboundCalls")),
      inbound_calls: int(pick(a, "inboundCall", "inbound_call", "inboundCalls")),
      answered_calls: int(pick(a, "answered_calls", "answeredCalls")),
      hangups: int(pick(a, "hangups")),
      sms: int(pick(a, "SMS", "sms")),

      acg: num(pick(a, "acg", "ACG")),
      aod: num(pick(a, "AOD", "aod")),
      aid: num(pick(a, "AID", "aid")),
      talk_min: num(pick(a, "talkMin", "talk_min")),
      avg_min: num(pick(a, "avgMin", "avg_min")),
      ans_per_hour: num(pick(a, "ansPerHour", "ans_per_hour")),
      answer_rate: num(pick(a, "answer_rate", "answerRate")),

      convos: int(pick(a, "convos", "conversations")),
      conversion_rate: num(pick(a, "cr", "CR", "conversion_rate")),
      prospects: int(pick(a, "Prospects", "prospects")),
      prospects_weekly: int(pick(a, "ProspectsWeekly", "prospects_weekly")),
      appts: int(pick(a, "Appts", "appts")),
      appts_weekly: int(pick(a, "ApptsWeekly", "appts_weekly")),
      abr: num(pick(a, "ABR", "abr")),

      avg_speed_to_lead: speed && speed.samples > 0 ? speed.total / speed.samples : null,
      speed_to_lead_samples: speed ? speed.samples : null,

      raw: a,
      synced_at: now,
    };
  });

  if (upserts.length > 0) {
    const { error } = await db
      .from("hotprospector_agent_daily")
      .upsert(upserts, { onConflict: "stat_date,member_id" });
    if (error) {
      return json({ ok: false, stage: "upsert_agents", error: error.message, agents: upserts.length }, 500);
    }
  }

  // ── Per-campaign disposition breakdown ─────────────────────────────────────
  // One sequential call per campaign, reusing the run's token. Bounded by
  // MAX_CAMPAIGNS. A campaign that fails is recorded as a warning and skipped —
  // it never aborts the run or the campaigns that did succeed.
  //
  // NOTE: this endpoint 404s for a campaign_id that doesn't exist, and an unknown
  // Method name 404s identically, so a 404 is reported as an explicit warning
  // rather than being swallowed. See the migration header.
  const campaignsToPull = campaigns.slice(0, MAX_CAMPAIGNS);
  if (campaigns.length > MAX_CAMPAIGNS) {
    warnings.push(`${campaigns.length} campaigns found — dispositions pulled for the first ${MAX_CAMPAIGNS} only`);
  }
  let dispositionRows = 0;
  let campaignsPulled = 0;

  for (const c of campaignsToPull) {
    const campaignId = str(pick(c, "campaign_id", "campaignId", "id"));
    if (!campaignId) continue;
    const campaignTitle = str(pick(c, "CampaignTitle", "campaign_title", "title", "name"));

    const dispRes = await hotProspectorRequest(token, "getDashboardMemberDatabyCampaign", {
      campaign_id: campaignId,
      date: target,
    }, 20000);
    if (!dispRes.ok) {
      warnings.push(
        dispRes.status === 404
          ? `dispositions: campaign ${campaignId} returned 404 (campaign not found, or the endpoint is unavailable on this account)`
          : `dispositions: campaign ${campaignId} HTTP ${dispRes.status}`,
      );
      continue;
    }

    const rows: Record<string, unknown>[] = [];
    for (const m of results(unwrap(dispRes.data))) {
      const memberId = str(pick(m, "agentId", "agent_id", "memberId", "member_id", "id"));
      if (!memberId) continue;
      const agentName = str(pick(m, "agentName", "agent_name", "name"))
        ?? roster.get(memberId)?.name ?? null;
      for (const d of parseDispositions(pick(m, "dispositionStatus", "disposition_status", "dispositions"))) {
        rows.push({
          stat_date: target,
          campaign_id: campaignId,
          campaign_title: campaignTitle,
          member_id: memberId,
          agent_name: agentName,
          disposition: d.disposition,
          cnt: d.cnt,
          raw: m,
          synced_at: now,
        });
      }
    }

    // Delete + reinsert this campaign-day so a disposition that disappeared
    // (or a rep who moved off the campaign) cannot linger as a stale row. Only
    // runs for a campaign whose pull actually succeeded.
    const { error: delErr } = await db
      .from("hotprospector_disposition_daily")
      .delete()
      .eq("stat_date", target)
      .eq("campaign_id", campaignId);
    if (delErr) {
      return json({ ok: false, stage: "clear_dispositions", campaign_id: campaignId, error: delErr.message }, 500);
    }
    if (rows.length > 0) {
      const { error: insErr } = await db.from("hotprospector_disposition_daily").insert(rows);
      if (insErr) {
        return json({ ok: false, stage: "insert_dispositions", campaign_id: campaignId, error: insErr.message }, 500);
      }
    }
    campaignsPulled++;
    dispositionRows += rows.length;
  }

  const { error: acctErr } = await db
    .from("hotprospector_account_daily")
    .upsert({
      stat_date: target,
      credits,
      seats_total: seatsTotal,
      seats_active: seatsActive,
      seats_remaining: seatsRemaining,
      campaign_count: campaignCount,
      agents_returned: upserts.length,
      calls_logged: callLogFailed ? null : callsLogged,
      dashboard_last_updated: dashLastUpdated,
      dashboard_message: dashMessage,
      raw: {
        credits: creditsBody,
        limits: limitBody,
        // The campaign list is kept here so the UI can offer the campaign filter
        // even on a day with zero disposition rows.
        campaigns: campaigns.slice(0, 50),
        roster_size: roster.size,
        campaigns_pulled: campaignsPulled,
        disposition_rows: dispositionRows,
        warnings,
      },
      synced_at: now,
    }, { onConflict: "stat_date" });
  if (acctErr) {
    return json({ ok: false, stage: "upsert_account", error: acctErr.message }, 500);
  }

  return json({
    ok: true,
    date: target,
    agents_synced: upserts.length,
    agent_names: upserts.map((u) => u.agent_name).filter(Boolean),
    roster_size: roster.size,
    credits,
    seats: { total: seatsTotal, active: seatsActive, remaining: seatsRemaining },
    campaigns: campaignCount,
    calls_logged: callLogFailed ? null : callsLogged,
    campaigns_pulled: campaignsPulled,
    disposition_rows: dispositionRows,
    dashboard_message: dashMessage,
    dashboard_last_updated: dashLastUpdated,
    warnings,
    elapsed_ms: Date.now() - started,
  });
});
