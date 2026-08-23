// system-health-check — probe EVERY external dependency with a REAL authenticated
// call, record the result, and ALERT the owner on a state transition.
//
// WHY: Instantly's plan lapsed and its API returned 402 for ~8 days before anyone
// noticed — warmup paused, email verification silently died, /admin/email showed
// zeros. A TCP ping would have said "up". So every probe here makes an authenticated
// call and judges the ACTUAL response (402 = DOWN, not up).
//
// Writes one row per service per run into system_health_checks, keeps the current
// state in system_health_state (the alert-dedup ledger), and opens/closes
// system_health_incidents on transitions. On a transition it emails the owner via
// GHL (from the company sending domain); if GHL itself is the thing that's down, it
// falls back to a kanban_tasks card + an internal message.
//
// Auth (mirrors email-verify-sweep):
//   • Trusted cron → ?secret=<GHL webhook secret> (+ anon-key Bearer for the gateway).
//   • Staff UI     → user JWT with admin/super_admin. A service-role bearer is NOT a
//     session and deliberately fails the role check — use the secret path.
//
// Compliance: internal ops only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  serviceClient,
  getGhlConfig,
  ghlFetch,
  upsertContact,
  sendEmailToContact,
  type GhlConfig,
} from "../_shared/ghl.ts";
import { getInstantlyKey } from "../_shared/instantly.ts";
import { callLLM, resolveConfig } from "../_shared/llm.ts";
import { buildPlaidHealth, getPlaidConfig, plaidFetch, resolveEnv, type PlaidHealth } from "../_shared/plaid.ts";
import { getHotProspectorConfig, hotProspectorRequest, hotProspectorToken } from "../_shared/hotprospector.ts";

const OWNER_EMAIL = "socrates73@gmail.com";
const FROM_EMAIL = "sales@send.mfunding.net"; // company dedicated sending domain
const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

// Supabase Management API + this project. Used by the egress/usage probe.
const SB_MGMT_BASE = "https://api.supabase.com";
const SB_PROJECT_REF = "ehibjeonqpqskhcvizow";
// Pro plan included allowances (the quota the probe measures against). Overage is
// billed above these; disk is a HARD gate that can restrict the project.
const PRO_EGRESS_GB = 250; // cached egress + DB egress included per billing month
const PRO_DISK_GB = 8;     // included disk before overage

type Status = "up" | "degraded" | "down";

interface CheckResult {
  service: string;
  status: Status;
  http_status: number | null;
  latency_ms: number | null;
  detail: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Instantly v2 list endpoints return { items: [...] } — normalize to an array. */
function items(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const p = payload as { items?: unknown[]; data?: unknown[] } | null;
  if (p && Array.isArray(p.items)) return p.items;
  if (p && Array.isArray(p.data)) return p.data;
  return [];
}

// ── Individual probes. Each NEVER throws — a probe failure resolves to a status. ──

/** Instantly: a 402 means the plan is inactive (the exact silent failure we build for).
 * Also counts PAUSED accounts (status=2 = warmup paused) and reports that as degraded. */
async function checkInstantly(db: SupabaseClient): Promise<CheckResult> {
  const svc = "instantly";
  let apiKey: string;
  try {
    apiKey = await getInstantlyKey(db);
  } catch (e) {
    return { service: svc, status: "down", http_status: null, latency_ms: null, detail: `not configured: ${e instanceof Error ? e.message : String(e)}` };
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${INSTANTLY_API_BASE}/accounts?limit=100`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - t0;
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (res.status === 402) {
      return { service: svc, status: "down", http_status: 402, latency_ms: latency, detail: "plan inactive (402) — renew at instantly.ai → Billing. Warmup + email verification are paused." };
    }
    if (res.status === 401 || res.status === 403) {
      return { service: svc, status: "down", http_status: res.status, latency_ms: latency, detail: `auth rejected (${res.status}) — check INSTANTLY_API_KEY.` };
    }
    if (!res.ok) {
      return { service: svc, status: "down", http_status: res.status, latency_ms: latency, detail: `HTTP ${res.status}: ${String(text).slice(0, 180)}` };
    }
    const accounts = items(data) as Array<{ status?: number; email?: string }>;
    const paused = accounts.filter((a) => a.status === 2).length;
    if (paused > 0) {
      return { service: svc, status: "degraded", http_status: 200, latency_ms: latency, detail: `${paused} of ${accounts.length} sending account(s) paused (warmup) — check instantly.ai.` };
    }
    return { service: svc, status: "up", http_status: 200, latency_ms: latency, detail: `${accounts.length} sending account(s) active.` };
  } catch (e) {
    return { service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** GHL/VibeReach: cheap authenticated location-scoped read (contacts list, limit 1). */
async function checkGhl(cfg: GhlConfig | null, cfgErr: string | null): Promise<CheckResult> {
  const svc = "ghl";
  if (!cfg) {
    return { service: svc, status: "down", http_status: null, latency_ms: null, detail: `credentials missing from vault${cfgErr ? `: ${cfgErr}` : ""}` };
  }
  const t0 = Date.now();
  try {
    const res = await ghlFetch(cfg, "GET", `/contacts/?locationId=${cfg.locationId}&limit=1`);
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: svc, status: "up", http_status: res.status, latency_ms: latency, detail: "LeadConnector API responding." };
    }
    if (res.status === 401 || res.status === 403) {
      return { service: svc, status: "down", http_status: res.status, latency_ms: latency, detail: `auth rejected (${res.status}) — the Private Integration Token may be expired/revoked.` };
    }
    return { service: svc, status: "degraded", http_status: res.status, latency_ms: latency, detail: `HTTP ${res.status}: ${String(res.error ?? "").slice(0, 180)}` };
  } catch (e) {
    return { service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** LLM provider (underwriting/recommendations): a minimal real completion, so a
 * credit/billing failure (which returns 200 from a models-list but 400/402 from an
 * actual inference) is caught. Reuses the exact provider the platform runs on. */
async function checkLlm(db: SupabaseClient): Promise<CheckResult> {
  const svc = "llm";
  let provider = "?", model = "?";
  try {
    const cfg = await resolveConfig(db);
    provider = cfg.provider; model = cfg.model;
  } catch { /* fall through — callLLM will surface the real error */ }
  const t0 = Date.now();
  try {
    await callLLM(db, { prompt: "ping", maxTokens: 1 });
    return { service: svc, status: "up", http_status: 200, latency_ms: Date.now() - t0, detail: `${provider}/${model} responding.` };
  } catch (e) {
    const latency = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/HTTP (\d{3})/);
    const code = m ? Number(m[1]) : null;
    const lower = msg.toLowerCase();
    const isCredit = /credit|billing|quota|insufficient|balance/.test(lower);
    let status: Status = "down";
    let detail = `${provider}/${model}: ${msg.slice(0, 200)}`;
    if (code === 429 && !isCredit) { status = "degraded"; detail = `${provider}/${model}: rate limited (429).`; }
    else if (code === 402 || isCredit) { status = "down"; detail = `${provider}/${model}: billing/credits — ${msg.slice(0, 180)}`; }
    else if (code === 401 || code === 403) { status = "down"; detail = `${provider}/${model}: auth/key rejected (${code}) — set the key in Admin → Integrations → AI Provider.`; }
    else if (code && code >= 500) { status = "degraded"; detail = `${provider}/${model}: provider error (${code}).`; }
    return { service: svc, status, http_status: code, latency_ms: latency, detail };
  }
}

/** Plaid: an authenticated read against the ACTIVE environment (Limited Production
 * uses production keys). /institutions/get with our client_id+secret proves the keys
 * work — a 400 INVALID_API_KEYS / 401 is a real DOWN, not a TCP-up false positive. */
async function checkPlaid(db: SupabaseClient): Promise<CheckResult> {
  const svc = "plaid";
  const t0 = Date.now();
  try {
    const env = await resolveEnv(db);
    const cfg = await getPlaidConfig(db, env);
    const res = await plaidFetch(cfg, "/institutions/get", { count: 1, offset: 0, country_codes: ["US"] });
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: svc, status: "up", http_status: res.status, latency_ms: latency, detail: `Plaid ${env} responding.` };
    }
    if (res.status === 400 || res.status === 401) {
      return { service: svc, status: "down", http_status: res.status, latency_ms: latency, detail: `auth rejected (${res.errorCode ?? res.status}) — check PLAID_CLIENT_ID / PLAID_SECRET_${env.toUpperCase()} in the vault.` };
    }
    if (res.status >= 500) {
      return { service: svc, status: "degraded", http_status: res.status, latency_ms: latency, detail: `Plaid provider error (${res.status}).` };
    }
    return { service: svc, status: "degraded", http_status: res.status, latency_ms: latency, detail: `HTTP ${res.status}: ${String(res.error ?? "").slice(0, 160)}` };
  } catch (e) {
    return { service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0, detail: `not configured / unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** HotProspector (PowerDialer): the token exchange IS the health signal — a bad
 * uid/key, an expired account, or a dead API all fail it, and a token proves the
 * whole auth chain works. One call decides up/down. If that succeeds we make ONE
 * cheap follow-up (fetchCreditCount) purely for the detail line: dialer credits at
 * zero means calls stop, so the number is worth showing. A failure there never
 * demotes the service — auth already succeeded. */
async function checkHotProspector(db: SupabaseClient): Promise<CheckResult> {
  const svc = "hotprospector";
  const t0 = Date.now();
  try {
    const cfg = await getHotProspectorConfig(db);
    const auth = await hotProspectorToken(cfg);
    const latency = Date.now() - t0;
    if (!auth.ok || !auth.token) {
      const bad401 = auth.status === 401 || auth.status === 403;
      return {
        service: svc,
        status: "down",
        http_status: auth.status,
        latency_ms: latency,
        detail: bad401 || auth.status === 200
          ? `auth rejected (${auth.status}) — check HOTPROSPECTOR_API_UID / HOTPROSPECTOR_API_KEY in the vault. ${auth.error ?? ""}`.trim()
          : `HTTP ${auth.status}: ${auth.error ?? "no access_token returned"}`,
      };
    }

    // Best-effort credit balance. Never changes the up/down verdict.
    let credits: string | null = null;
    try {
      const cr = await hotProspectorRequest<{ response?: string; credits?: string | number }>(auth.token, "fetchCreditCount");
      if (cr.ok && cr.data?.credits != null) credits = String(cr.data.credits);
    } catch { /* detail-only — auth already proved the service is up */ }

    const detail = credits !== null
      ? `authenticated · ${credits} dialer credits.`
      : "authenticated (credit balance unavailable).";
    return { service: svc, status: "up", http_status: auth.status, latency_ms: latency, detail };
  } catch (e) {
    return {
      service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0,
      detail: `not configured / unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** WAVV (the dialer's public API). The key lives in the vault (get_wavv_api_key)
 * and is probed against GET /v3/users. History: every panel-issued key has
 * returned 401 INVALID_API_KEY since 2026-08-17 (trial-plan provisioning —
 * ticket open with WAVV support), so this check exists precisely to notice the
 * moment WAVV flips it on: the row goes green on its own, no code change. */
async function checkWavv(db: SupabaseClient): Promise<CheckResult> {
  const svc = "wavv";
  const t0 = Date.now();
  try {
    const { data: apiKey, error: keyErr } = await db.rpc("get_wavv_api_key");
    if (keyErr) {
      return {
        service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0,
        detail: `vault read failed: ${keyErr.message}`,
      };
    }
    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
      return {
        service: svc, status: "degraded", http_status: null, latency_ms: Date.now() - t0,
        detail: "no API key staged in the vault (get_wavv_api_key returned empty).",
      };
    }
    const res = await fetch("https://api.wavv.com/v3/users", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000),
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      return {
        service: svc, status: "up", http_status: res.status, latency_ms: latency,
        detail: `authenticated (${res.status}) — WAVV API access is LIVE. Setter Performance can sync.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        service: svc, status: "down", http_status: res.status, latency_ms: latency,
        detail: "key rejected (INVALID_API_KEY) — known WAVV provisioning issue; waiting on WAVV support to enable API access for the team.",
      };
    }
    return {
      service: svc, status: "degraded", http_status: res.status, latency_ms: latency,
      detail: `unexpected HTTP ${res.status} from /v3/users.`,
    };
  } catch (e) {
    return {
      service: svc, status: "down", http_status: null, latency_ms: Date.now() - t0,
      detail: `unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** A public site should answer 200. A non-2xx = degraded (reachable, wrong);
 * a network throw/timeout = down (unreachable). */
async function checkSite(service: string, url: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12000) });
    const latency = Date.now() - t0;
    if (res.ok) return { service, status: "up", http_status: res.status, latency_ms: latency, detail: `${res.status} OK (${latency}ms).` };
    return { service, status: "degraded", http_status: res.status, latency_ms: latency, detail: `returned HTTP ${res.status}.` };
  } catch (e) {
    return { service, status: "down", http_status: null, latency_ms: Date.now() - t0, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── Schedule-aware cadence ────────────────────────────────────────────────────
// The old version read only the minute + hour fields, so EVERY weekly job
// ('0 3 * * 0') and the monthly one ('0 9 1 * *') were treated as DAILY and went
// "stalled (overdue)" ~3 days after a perfectly on-time run. That single wrong
// assumption produced 5 of the false-alarm incidents. Parse all five fields.

/** How many values a cron field matches, over its `range` of possible values.
 * Handles `*`, lists, ranges, and steps (`*​/5`, `1-30/2`). */
function fieldCount(field: string, range: number): number {
  if (!field || field === "*") return range;
  let n = 0;
  for (const part of field.split(",")) {
    const [spec, stepRaw] = part.split("/");
    const step = stepRaw ? Math.max(1, parseInt(stepRaw, 10) || 1) : 1;
    let span = 1;
    if (spec === "*" || spec === "") span = range;
    else if (spec.includes("-")) {
      const [a, b] = spec.split("-").map((x) => parseInt(x, 10));
      span = Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, b - a + 1) : 1;
    }
    n += Math.max(1, Math.ceil(span / step));
  }
  return Math.max(1, n);
}

/** Expected minutes between runs, from a full 5-field cron expression.
 * `*​/5 * * * *`→5 · `4,19,34,49 * * * *`→15 · `7 * * * *`→60 · `20 7 * * *`→1440
 * `0 3 * * 0`→10080 (weekly) · `0 9 1 * *`→~43800 (monthly) · `0 9 1 1,4,7,10 *`→~131500 */
function expectedIntervalMin(schedule: string): number {
  const p = schedule.trim().split(/\s+/);
  if (p.length < 5) return 60; // unparseable — assume hourly, the old default
  const [min, hour, dom, mon, dow] = p;

  const runsPerMatchingDay = fieldCount(min, 60) * fieldCount(hour, 24);

  // How many days apart are two matching DAYS? pg_cron/vixie: when both dom and
  // dow are restricted the job runs on EITHER, so take the more frequent one.
  let dayInterval: number;
  const domFree = dom === "*";
  const dowFree = dow === "*";
  if (domFree && dowFree) dayInterval = 1;
  else if (domFree) dayInterval = 7 / fieldCount(dow, 7);
  else if (dowFree) dayInterval = 30.44 / fieldCount(dom, 31);
  else dayInterval = Math.min(7 / fieldCount(dow, 7), 30.44 / fieldCount(dom, 31));

  // A month restriction stretches the gap (quarterly = every 3rd month).
  if (mon !== "*") dayInterval *= 12 / fieldCount(mon, 12);

  return Math.max(1, Math.round((dayInterval * 1440) / runsPerMatchingDay));
}

/** Overdue threshold: generous on fast jobs (one skipped tick must not alarm),
 * proportionally tighter on slow ones. 5-min→25m · hourly→190m · daily→~1.5d
 * · weekly→~10.5d · monthly→~46d. */
function overdueThresholdMin(intervalMin: number): number {
  return intervalMin <= 60 ? intervalMin * 3 + 10 : intervalMin * 1.5 + 60;
}

function humanAge(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)}m`;
  if (minutes < 2880) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

interface CronRow {
  jobname: string;
  schedule: string;
  last_status: string | null;
  last_start: string | null;
  minutes_since_last: number | null;
  last_success_at: string | null;
  minutes_since_success: number | null;
  minutes_since_first_seen: number | null;
  failures_last_hour: number | null;
  window_days: number | null;
}

/** Dead-man switch over pg_cron: any active job that FAILED in the last hour = down;
 * any job that hasn't SUCCEEDED within its own schedule (+ grace) = degraded.
 *
 * Staleness is measured against the last SUCCESSFUL run and against the job's own
 * cadence — a weekly job two days after its Sunday run is healthy, not stalled.
 * A job with no recorded run is only actionable when it should run at least daily;
 * a brand-new weekly/monthly/quarterly job simply hasn't had its turn yet. */
async function checkCron(db: SupabaseClient): Promise<CheckResult> {
  const svc = "cron";
  const t0 = Date.now();
  const { data, error } = await db.rpc("system_cron_health", { p_window_days: 14 });
  const latency = Date.now() - t0;
  if (error) {
    // We could not READ the cron state — that is a blind spot, not evidence that
    // cron is down. Reporting 'down' here is what produced the false outages.
    return { service: svc, status: "degraded", http_status: null, latency_ms: latency, detail: `cron health query failed (probe blind, not a confirmed cron outage): ${error.message}` };
  }
  const rows = (data ?? []) as CronRow[];
  if (!rows.length) return { service: svc, status: "degraded", http_status: null, latency_ms: latency, detail: "no active cron jobs found." };

  const failing = rows.filter((r) => (r.failures_last_hour ?? 0) > 0).map((r) => r.jobname);

  const stalled: string[] = [];
  for (const r of rows) {
    const interval = expectedIntervalMin(r.schedule);
    const threshold = overdueThresholdMin(interval);
    const since = r.minutes_since_success ?? r.minutes_since_last;
    if (since == null) {
      // Never observed. Only meaningful for jobs due at least daily, and only once
      // the job has existed long enough to have had a turn — a job scheduled ten
      // minutes ago is not stalled, it is new.
      const age = r.minutes_since_first_seen ?? 0;
      if (interval <= 1440 && age > threshold) stalled.push(`${r.jobname} (no successful run recorded)`);
      continue;
    }
    if (since > threshold) {
      stalled.push(`${r.jobname} (${humanAge(since)} since success, expects every ${humanAge(interval)})`);
    }
  }

  if (failing.length) {
    return { service: svc, status: "down", http_status: null, latency_ms: latency, detail: `${failing.length} job(s) FAILED in the last hour: ${failing.slice(0, 6).join(", ")}.` };
  }
  if (stalled.length) {
    return { service: svc, status: "degraded", http_status: null, latency_ms: latency, detail: `${stalled.length} job(s) stalled (overdue): ${stalled.slice(0, 4).join("; ")}.` };
  }
  return { service: svc, status: "up", http_status: null, latency_ms: latency, detail: `${rows.length} scheduled job(s) healthy (each within its own schedule).` };
}

/** Pull a single Prometheus gauge value by metric name + a label substring match. */
function promValue(text: string, metric: string, labelMatch?: string): number | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith(metric)) continue;
    if (line.startsWith("# ")) continue;
    if (labelMatch && !line.includes(labelMatch)) continue;
    const val = line.trim().split(/\s+/).pop();
    const n = val ? Number(val) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Supabase egress / usage probe — the reason this whole file exists a second time.
 *
 * On 2026-08-02 the project blew its free-tier egress cap and every REST call + edge
 * function got HTTP 402 "exceed_egress_quota"; the live app was dark until the owner
 * upgraded. We must be warned BEFORE the cap, and catch the restriction the instant
 * it fires. Two signals, in order of reliability:
 *
 *   1. RESTRICTION DETECTOR (always works): a lightweight self-REST call. A 402 means
 *      the project is currently restricted — that IS the outage → down, no ambiguity.
 *   2. USAGE TELEMETRY (best-effort): the Management API's Prometheus metrics expose
 *      real pg_database_size_bytes → we measure DB size vs the Pro 8 GB included disk
 *      and apply the 70/90% thresholds. HONESTY NOTE: the Management API exposes NO
 *      billing-period egress figure (verified live — /usage and /billing/usage 404,
 *      and the openapi spec has no egress endpoint). So egress GB is reported as
 *      "unknown" — never a fake green — while signal #1 still catches the actual 402.
 */
async function checkSupabaseEgress(db: SupabaseClient): Promise<CheckResult> {
  const svc = "supabase-egress";
  const t0 = Date.now();

  // ── Signal 1: is the project restricted RIGHT NOW? A 402 on our own REST API is
  // the exact failure mode we're guarding against. Reachable + not-402 = not capped.
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? `https://${SB_PROJECT_REF}.supabase.co`;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let restricted = false;
  let selfHttp: number | null = null;
  try {
    const r = await fetch(`${supaUrl}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: AbortSignal.timeout(12000),
    });
    selfHttp = r.status;
    await r.body?.cancel();
    if (r.status === 402) restricted = true;
  } catch {
    /* network error here is inconclusive for egress — other probes cover reachability */
  }
  if (restricted) {
    return {
      service: svc, status: "down", http_status: 402, latency_ms: Date.now() - t0,
      detail: "🔴 Egress/usage cap hit — project RESTRICTED (HTTP 402). REST + edge functions are blocked. Upgrade the plan or lift the spend cap in the Supabase dashboard → Billing.",
    };
  }

  // ── Signal 2: real usage telemetry from the Management API (best-effort). ──
  let token = "";
  try {
    const { data } = await db.rpc("get_supabase_mgmt_token");
    if (typeof data === "string") token = data;
  } catch { /* fall through to honest-unknown below */ }

  // Days left in the billing period. The API doesn't expose the billing anchor, so we
  // approximate with the calendar month (Supabase bills monthly) and label it as such.
  const now = new Date();
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const daysLeft = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));

  if (!token) {
    // Not-restricted is a REAL up signal; we just can't show a usage bar. Say so.
    return {
      service: svc, status: "up", http_status: selfHttp, latency_ms: Date.now() - t0,
      detail: `Not restricted (self-REST ${selfHttp ?? "n/a"}). Usage telemetry unavailable — SUPABASE_MGMT_TOKEN missing from vault, so DB size / egress % is unknown. Egress cap detection still active.`,
    };
  }

  try {
    const res = await fetch(
      `${SB_MGMT_BASE}/v1/projects/${SB_PROJECT_REF}/analytics/endpoints/metrics`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    const latency = Date.now() - t0;
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      return { service: svc, status: "degraded", http_status: res.status, latency_ms: latency, detail: `Not restricted, but Management API auth failed (${res.status}) — rotate/refresh SUPABASE_MGMT_TOKEN in the vault. DB size / egress % unknown.` };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { service: svc, status: "up", http_status: selfHttp, latency_ms: latency, detail: `Not restricted (self-REST ${selfHttp ?? "n/a"}). Usage telemetry unavailable — Management API returned ${res.status}. Egress cap detection still active.` };
    }
    const text = await res.text();
    const dbBytes = promValue(text, "pg_database_size_bytes", 'datname="postgres"');
    const dbGb = dbBytes != null ? dbBytes / 1_073_741_824 : null;
    const dbPct = dbGb != null ? (dbGb / PRO_DISK_GB) * 100 : null;

    // Egress GB is genuinely NOT exposed by the Management API — never fake it.
    const egressLine = `egress usage not exposed by Management API (cap-detection covers 402); ~${daysLeft}d left this billing month`;

    if (dbPct == null) {
      return { service: svc, status: "up", http_status: selfHttp, latency_ms: latency, detail: `Not restricted. DB size unreadable from metrics; ${egressLine}.` };
    }

    const dbStr = `DB ${dbGb!.toFixed(2)} GB / ${PRO_DISK_GB} GB (${dbPct.toFixed(1)}%)`;
    let status: Status = "up";
    let head = "🟢";
    if (dbPct > 90) { status = "down"; head = "🔴 DB disk over 90% —"; }
    else if (dbPct >= 70) { status = "degraded"; head = "🟡 DB disk at"; }
    return {
      service: svc, status, http_status: selfHttp, latency_ms: latency,
      detail: `${head} ${dbStr}. Not egress-restricted; ${egressLine}.`,
    };
  } catch (e) {
    return { service: svc, status: "up", http_status: selfHttp, latency_ms: Date.now() - t0, detail: `Not restricted (self-REST ${selfHttp ?? "n/a"}). Usage telemetry unreachable: ${e instanceof Error ? e.message : String(e)}. Egress cap detection still active.` };
  }
}

// ── Friendly labels + "what to do" hints for the alert body ───────────────────
const LABELS: Record<string, string> = {
  "supabase-egress": "Supabase egress / usage cap",
  instantly: "Instantly (email verify / warmup)",
  ghl: "GoHighLevel / VibeReach",
  llm: "AI provider (underwriting / recommendations)",
  plaid: "Plaid (bank connection)",
  hotprospector: "HotProspector (PowerDialer)",
  "site:mfunding.net": "Website (mfunding.net)",
  "site:my.mfunding.net": "Merchant portal (my.mfunding.net)",
  "edge-runtime": "Supabase edge runtime",
  cron: "Scheduled jobs (pg_cron)",
};
function label(service: string): string {
  return LABELS[service] ?? service;
}

interface Transition {
  service: string;
  from: Status | null;
  to: Status;
  detail: string;
}

/** Emit the alert for one transition — GHL email first (owner reads Gmail); if GHL
 * is unavailable, fall back to a kanban_tasks card + an internal message. */
async function sendAlert(
  db: SupabaseClient,
  cfg: GhlConfig | null,
  t: Transition,
): Promise<{ channel: string; ok: boolean; error?: string }> {
  const emoji = t.to === "down" ? "🔴" : t.to === "degraded" ? "🟡" : "🟢";
  const verb = t.to === "up" ? "RECOVERED" : t.to === "down" ? "SYSTEM DOWN" : "DEGRADED";
  const name = label(t.service);
  const subject = `${emoji} ${verb}: ${name}`;
  const html =
    `<p><strong>${emoji} ${verb}: ${name}</strong></p>` +
    `<p>State changed <code>${t.from ?? "n/a"}</code> → <code>${t.to}</code>.</p>` +
    `<p>${t.detail}</p>` +
    (t.to !== "up" ? `<p><em>This is the MFunding System Health monitor. Open /admin/system for the full board.</em></p>` : "");
  const text = `${emoji} ${verb}: ${name}\nState: ${t.from ?? "n/a"} -> ${t.to}\n${t.detail}`;

  // Primary: GHL email to the owner from the company sending domain.
  if (cfg) {
    try {
      const up = await upsertContact(cfg, { email: OWNER_EMAIL, name: "MFunding Owner" });
      const contactId = up.data?.contact?.id;
      if (contactId) {
        const sent = await sendEmailToContact(cfg, contactId, subject, html, { emailFrom: FROM_EMAIL, text });
        if (sent.ok) return { channel: "ghl-email", ok: true };
        console.error("[system-health] GHL email send failed", JSON.stringify({ subject, error: sent.error }));
      }
    } catch (e) {
      console.error("[system-health] GHL email path threw", e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback: kanban card (+ best-effort internal message) so the alert is never lost.
  let ok = false;
  const errors: string[] = [];
  const { error: kErr } = await db.from("kanban_tasks").insert({
    title: subject,
    description: `${text}\n\n(System Health alert — GHL email channel was unavailable, so this card was created instead.)`,
    status: "backlog",
    priority: "high",
    category: "system-health",
  });
  if (kErr) errors.push(`kanban: ${kErr.message}`); else ok = true;

  try {
    const { data: owner } = await db.from("profiles").select("id").eq("email", OWNER_EMAIL).maybeSingle();
    if (owner?.id) {
      const { error: mErr } = await db.from("messages").insert({
        from_user_id: owner.id, to_user_id: owner.id,
        subject, body: text, kind: "system-alert", action_path: "/admin/system",
      });
      if (mErr) errors.push(`message: ${mErr.message}`);
    }
  } catch (e) { errors.push(`message: ${e instanceof Error ? e.message : String(e)}`); }

  return { channel: "fallback(kanban+message)", ok, error: errors.length ? errors.join("; ") : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in admin ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
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
    if (!role || !["admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — admins only" }, 403);
    }
  }

  // GHL config once (used for the checkGhl probe AND the alert email path).
  let cfg: GhlConfig | null = null;
  let cfgErr: string | null = null;
  try { cfg = await getGhlConfig(db); } catch (e) { cfgErr = e instanceof Error ? e.message : String(e); }

  // ── Run every probe (in parallel where independent) ──
  const results: CheckResult[] = [];
  const [instantly, ghl, llm, plaid, hotprospector, wavv, site1, site2, cron, egress] = await Promise.all([
    checkInstantly(db),
    checkGhl(cfg, cfgErr),
    checkLlm(db),
    checkPlaid(db),
    checkHotProspector(db),
    checkWavv(db),
    checkSite("site:mfunding.net", "https://mfunding.net"),
    checkSite("site:my.mfunding.net", "https://my.mfunding.net"),
    checkCron(db),
    checkSupabaseEgress(db),
  ]);
  results.push(instantly, ghl, llm, plaid, hotprospector, wavv, site1, site2, cron, egress);
  // Edge-runtime self-check: if this line runs, the function + its scheduler are alive.
  results.push({ service: "edge-runtime", status: "up", http_status: null, latency_ms: null, detail: `edge function executed at ${new Date().toISOString()}.` });

  // ── Persist checks, reconcile state, collect transitions ──
  const nowIso = new Date().toISOString();
  const transitions: Transition[] = [];

  for (const r of results) {
    const { error: insErr } = await db.from("system_health_checks").insert({
      service: r.service, status: r.status, http_status: r.http_status,
      latency_ms: r.latency_ms, detail: r.detail, checked_at: nowIso,
    });
    if (insErr) console.error("[system-health] check insert failed", r.service, insErr.message);

    const { data: prior } = await db.from("system_health_state").select("status, alerted").eq("service", r.service).maybeSingle();
    const priorStatus = (prior?.status as Status | undefined) ?? null;

    if (priorStatus !== r.status) {
      // Transition: reset the dedup flag; move last_transition_at.
      const { error: upErr } = await db.from("system_health_state").upsert({
        service: r.service, status: r.status, http_status: r.http_status, latency_ms: r.latency_ms,
        detail: r.detail, last_transition_at: nowIso, alerted: false, updated_at: nowIso,
      }, { onConflict: "service" });
      if (upErr) console.error("[system-health] state upsert failed", r.service, upErr.message);

      // Incidents: open on entering a bad state, close on recovery. A bad→bad
      // change (degraded↔down) supersedes the previous incident — close it first,
      // otherwise a flapping service piles up open rows that never resolve.
      if (r.status !== "up") {
        if (priorStatus && priorStatus !== "up") {
          await db.from("system_health_incidents").update({ closed_at: nowIso }).eq("service", r.service).is("closed_at", null);
        }
        await db.from("system_health_incidents").insert({ service: r.service, status: r.status, detail: r.detail, opened_at: nowIso });
      } else if (priorStatus && priorStatus !== "up") {
        await db.from("system_health_incidents").update({ closed_at: nowIso }).eq("service", r.service).is("closed_at", null);
      }

      // Alert on: entering a bad state, or recovering from one. (First-ever 'up' is silent.)
      const worthAlert = r.status !== "up" || (priorStatus !== null && priorStatus !== "up");
      if (worthAlert) transitions.push({ service: r.service, from: priorStatus, to: r.status, detail: r.detail });
    } else {
      // No change: refresh the live fields, keep last_transition_at + alerted.
      const { error: upErr } = await db.from("system_health_state").update({
        http_status: r.http_status, latency_ms: r.latency_ms, detail: r.detail, updated_at: nowIso,
      }).eq("service", r.service);
      if (upErr) console.error("[system-health] state refresh failed", r.service, upErr.message);
    }
  }

  // ── Fire alerts for transitions, then mark them alerted (dedup) ──
  const alerts: Array<{ service: string; to: Status; channel: string; ok: boolean; error?: string }> = [];
  for (const t of transitions) {
    const res = await sendAlert(db, cfg, t);
    alerts.push({ service: t.service, to: t.to, channel: res.channel, ok: res.ok, error: res.error });
    await db.from("system_health_state").update({ alerted: true }).eq("service", t.service);
  }

  // ── Plaid detail section: the UP/DOWN pill answers "is the API reachable"; this
  // answers "is the integration actually usable" (keys, products, OAuth banks,
  // connected items). Reuses the probe result above — no second Plaid call. Never
  // fails the run: on error the section is omitted and the reason reported.
  let plaidSection: PlaidHealth | null = null;
  let plaidSectionError: string | null = null;
  try {
    plaidSection = await buildPlaidHealth(db, plaid.status === "up");
  } catch (e) {
    plaidSectionError = e instanceof Error ? e.message : String(e);
    console.error("[system-health] plaid section failed", plaidSectionError);
  }

  const summary = results.map((r) => ({ service: r.service, status: r.status, http_status: r.http_status, latency_ms: r.latency_ms, detail: r.detail }));
  const down = summary.filter((s) => s.status === "down").map((s) => s.service);
  const degraded = summary.filter((s) => s.status === "degraded").map((s) => s.service);

  return json({
    ok: true,
    checked_at: nowIso,
    services: summary,
    down,
    degraded,
    transitions: transitions.map((t) => ({ service: t.service, from: t.from, to: t.to })),
    alerts,
    plaid: plaidSection,
    ...(plaidSectionError ? { plaid_error: plaidSectionError } : {}),
  });
});
