// ph-ucc-verify-emails — the EMAIL-VERIFICATION pass of the PH UCC List Machine.
//
// After ph-ucc-skiptrace appends BatchData consumer emails onto traced leads, this
// batch driver asks Instantly "is this mailbox real?" for each — BEFORE the cold-email
// channel is ever allowed to use it. BatchData emails are person/consumer addresses;
// syntactically valid ≠ deliverable (deal MF-2026-0029: a dead yahoo mailbox that
// hard-bounced through the whole app). Only a 'verified' address is promoted to the
// lead's usable email.
//
// It reuses the shared verifier (../_shared/instantly.ts) exactly like email-verify-
// sweep — same async POST-then-poll, same "rate-limit is NEVER a verdict" rule, same
// wall-clock budget. It NEVER dials, NEVER emails, NEVER loads to GHL. It only records
// a deliverability verdict.
//
// GATE: no-ops unless ph_settings.instantly_verify_emails = true (owner-toggleable,
// default true). The skip-trace load gate (ucc_load_enabled) is unrelated and unchanged.
//
// PER LEAD: gather the lead's distinct emails (ph_ucc_contacts.emails + lead.email),
// verify in order (cap MAX_EMAILS_PER_LEAD), stop at the first 'verified'. Store:
//   • email_verify_status = the verified verdict if found, else the first verdict seen
//   • email               = promoted to the verified address when one is found
//   • email_verified_at   = now
// Idempotent: only picks leads with email_verify_status IS NULL (unless force).
//
// AUTH (mirrors ph-ucc-skiptrace / email-verify-sweep): trusted cron via
// ?secret=<GHL webhook secret> + anon-key Bearer, OR a signed-in staff user
// (closer/admin/super_admin). A service-role bearer deliberately fails the role check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getInstantlyKey, verifyEmail, type EmailHealth } from "../_shared/instantly.ts";

const DEFAULT_LIMIT = 8;           // leads per run; each email polls ~10s, keep the run under the wall
const MAX_EMAILS_PER_LEAD = 3;     // bound cost/time when a trace returns many person emails
const HARD_MAX_LIMIT = 50;
const BUDGET_MS = 60_000;          // stop STARTING new checks past this
const VERIFY_OPTS = { attempts: 3, delayMs: 3000 } as const; // ~10s patience per address

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const cleanEmail = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim().toLowerCase();
  return v.includes("@") ? v : null;
};

// GOOD = verified; BAD = provably undeliverable; else UNVERIFIED (can't tell).
function bucketOf(health: string): "good" | "bad" | "unverified" {
  if (health === "verified") return "good";
  if (["invalid", "bounced", "undeliverable", "disposable"].includes(health)) return "bad";
  return "unverified";
}

type Lead = { id: string; debtor_name: string | null; email: string | null; status: string };

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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron/GET */ }

  // ── Gate: owner toggle. Off → no-op (never silently pretend it ran). ──
  const { data: settings } = await db.from("platform_settings").select("value").eq("key", "ph_settings").maybeSingle();
  const enabled = (settings?.value as Record<string, unknown> | undefined)?.instantly_verify_emails;
  const forceGate = payload.force_gate === true || url.searchParams.get("force_gate") === "true";
  if (enabled === false && !forceGate) {
    return json({ ok: true, skipped: true, reason: "ph_settings.instantly_verify_emails is false" });
  }

  const rawLimit = num(payload.limit ?? url.searchParams.get("limit")) ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(HARD_MAX_LIMIT, Math.floor(rawLimit)));
  const force = payload.force === true || url.searchParams.get("force") === "true";

  let apiKey: string;
  try { apiKey = await getInstantlyKey(db); }
  catch (e) { return json({ error: `Instantly not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── Batch: traced leads with an email that haven't been verified yet ──
  let q = db.from("ph_ucc_leads")
    .select("id,debtor_name,email,status")
    .not("email", "is", null)
    .not("traced_at", "is", null)
    .in("status", ["needs_scrub", "email_only"])
    .order("freshness_days", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (!force) q = q.is("email_verify_status", null);
  const { data: leads, error: leadErr } = await q;
  if (leadErr) return json({ error: `lead select failed: ${leadErr.message}` }, 500);
  const rows = (leads as Lead[]) ?? [];
  if (rows.length === 0) return json({ ok: true, checked: 0, message: "No traced leads awaiting email verification." });

  const started = Date.now();
  const counts = { good: 0, bad: 0, unverified: 0 };
  let checked = 0, promoted = 0, rateLimited = false;
  const perLead: Record<string, unknown>[] = [];
  const backlogRemaining = () => rows.length - checked;

  for (const lead of rows) {
    if (Date.now() - started > BUDGET_MS) break;

    // Candidate emails: person emails from the contact rows first, then the lead's
    // current best email. Dedupe, keep order, cap the count.
    const { data: contacts } = await db.from("ph_ucc_contacts").select("emails").eq("lead_id", lead.id);
    const candidates: string[] = [];
    for (const c of (contacts ?? []) as Array<{ emails: unknown }>) {
      const arr = Array.isArray(c.emails) ? c.emails : [];
      for (const e of arr) { const em = cleanEmail(e); if (em && !candidates.includes(em)) candidates.push(em); }
    }
    const leadEmail = cleanEmail(lead.email);
    if (leadEmail && !candidates.includes(leadEmail)) candidates.push(leadEmail);
    const toCheck = candidates.slice(0, MAX_EMAILS_PER_LEAD);
    if (toCheck.length === 0) continue;

    let chosenEmail: string | null = null;
    let chosenHealth: EmailHealth | null = null;
    let firstHealth: EmailHealth | null = null;
    let firstEmail: string | null = null;
    let hitRateLimit = false;

    for (const email of toCheck) {
      const result = await verifyEmail(apiKey, email, VERIFY_OPTS);
      if (result.rateLimited) { hitRateLimit = true; break; }   // NOT a verdict → abort this lead, persist nothing
      if (firstHealth === null) { firstHealth = result.health; firstEmail = email; }
      if (result.health === "verified") { chosenEmail = email; chosenHealth = "verified"; break; }
    }

    if (hitRateLimit) {
      rateLimited = true;
      console.warn("[ph-ucc-verify-emails] RATE-LIMITED — stopping run", JSON.stringify({ after_checked: checked, remaining: backlogRemaining() }));
      break;
    }
    if (firstHealth === null) continue; // nothing actually checked (shouldn't happen)

    // Verdict to store: the verified one if found, else the first verdict seen.
    const status = (chosenHealth ?? firstHealth) as EmailHealth;
    const bestEmail = chosenEmail ?? firstEmail;
    const promoteEmail = chosenEmail != null; // only promote a PROVEN-good address

    const patch: Record<string, unknown> = {
      email_verify_status: status,
      email_verified_at: new Date().toISOString(),
    };
    if (promoteEmail && bestEmail) patch.email = bestEmail; // best_email = first verified
    const { error: uErr } = await db.from("ph_ucc_leads").update(patch).eq("id", lead.id);
    if (uErr) { perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, error: `update: ${uErr.message}` }); continue; }

    checked++;
    counts[bucketOf(status)]++;
    if (promoteEmail) promoted++;
    perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, checked_emails: toCheck.length, verdict: status, promoted: promoteEmail });
  }

  return json({
    ok: true,
    batch_size: rows.length,
    checked,
    verified: counts.good,
    bad: counts.bad,
    unverified: counts.unverified,
    promoted,
    rate_limited: rateLimited,
    remaining_in_batch: rateLimited ? backlogRemaining() : 0,
    credits_spent_est: Number((checked * 0.25).toFixed(2)),
    elapsed_ms: Date.now() - started,
    per_lead: perLead,
  });
});
