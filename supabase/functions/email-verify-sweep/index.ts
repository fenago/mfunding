// email-verify-sweep — verify EVERY campaign-attributed merchant email against
// Instantly, not just the ones that happened to bounce, so the Campaign Audit can say
// in real time: of all the addresses a lead vendor supplied, what % are GOOD vs BAD.
//
// WHY: check-email-bounces only learns an address is dead AFTER GHL tries to send to it
// and gets a hard bounce. That leaves every never-emailed lead's deliverability unknown.
// This sweep proactively asks Instantly for a verdict on the whole campaign population,
// draining a backlog over repeated runs.
//
// It is a batch DRIVER over the shared verifier (../_shared/instantly.ts):
//   • Reads the batch to check from select_campaign_emails_to_verify() (one SQL
//     definition, shared with the audit's backlog count).
//   • verifyEmail() does the async POST-then-poll and NEVER returns "invalid" for a
//     network/rate-limit failure — a lead is worth far more than a verification.
//   • recordVerification() persists the verdict WITHOUT ever overwriting a proven
//     bounce (evidence outranks a guess).
//
// RATE LIMITS (0.25 credits/check): Instantly answers 403/429 when we ask too fast.
// verifyEmail flags that as { rateLimited:true, health:"unknown" }. On the first
// rate-limit we STOP the run immediately, record nothing for that address (so it stays
// in the queue), and report how much backlog remains. A rate-limit is NEVER a verdict.
//
// WALL-CLOCK BUDGET: each verification polls for up to ~24s. We cap the batch and stop
// starting new checks past a time budget so the function returns before the platform
// kills it; the hourly cron + the "Verify all now" UI loop drain the rest.
//
// Auth (mirrors check-email-bounces / verify-merchant-email):
//   • Trusted cron → ?secret=<GHL webhook secret> (+ anon-key Bearer for the gateway).
//   • Staff UI     → user JWT with closer/admin/super_admin. A service-role bearer is
//     NOT a session and deliberately fails the role check — use the secret path.
//
// It NEVER emails anyone: verification is a DNS/SMTP probe run by Instantly.
// Compliance: internal data-quality only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getInstantlyKey, verifyEmail, recordVerification } from "../_shared/instantly.ts";

// Small batch on purpose: a stubborn address polls to the patience limit (~10s), so a
// run must fit MANY of those under the platform wall. The sweep is hourly and the
// "Verify all now" button re-invokes until the backlog drains, so a fresh vendor drop is
// fully verified within a few cycles regardless of batch size.
const DEFAULT_LIMIT = 8;
// Stop STARTING new checks past this. The last check started can still run one full
// poll (~10s) past the budget, so BUDGET + patience + overhead must stay well under the
// gateway/pg_net wall (120s) and the platform wall.
const BUDGET_MS = 60_000;
// Poll patience per address in a batch: deliberately short. A batch can afford to leave
// a slow/greylisted address "unknown" and re-pick it next run rather than block on it.
const VERIFY_OPTS = { attempts: 3, delayMs: 3000 } as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Group a verdict into the three audit buckets. Mirrors campaignAuditService exactly:
// GOOD = a positive "verified"; BAD = invalid/undeliverable/disposable/bounced;
// everything else (catch_all/risky/unknown) is UNVERIFIED — deliverability unproven.
function bucketOf(health: string): "good" | "bad" | "unverified" {
  if (health === "verified") return "good";
  if (health === "invalid" || health === "bounced" || health === "undeliverable" || health === "disposable") return "bad";
  return "unverified";
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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron/GET may send no body */ }
  const limit = Number(payload.limit ?? url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;

  let apiKey: string;
  try { apiKey = await getInstantlyKey(db); }
  catch (e) { return json({ error: `Instantly not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── The batch to check (campaign-attributed, needs a verdict) ──
  const { data: batch, error: batchErr } = await db
    .rpc("select_campaign_emails_to_verify", { p_limit: limit });
  if (batchErr) return json({ error: `batch select failed: ${batchErr.message}` }, 500);
  const rows = (batch ?? []) as Array<{ customer_id: string; email: string }>;

  const started = Date.now();
  const counts = { good: 0, bad: 0, unverified: 0 };
  let checked = 0;
  let rateLimited = false;
  const invalids: Array<{ customer_id: string; email: string; raw: string | null }> = [];

  for (const r of rows) {
    if (Date.now() - started > BUDGET_MS) break; // out of time — the rest waits for the next run
    if (!r.email) continue;

    const result = await verifyEmail(apiKey, r.email, VERIFY_OPTS);

    // A rate-limit is NOT a verdict: stop the whole run, persist nothing for this address
    // (leaving it in the queue), and let a later run pick it up.
    if (result.rateLimited) {
      rateLimited = true;
      console.warn("[email-verify-sweep] RATE-LIMITED — stopping run", JSON.stringify({
        after_checked: checked, remaining_in_batch: rows.length - checked,
      }));
      break;
    }

    await recordVerification(db, r.customer_id, r.email, result);
    checked++;
    counts[bucketOf(result.health)]++;
    if (result.health === "invalid") {
      invalids.push({ customer_id: r.customer_id, email: r.email, raw: result.raw });
      console.warn("[email-verify-sweep] INVALID MAILBOX", JSON.stringify({
        customer_id: r.customer_id, email: r.email, raw: result.raw,
      }));
    }
  }

  // Backlog remaining AFTER this run (same SQL definition) — the UI loops on this to
  // know when the drain is complete.
  const { data: remaining } = await db.rpc("campaign_email_verification_backlog");

  return json({
    ok: true,
    batch_size: rows.length,
    checked,
    good: counts.good,
    bad: counts.bad,
    unverified: counts.unverified,
    rate_limited: rateLimited,
    remaining: typeof remaining === "number" ? remaining : null,
    credits_spent: Number((checked * 0.25).toFixed(2)),
    newly_invalid: invalids,
  });
});
