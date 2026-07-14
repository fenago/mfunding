// synergy-reconcile — the safety net that guarantees no vendor lead is silently dropped.
//
// WHY THIS EXISTS (real incident, 2026-07-13): a parser bug made live-transfer-intake
// reject inbound lead emails. THREE Synergy leads arrived; only TWO became deals. The
// third (Detroit Mobile Car Repair LLC, $50K, FICO 710) surfaced only because the owner
// happened to look at the GHL inbox and asked "are we missing a lead?". Nothing in the
// system compared "lead emails received" against "deals created" — so an intake failure
// at 2am would have parked an alert in an unread inbox and the lead would have died.
//
// WHAT IT DOES (every 2 minutes, via pg_cron job `synergy-reconcile-2min`):
//   0. SCREAMS IF THE PIPE LOOKS DEAD. Two conditions, both of which used to be
//      indistinguishable from "all clean": no vendor robot contacts discoverable at all
//      (renamed sender? revoked token? vendor moved domain?), and no lead seen in hours
//      during business hours. Silence is the most dangerous state a paid lead pipe can be
//      in — a sweep that finds nothing must not report success.
//   1. Discovers the vendor "robot" contacts in GHL — the senders that deliver leads —
//      by TRUSTED_DELIVERY_DOMAINS and by the `lt-source` tag that live-transfer-intake
//      self-heals onto every new trusted sender. Nothing is hardcoded to one contact id.
//   2. Lists their INBOUND email records from the last N hours (default 48).
//   3. Keeps the ones that LOOK LIKE A LEAD — same markers the intake uses (a
//      "Live Transfer" subject, or the vendor's label table in the body).
//   4. Compares each against synergy_intake_log by GHL email-record id:
//        • no row              → the webhook never fired / errored → NEVER PROCESSED
//        • outcome=rejected    → parsed but dropped (the July 13 failure mode)
//        • outcome=ignored     → the intake decided it wasn't a lead. If it LOOKS like a
//                                lead to us, that judgement is suspect → re-drive it.
//        • do_not_recover=true → a HUMAN said "this is not a lead, stop". Obeyed: never
//                                re-driven, never alerted. This is the only terminal
//                                state. (It replaces a prose convention in reject_reason
//                                that no code read — those rows only stopped being
//                                re-driven by aging out of the 48h window.)
//        • created/deduped     → accounted for, nothing to do
//   5. AUTO-RECOVERS every gap by re-driving live-transfer-intake against THAT SPECIFIC
//      email (?email_record_id=…). A merchant that already has a deal comes back
//      "deduped" — safe, never a duplicate.
//   6. Anything it still can't recover is marked 'unprocessed' and named in ONE digest
//      email to the owner. Silence when everything is clean; no per-lead spam; a
//      cooldown so an item that needs a human doesn't re-alert 96 times a day.
//
// Auth (mirrors funder-reply-reconcile):
//   • Trusted cron  → ?secret=<GHL webhook secret> (+ anon key Bearer for the gateway).
//   • Staff UI/curl → user JWT with closer/admin/super_admin. A service-role bearer is
//     NOT a session and deliberately fails the role check — use the cron path.
//
// Compliance: internal observability only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, upsertContact, sendEmailToContact,
  type GhlConfig,
} from "../_shared/ghl.ts";

// ── Config — MUST stay in step with live-transfer-intake ─────────────────────
const TRUSTED_DELIVERY_DOMAINS = ["double-verified.com"];
const SENDER_ADOPT_TAG = "lt-source";
const LIVE_TRANSFER_SUBJECT_MARKER = "live transfer";
// The vendor's label table. Same regex the intake uses to decide "this had lead
// structure" — do not invent a second, drifting definition of "looks like a lead".
const LEAD_BODY_MARKERS = /requested amount|company name|select the company|contact name|deposit per month/i;

const DEFAULT_WINDOW_HOURS = 48;
// Don't re-alert on the same unrecoverable email more often than this.
const ALERT_COOLDOWN_HOURS = 6;

// ── "THE LEAD PIPE IS DEAD" thresholds ───────────────────────────────────────
// How long we tolerate hearing NOTHING from the vendor during business hours before
// treating silence as a fault. Synergy delivers many leads a day; six business hours of
// total silence is not a quiet patch, it is a symptom (vendor stopped sending, sender
// domain changed, GHL token revoked, workflow disabled, our ignore-gate eating them).
const LEAD_SILENCE_ALERT_HOURS = 6;
// Business hours, America/New_York — outside them, silence is just night, and the owner
// should not be woken up for it. The heartbeat only fires inside this window.
const BUSINESS_START_HOUR_ET = 8;
const BUSINESS_END_HOUR_ET = 20;
// Pipe-level alerts are about a CONDITION, not an item, so they cool down by kind.
// Without this, a 2-minute cron would email 720 times a day about one outage.
const PIPE_ALERT_COOLDOWN_HOURS = 2;
// A deal that no closer owns is a lead nobody is accountable for.
const ORPHAN_LOOKBACK_HOURS = 24;

const TEAM_ALERT_TO = "socrates73@gmail.com";
const TEAM_ALERT_CC = ["cmarq2k8@gmail.com"];
const ADMIN_URL = "https://mfunding.net/admin/deals";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const emailDomain = (addr: string): string => {
  const m = String(addr).toLowerCase().match(/@\s*([a-z0-9.-]+)/);
  return m ? m[1].replace(/[.>)\s]+$/, "") : "";
};
const isTrustedDomain = (addr: string): boolean => {
  const d = emailDomain(addr);
  return !!d && TRUSTED_DELIVERY_DOMAINS.some((t) => d === t || d.endsWith(`.${t}`));
};

// GHL rate-limits hard (429s, and 403s under burst). Back off and retry rather than
// reporting a false "no emails found" — a false negative here is a lost lead.
async function ghlRetry<T>(
  fn: () => Promise<{ ok: boolean; status: number; data: T | null; error?: string }>,
  label: string,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  let last: { ok: boolean; status: number; data: T | null; error?: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
    last = await fn();
    if (last.ok) return last;
    if (last.status !== 429 && last.status !== 403 && last.status < 500) break;
  }
  console.error(`synergy-reconcile: GHL ${label} failed`, { status: last?.status, error: last?.error });
  return { ok: false, data: null, error: last?.error ?? "GHL request failed" };
}

/** Are we inside the hours when leads SHOULD be arriving? Silence at 3am is just night. */
function isBusinessHoursET(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hour12: false, weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= BUSINESS_START_HOUR_ET && hour < BUSINESS_END_HOUR_ET;
}

/** PIPE-LEVEL ALARM — "the thing that brings us leads may be broken."
 *
 *  This is deliberately a real email, not a console.error. A console.error in an edge
 *  function is seen by nobody: the zero-robot branch used to log one and return
 *  `ok:false` to a pg_cron caller that discards the response, so a dead lead pipe was
 *  indistinguishable from a quiet afternoon. The owner would find out days later when
 *  deals stopped arriving.
 *
 *  Cooled down by KIND (ops_alert_state), so an outage is one email every couple of
 *  hours, not one every two minutes. */
async function sendPipeAlert(
  db: SupabaseClient, cfg: GhlConfig | null,
  alertKey: string, headline: string, bodyLines: string[], detail: string,
): Promise<{ sent: boolean; suppressed: boolean; error?: string }> {
  const cutoff = new Date(Date.now() - PIPE_ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data: prior } = await db.from("ops_alert_state")
    .select("last_alert_at, fire_count").eq("alert_key", alertKey).maybeSingle();
  if (prior?.last_alert_at && String(prior.last_alert_at) > cutoff) {
    return { sent: false, suppressed: true };
  }
  if (!cfg) return { sent: false, suppressed: false, error: "GHL not configured — cannot send pipe alert" };

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
<div style="background:#dc2626;color:#fff;font-size:16px;font-weight:700;padding:12px 16px;border-radius:8px 8px 0 0">🚨 ${esc(headline)}</div>
<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:16px">
${bodyLines.map((l) => `<p style="margin:0 0 10px;font-size:14px;color:#0f172a">${l}</p>`).join("")}
<p style="margin:14px 0 0"><a href="${ADMIN_URL}" style="background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open Deals →</a></p>
</div></div>`;
  const text = `${headline}\n\n${bodyLines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n\n")}\n\n${ADMIN_URL}`;

  let sent = false;
  let error: string | undefined;
  try {
    const alert = await upsertContact(cfg, { email: TEAM_ALERT_TO, tags: ["internal-alerts"], source: "Synergy Reconcile" });
    const alertContactId = alert.data?.contact?.id;
    if (!alertContactId) throw new Error(alert.error || "no alert contact id");
    const sr = await sendEmailToContact(cfg, alertContactId, `🚨 ${headline}`, html, { text, emailCc: TEAM_ALERT_CC });
    sent = sr.ok;
    if (!sr.ok) error = sr.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (!sent) console.error("synergy-reconcile: PIPE ALERT SEND FAILED", { alertKey, headline, error });

  // Stamp the cooldown only on a successful send — a failed send must be retried on the
  // next sweep, not silenced for two hours.
  if (sent) {
    await db.from("ops_alert_state").upsert({
      alert_key: alertKey,
      last_alert_at: new Date().toISOString(),
      last_detail: detail.slice(0, 500),
      fire_count: (prior?.fire_count as number | undefined ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "alert_key" });
  }
  return { sent, suppressed: false, error };
}

interface RobotContact { id: string; email: string }

/** Discover the vendor lead-delivery robots: contacts on a trusted delivery domain
 *  and/or carrying the lt-source tag the intake stamps on them. Never hardcoded. */
async function discoverRobots(cfg: GhlConfig): Promise<RobotContact[]> {
  const found = new Map<string, RobotContact>();
  const add = (c: Record<string, unknown>) => {
    const id = String(c.id ?? "");
    const email = String(c.email ?? "");
    if (id) found.set(id, { id, email });
  };

  // (a) by trusted delivery domain
  for (const domain of TRUSTED_DELIVERY_DOMAINS) {
    const r = await ghlRetry<{ contacts?: Array<Record<string, unknown>> }>(
      () => ghlFetch(cfg, "POST", "/contacts/search", { locationId: cfg.locationId, pageLimit: 50, query: domain }),
      `contact search (${domain})`,
    );
    for (const c of r.data?.contacts ?? []) {
      if (isTrustedDomain(String(c.email ?? ""))) add(c);
    }
  }

  // (b) by the self-heal tag — catches a sender whose domain was added to the list
  // later, or a vendor domain that search misses.
  const t = await ghlRetry<{ contacts?: Array<Record<string, unknown>> }>(
    () => ghlFetch(cfg, "POST", "/contacts/search", {
      locationId: cfg.locationId, pageLimit: 50,
      filters: [{ field: "tags", operator: "eq", value: SENDER_ADOPT_TAG }],
    }),
    `contact search (tag ${SENDER_ADOPT_TAG})`,
  );
  for (const c of t.data?.contacts ?? []) add(c);

  return [...found.values()];
}

interface InboundEmail {
  recordId: string;
  conversationId: string;
  contactId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;   // ISO
}

/** Every INBOUND email record on a robot contact's conversations inside the window.
 *  Inbound-ness is judged on the EMAIL RECORD's direction — the conversation
 *  message's `direction` is frequently null on these threads and cannot be trusted. */
async function inboundEmailsFor(
  cfg: GhlConfig, contactId: string, sinceMs: number,
): Promise<InboundEmail[]> {
  const convs = await ghlRetry<{ conversations?: Array<{ id: string }> }>(
    () => ghlFetch(cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`),
    "conversation search",
  );
  const out: InboundEmail[] = [];
  for (const conv of convs.data?.conversations ?? []) {
    const msgs = await ghlRetry<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
      () => ghlFetch(cfg, "GET", `/conversations/${conv.id}/messages?limit=100`),
      "conversation messages",
    );
    for (const m of msgs.data?.messages?.messages ?? []) {
      if (!/email/i.test(String(m.messageType ?? ""))) continue;
      const added = Date.parse(String(m.dateAdded ?? ""));
      if (Number.isFinite(added) && added < sinceMs) continue;   // outside the window
      const recIds = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
      for (const recId of recIds) {
        const e = await ghlRetry<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
          () => ghlFetch(cfg, "GET", `/conversations/messages/email/${recId}`),
          `email record ${recId}`,
        );
        const em = (e.data?.emailMessage ?? e.data ?? {}) as Record<string, unknown>;
        if (!em || !em.id) continue;
        if (String(em.direction ?? "").toLowerCase() !== "inbound") continue;
        const ts = Date.parse(String(em.dateAdded ?? ""));
        if (Number.isFinite(ts) && ts < sinceMs) continue;
        out.push({
          recordId: String(em.id),
          conversationId: String(em.conversationId ?? conv.id),
          contactId: String(em.contactId ?? contactId),
          from: String(em.from ?? ""),
          subject: String(em.subject ?? ""),
          body: String(em.body ?? ""),
          receivedAt: new Date(Number.isFinite(ts) ? ts : Date.now()).toISOString(),
        });
      }
    }
  }
  return out;
}

/** Same test the intake applies: a "Live Transfer" subject, or the vendor's label
 *  table in the body. Anything else from the robot (a human reply, a bounce) is not
 *  a lead and must not be chased. */
function looksLikeLead(e: InboundEmail): boolean {
  if (e.subject.toLowerCase().includes(LIVE_TRANSFER_SUBJECT_MARKER)) return true;
  return LEAD_BODY_MARKERS.test(e.body);
}

/** Best-effort merchant label for the digest: the vendor puts it in the subject
 *  ("Live Transfer! (347) 898-6709 - Popular Contracting USA"). Split on the SPACED
 *  dash — the phone number's own hyphen has no spaces, so it isn't a separator. */
function merchantFromSubject(subject: string): string {
  const parts = subject.split(/\s+[-–—]\s+/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : subject;
  return tail.trim() || "(unknown merchant)";
}

interface Detail {
  emailRecordId: string;
  merchant: string;
  subject: string;
  receivedAt: string;
  state: "ok" | "recovered" | "still_missing";
  priorOutcome: string;         // "none" | "rejected" | …
  outcome?: string;             // what the re-drive produced
  dealNumber?: string | null;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
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
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron may POST no body */ }
  const windowHours = Number(payload.hours ?? url.searchParams.get("hours") ?? DEFAULT_WINDOW_HOURS) || DEFAULT_WINDOW_HOURS;
  // dryRun: report gaps, recover NOTHING, alert NOTHING. For inspection only.
  const dryRun = payload.dry_run === true || url.searchParams.get("dry_run") === "true";
  const sinceMs = Date.now() - windowHours * 3600 * 1000;

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  const intakeSecret = (gc?.live_transfer_secret as string | undefined) ?? Deno.env.get("LIVE_TRANSFER_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  // ── SELF-TEST — prove the alarm still works without breaking the pipe ──
  // A "the lead pipe is dead" alert is, by design, something you almost never see. That
  // makes it exactly the kind of alarm that quietly rots (send domain changes, alert
  // contact deleted, GHL token scope drifts) and is discovered to be broken on the one
  // day it matters. `?selftest=pipe` sends the real alert through the real path, clearly
  // labelled, ignoring cooldown. Staff/cron-gated like everything else here.
  if (url.searchParams.get("selftest") === "pipe") {
    const r = await sendPipeAlert(
      db, cfg, `synergy:selftest:${Date.now()}`,
      "SELF-TEST — this is what a DEAD LEAD PIPE alert looks like",
      [
        "<b>Nothing is wrong.</b> Somebody ran the alarm self-test. If you are reading this, the pipe-down alert path is working end to end.",
        `A real one fires when: (a) the sweep can find <b>no vendor lead senders at all</b> in GHL, or (b) <b>no lead has arrived in ${LEAD_SILENCE_ALERT_HOURS}+ hours during business hours</b> (${BUSINESS_START_HOUR_ET}:00–${BUSINESS_END_HOUR_ET}:00 ET, Mon–Fri), or (c) deals exist with <b>no closer assigned</b>.`,
        `Real alerts repeat at most once every ${PIPE_ALERT_COOLDOWN_HOURS}h per condition.`,
      ],
      "self-test",
    );
    return json({ ok: true, selftest: "pipe", alertSent: r.sent, alertError: r.error });
  }

  // ── 1. Discover the robots ──
  const robots = await discoverRobots(cfg);
  if (!robots.length) {
    // ZERO ROBOTS IS NOT "NOTHING TO DO" — IT IS "THE LEAD PIPE MAY BE DEAD".
    //
    // We discover senders ONLY by trusted delivery domain or the lt-source tag (which is
    // itself only ever applied to trusted-domain senders). So the exact scenario that
    // breaks lead intake — the vendor starts sending from a domain we don't trust — ALSO
    // makes this sweep find nothing. It used to console.error and return ok:false to a
    // pg_cron caller that throws the response away. Nobody would ever see it.
    //
    // This is the single most dangerous state in the system, so it now emails a human.
    const detail = `domains=${TRUSTED_DELIVERY_DOMAINS.join(",")} tag=${SENDER_ADOPT_TAG}`;
    console.error("synergy-reconcile: NO vendor robot contacts discovered", { domains: TRUSTED_DELIVERY_DOMAINS });
    const pa = await sendPipeAlert(
      db, cfg, "synergy:no_robots",
      "LEAD PIPE MAY BE DEAD — no vendor lead senders found in GHL",
      [
        "The reconciliation sweep could not find <b>a single vendor lead-delivery contact</b> in GHL. It searched the trusted delivery domains and the <code>lt-source</code> tag, and both came back empty.",
        "That means we currently <b>cannot see incoming leads at all</b>, and this sweep — the safety net that is supposed to catch dropped leads — is blind. Every paid lead arriving right now could be dropped without a trace.",
        "<b>Likely causes:</b> Synergy started sending from a new domain (add it to <code>TRUSTED_DELIVERY_DOMAINS</code> in BOTH <code>live-transfer-intake</code> and <code>synergy-reconcile</code>); the GHL API token was revoked; or the sender contact was deleted/merged in GHL.",
        `<b>Checked:</b> ${esc(detail)}`,
      ],
      detail,
    );
    return json({
      ok: false,
      error: "no vendor lead-delivery contacts found in GHL (domain search + lt-source tag both empty)",
      pipeAlertSent: pa.sent, pipeAlertSuppressed: pa.suppressed, pipeAlertError: pa.error,
      checked: 0, okCount: 0, recovered: 0, stillMissing: 0, details: [],
    }, 200);
  }

  // ── 2–3. Inbound lead emails in the window ──
  const leadEmails: InboundEmail[] = [];
  for (const r of robots) {
    const emails = await inboundEmailsFor(cfg, r.id, sinceMs);
    for (const e of emails) if (looksLikeLead(e)) leadEmails.push(e);
  }

  // ── 4. Compare against the ledger ──
  const ids = leadEmails.map((e) => e.recordId);
  const logByeId = new Map<string, Record<string, unknown>>();
  if (ids.length) {
    const { data: rows, error } = await db.from("synergy_intake_log")
      .select("*").in("ghl_email_record_id", ids);
    if (error) return json({ error: `could not read synergy_intake_log: ${error.message}` }, 500);
    for (const row of rows ?? []) logByeId.set(row.ghl_email_record_id as string, row);
  }

  const details: Detail[] = [];
  const gaps: Array<{ email: InboundEmail; priorOutcome: string; row: Record<string, unknown> | undefined }> = [];

  let permanentlyIgnored = 0;
  for (const e of leadEmails) {
    const row = logByeId.get(e.recordId);
    const outcome = (row?.outcome as string | undefined) ?? "";
    // A HUMAN SAID STOP. Obey it — no re-drive, no alert, ever. This is the escape hatch
    // that makes the rest of the sweep safe to be aggressive: because a genuine non-lead
    // can be silenced for good, everything else can be chased hard.
    if (row?.do_not_recover === true || outcome === "ignored_permanent") {
      permanentlyIgnored++;
      details.push({
        emailRecordId: e.recordId, merchant: merchantFromSubject(e.subject), subject: e.subject,
        receivedAt: e.receivedAt, state: "ok", priorOutcome: "ignored_permanent (do_not_recover)",
      });
      continue;
    }
    if (outcome === "created" || outcome === "deduped") {
      details.push({
        emailRecordId: e.recordId, merchant: merchantFromSubject(e.subject), subject: e.subject,
        receivedAt: e.receivedAt, state: "ok", priorOutcome: outcome,
      });
      continue;
    }
    gaps.push({ email: e, priorOutcome: row ? outcome : "none", row });
  }

  // ── 5. Auto-recover every gap by re-driving the intake on THAT email ──
  let recovered = 0;
  const stillMissing: Detail[] = [];

  for (const g of gaps) {
    const e = g.email;
    const base: Detail = {
      emailRecordId: e.recordId, merchant: merchantFromSubject(e.subject), subject: e.subject,
      receivedAt: e.receivedAt, state: "still_missing", priorOutcome: g.priorOutcome,
    };

    if (dryRun) {
      base.reason = "dry run — no recovery attempted";
      details.push(base);
      stillMissing.push(base);
      continue;
    }

    let result: Record<string, unknown> | null = null;
    let httpErr = "";
    if (!intakeSecret || !supabaseUrl) {
      httpErr = "live-transfer-intake secret / SUPABASE_URL unavailable";
    } else {
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/live-transfer-intake?secret=${encodeURIComponent(intakeSecret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email_record_id: e.recordId,
              conversationId: e.conversationId,
              contactId: e.contactId,
              source: "synergy-reconcile",
            }),
          },
        );
        const txt = await res.text();
        try { result = JSON.parse(txt) as Record<string, unknown>; }
        catch { httpErr = `intake returned non-JSON (${res.status}): ${txt.slice(0, 200)}`; }
        if (result && !res.ok) httpErr = `intake HTTP ${res.status}: ${String(result.error ?? "")}`;
      } catch (err) {
        httpErr = err instanceof Error ? err.message : String(err);
      }
    }

    const created = Boolean(result?.ok) && result?.rejected !== true && result?.ignored !== true && Boolean(result?.dealId);
    if (created) {
      recovered++;
      const outcome = result?.deduped === true ? "deduped" : "created";
      await db.from("synergy_intake_log").update({
        recovered_at: new Date().toISOString(),
        notes: `Recovered by synergy-reconcile (${outcome}) — the intake webhook had not produced a deal for this email.`,
      }).eq("ghl_email_record_id", e.recordId);
      details.push({
        ...base, state: "recovered", outcome,
        dealNumber: (result?.dealNumber as string | null) ?? null,
      });
    } else {
      const reason = httpErr ||
        String(result?.reason ?? result?.error ?? "intake did not create a deal");
      // Mark it unprocessed so it stays visible even if the ledger row never existed.
      await db.from("synergy_intake_log").upsert({
        ghl_email_record_id: e.recordId,
        ghl_conversation_id: e.conversationId,
        ghl_contact_id: e.contactId,
        from_email: e.from,
        subject: e.subject,
        received_at: e.receivedAt,
        outcome: "unprocessed",
        reject_reason: reason.slice(0, 500),
        notes: "synergy-reconcile could not auto-recover this lead — NEEDS A HUMAN.",
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_email_record_id" });
      const d: Detail = { ...base, reason };
      details.push(d);
      stillMissing.push(d);
    }
  }

  // ── 6. ONE digest — only when something was recovered or is still missing ──
  const recoveredDetails = details.filter((d) => d.state === "recovered");
  // Alert cooldown: an unrecoverable item re-alerts at most every ALERT_COOLDOWN_HOURS.
  const cooled: Detail[] = [];
  if (stillMissing.length && !dryRun) {
    const { data: rows } = await db.from("synergy_intake_log")
      .select("ghl_email_record_id, last_alert_at")
      .in("ghl_email_record_id", stillMissing.map((d) => d.emailRecordId));
    const lastById = new Map((rows ?? []).map((r) => [r.ghl_email_record_id as string, r.last_alert_at as string | null]));
    const cutoff = Date.now() - ALERT_COOLDOWN_HOURS * 3600 * 1000;
    for (const d of stillMissing) {
      const last = lastById.get(d.emailRecordId);
      if (!last || Date.parse(last) < cutoff) cooled.push(d);
    }
  }

  let alertSent = false;
  let alertError: string | undefined;
  const shouldAlert = !dryRun && (recoveredDetails.length > 0 || cooled.length > 0);
  if (shouldAlert) {
    const rowHtml = (d: Detail, tone: string) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#0f172a;font-weight:700">${esc(d.merchant)}</td>
        <td style="padding:6px 12px 6px 0;color:#475569">${esc(d.subject)}</td>
        <td style="padding:6px 12px 6px 0;color:#475569;white-space:nowrap">${esc(new Date(d.receivedAt).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET</td>
        <td style="padding:6px 0;color:${tone};font-weight:700">${
      d.state === "recovered"
        ? `RECOVERED${d.dealNumber ? ` → ${esc(d.dealNumber)}` : ""}${d.outcome === "deduped" ? " (already had a deal)" : ""}`
        : `NEEDS A HUMAN — ${esc(d.reason ?? "unknown")}`
    }</td>
      </tr>`;
    const table = (title: string, list: Detail[], tone: string) =>
      list.length
        ? `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:#0f172a">${title}</p>
           <table style="font-size:13px;border-collapse:collapse;width:100%">${list.map((d) => rowHtml(d, tone)).join("")}</table>`
        : "";
    const headline = cooled.length
      ? `${cooled.length} lead${cooled.length === 1 ? "" : "s"} could NOT be recovered`
      : `${recoveredDetails.length} dropped lead${recoveredDetails.length === 1 ? "" : "s"} auto-recovered`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px">
<div style="background:${cooled.length ? "#dc2626" : "#b45309"};color:#fff;font-size:16px;font-weight:700;padding:12px 16px;border-radius:8px 8px 0 0">🛟 SYNERGY RECONCILIATION — ${esc(headline.toUpperCase())}</div>
<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:16px">
<p style="margin:0 0 8px;font-size:14px;color:#0f172a">Swept the last ${windowHours}h of vendor lead emails: <b>${leadEmails.length}</b> checked, <b>${details.filter((d) => d.state === "ok").length}</b> already accounted for.</p>
${table("Auto-recovered (a deal now exists)", recoveredDetails, "#15803d")}
${table("STILL MISSING — no deal exists, intake could not recover it", cooled, "#dc2626")}
<p style="margin:14px 0 0"><a href="${ADMIN_URL}" style="background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open Deals →</a></p>
</div></div>`;
    const text = [
      `SYNERGY RECONCILIATION — ${headline}`,
      `Window: last ${windowHours}h · checked ${leadEmails.length} · ok ${details.filter((d) => d.state === "ok").length}`,
      "",
      ...recoveredDetails.map((d) => `RECOVERED: ${d.merchant} — "${d.subject}" (${d.receivedAt})${d.dealNumber ? ` → ${d.dealNumber}` : ""}`),
      ...cooled.map((d) => `NEEDS A HUMAN: ${d.merchant} — "${d.subject}" (${d.receivedAt}) — ${d.reason}`),
    ].join("\n");

    try {
      const alert = await upsertContact(cfg, { email: TEAM_ALERT_TO, tags: ["internal-alerts"], source: "Synergy Reconcile" });
      const alertContactId = alert.data?.contact?.id;
      if (!alertContactId) throw new Error(alert.error || "no alert contact id");
      const sr = await sendEmailToContact(
        cfg, alertContactId,
        `${cooled.length ? "🚨" : "🛟"} Synergy reconciliation — ${headline}`,
        html, { text, emailCc: TEAM_ALERT_CC },
      );
      alertSent = sr.ok;
      if (!sr.ok) alertError = sr.error;
    } catch (e) {
      alertError = e instanceof Error ? e.message : String(e);
    }
    if (!alertSent) console.error("synergy-reconcile: digest send failed", { alertError });

    if (cooled.length) {
      await db.from("synergy_intake_log")
        .update({ last_alert_at: new Date().toISOString() })
        .in("ghl_email_record_id", cooled.map((d) => d.emailRecordId));
    }
  }

  // ── 7. HEARTBEAT — "we have leads coming in" is not the same as "nothing is broken" ──
  //
  // Everything above only looks at emails we CAN see. If the vendor stops sending, or
  // starts sending somewhere we aren't looking, this sweep happily reports `ok: true,
  // checked: 0` forever. Total silence during business hours is the tell.
  let silenceAlert: { sent: boolean; suppressed: boolean; error?: string } | null = null;
  let hoursSinceLastLead: number | null = null;
  if (!dryRun) {
    const { data: lastLead } = await db.from("synergy_intake_log")
      .select("received_at")
      .in("outcome", ["created", "deduped"])
      .order("received_at", { ascending: false })
      .limit(1).maybeSingle();
    const lastMs = lastLead?.received_at ? Date.parse(String(lastLead.received_at)) : NaN;
    hoursSinceLastLead = Number.isFinite(lastMs)
      ? Math.round(((Date.now() - lastMs) / 3600_000) * 10) / 10
      : null;

    const silent = hoursSinceLastLead === null || hoursSinceLastLead >= LEAD_SILENCE_ALERT_HOURS;
    if (silent && isBusinessHoursET()) {
      const since = hoursSinceLastLead === null
        ? "never (no lead has EVER been recorded in the ledger)"
        : `${hoursSinceLastLead}h ago`;
      silenceAlert = await sendPipeAlert(
        db, cfg, "synergy:no_leads",
        `NO LEADS IN ${LEAD_SILENCE_ALERT_HOURS}+ HOURS — the pipe may be dead`,
        [
          `We are inside business hours and the last lead that actually became a deal arrived <b>${esc(since)}</b>. We pay per lead; this much silence is a symptom, not a quiet patch.`,
          "<b>Check, in order:</b> (1) is Synergy still sending — look at the GHL inbox directly; (2) did the sender address/domain change (the intake would be IGNORING them — look for <code>outcome='ignored'</code> rows in <code>synergy_intake_log</code>); (3) is the GHL 'LT Intake' workflow still enabled; (4) is the GHL API token still valid.",
          `<b>This sweep:</b> ${robots.length} sender robot(s) visible, ${leadEmails.length} lead email(s) in the last ${windowHours}h.`,
        ],
        `hoursSinceLastLead=${hoursSinceLastLead ?? "never"} robots=${robots.length} leadEmails=${leadEmails.length}`,
      );
    }
  }

  // ── 8. ORPHANS — a lead nobody owns is a lead nobody calls ──
  // Auto-assignment can silently produce an unassigned deal (the trigger swallows every
  // error). Closers can now SEE and CLAIM unassigned deals, but nobody is ACCOUNTABLE for
  // one, so it still gets named out loud.
  let orphanAlert: { sent: boolean; suppressed: boolean; error?: string } | null = null;
  let orphanCount = 0;
  if (!dryRun) {
    const orphanSince = new Date(Date.now() - ORPHAN_LOOKBACK_HOURS * 3600 * 1000).toISOString();
    const { data: orphans } = await db.from("deals")
      .select("id, deal_number, created_at, lead_source")
      .is("assigned_closer_id", null)
      .gte("created_at", orphanSince)
      .not("status", "in", "(funded,declined,dead)")
      .order("created_at", { ascending: false })
      .limit(25);
    orphanCount = orphans?.length ?? 0;
    if (orphanCount > 0) {
      orphanAlert = await sendPipeAlert(
        db, cfg, "synergy:unassigned_deals",
        `${orphanCount} LEAD${orphanCount === 1 ? "" : "S"} WITH NO CLOSER ASSIGNED`,
        [
          `<b>${orphanCount}</b> deal(s) created in the last ${ORPHAN_LOOKBACK_HOURS}h have <b>no assigned closer</b>. They are visible to closers as unassigned leads, but nobody owns them — so nobody is accountable for calling them.`,
          "<b>Likely cause:</b> lead-assignment strategy is set to <code>manual</code>, no closer is active with a linked user account, or <code>next_lead_closer()</code> errored (auto-assignment never blocks a deal from being created — by design, so a broken round-robin can't drop a paid lead — but it does leave the deal unowned).",
          (orphans ?? []).map((o) => `• ${esc(String(o.deal_number ?? o.id))} (${esc(String(o.lead_source ?? "—"))}, ${esc(new Date(String(o.created_at)).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET)`).join("<br>"),
        ],
        `orphanCount=${orphanCount}`,
      );
    }
  }

  return json({
    ok: true,
    windowHours,
    dryRun,
    robots: robots.map((r) => r.email || r.id),
    checked: leadEmails.length,
    permanentlyIgnored,
    hoursSinceLastLead,
    silenceAlert,
    orphanCount,
    orphanAlert,
    okCount: details.filter((d) => d.state === "ok").length,
    recovered,
    stillMissing: stillMissing.length,
    alerted: alertSent,
    alertError,
    alertSuppressedByCooldown: stillMissing.length - cooled.length,
    details,
  });
});
