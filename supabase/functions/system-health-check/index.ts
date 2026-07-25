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

const OWNER_EMAIL = "socrates73@gmail.com";
const FROM_EMAIL = "sales@send.mfunding.net"; // company dedicated sending domain
const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

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

/** Rough expected cadence (minutes) from a cron minute/hour field, for staleness. */
function expectedIntervalMin(schedule: string): number {
  const parts = schedule.trim().split(/\s+/);
  const min = parts[0] ?? "*";
  const hour = parts[1] ?? "*";
  if (min.startsWith("*/")) return Math.max(1, parseInt(min.slice(2), 10) || 5);
  if (min.includes(",")) return Math.max(1, Math.round(60 / min.split(",").length));
  // fixed minute: hourly if hour is wildcard, else daily.
  if (hour === "*") return 60;
  return 1440;
}

interface CronRow {
  jobname: string;
  schedule: string;
  last_status: string | null;
  last_start: string | null;
  minutes_since_last: number | null;
  failures_last_hour: number | null;
}

/** Dead-man switch over pg_cron: any active job that FAILED in the last hour = down;
 * any job that hasn't run in >3× its cadence (with slack) = degraded (stalled). */
async function checkCron(db: SupabaseClient): Promise<CheckResult> {
  const svc = "cron";
  const { data, error } = await db.rpc("system_cron_health");
  if (error) return { service: svc, status: "down", http_status: null, latency_ms: null, detail: `cron health query failed: ${error.message}` };
  const rows = (data ?? []) as CronRow[];
  if (!rows.length) return { service: svc, status: "degraded", http_status: null, latency_ms: null, detail: "no active cron jobs found." };

  const failing = rows.filter((r) => (r.failures_last_hour ?? 0) > 0).map((r) => r.jobname);
  const stalled = rows.filter((r) => {
    const exp = expectedIntervalMin(r.schedule);
    const since = r.minutes_since_last;
    // Never ran at all, or way overdue. Slack: 3× cadence + 10 min.
    if (since == null) return true;
    return since > exp * 3 + 10;
  }).map((r) => r.jobname);

  if (failing.length) {
    return { service: svc, status: "down", http_status: null, latency_ms: null, detail: `${failing.length} job(s) FAILED in the last hour: ${failing.slice(0, 6).join(", ")}.` };
  }
  if (stalled.length) {
    return { service: svc, status: "degraded", http_status: null, latency_ms: null, detail: `${stalled.length} job(s) stalled (overdue): ${stalled.slice(0, 6).join(", ")}.` };
  }
  return { service: svc, status: "up", http_status: null, latency_ms: null, detail: `${rows.length} scheduled job(s) healthy.` };
}

// ── Friendly labels + "what to do" hints for the alert body ───────────────────
const LABELS: Record<string, string> = {
  instantly: "Instantly (email verify / warmup)",
  ghl: "GoHighLevel / VibeReach",
  llm: "AI provider (underwriting / recommendations)",
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
  const [instantly, ghl, llm, site1, site2, cron] = await Promise.all([
    checkInstantly(db),
    checkGhl(cfg, cfgErr),
    checkLlm(db),
    checkSite("site:mfunding.net", "https://mfunding.net"),
    checkSite("site:my.mfunding.net", "https://my.mfunding.net"),
    checkCron(db),
  ]);
  results.push(instantly, ghl, llm, site1, site2, cron);
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

      // Incidents: open on entering a bad state, close on recovery.
      if (r.status !== "up") {
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
  });
});
