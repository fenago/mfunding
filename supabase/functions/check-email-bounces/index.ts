// check-email-bounces — the watchdog that makes a dead merchant mailbox visible
// WITHIN MINUTES OF THE LEAD ARRIVING, instead of after a closer has burned an hour.
//
// WHY THIS EXISTS (real incident, deal MF-2026-0029): a lead vendor supplied a
// syntactically perfect but DEAD address. GHL's very first automated email to it
// hard-bounced (email record status "failed", mailgun error "1 Requested mail action
// aborted, mailbox not found" — a 550), and GHL then rejected every later send with
// 400 "Contact's email is invalid". Nothing in this app ever read an outbound email's
// status, so the bounce was invisible: the closer found out only after completing the
// whole application, and 6 orphan e-sign documents had been minted against a mailbox
// that will never receive them.
//
// The bounce is knowable SECONDS after the lead lands — GHL's own welcome email
// bounces immediately. This sweep just goes and asks.
//
// WHAT IT DOES (every 15 minutes, via pg_cron):
//   1. Picks merchants worth asking about: they have a GHL contact + an email, and
//      either we've never established deliverability (email_status is null) or the
//      last verdict was 'ok' but is a day stale on a still-young lead.
//   2. For each, reads the most recent OUTBOUND email RECORD in GHL (lastEmailFailure)
//      — the record, never the conversation message, which carries no status at all.
//   3. Stamps customers.email_status = 'bounced' | 'ok' (+ reason + timestamp).
//      A 'bounced' verdict is sticky until someone puts a new address on the merchant
//      (a DB trigger resets it), and it lights the red "Email bounced" chip on the
//      deal, blocks the application/doc send, and explains itself to the closer.
//
// It NEVER sends anything to a merchant and NEVER touches GHL workflows — it only
// reads email records and writes our own columns.
//
// Auth (mirrors synergy-reconcile):
//   • Trusted cron  → ?secret=<GHL webhook secret> (+ anon key Bearer for the gateway).
//   • Staff UI/curl → user JWT with closer/admin/super_admin. A service-role bearer is
//     NOT a session and deliberately fails the role check — use the cron path.
//
// Compliance: internal observability only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, lastEmailFailure, recordEmailOutcome,
} from "../_shared/ghl.ts";
import { fireAndForgetScore } from "../_shared/scoreLeadInvoke.ts";

// GHL rate-limits hard, and each merchant costs ~3 calls (conversation → messages →
// email record). Keep a run small; the sweep runs every 15 minutes, so a backlog
// drains quickly and a fresh lead is still checked within one cycle.
const DEFAULT_LIMIT = 25;
const PACE_MS = 250;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const limit = Number(payload.limit ?? url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  // Check ONE merchant (by customer id) — used by the UI's "re-check" affordance.
  const onlyCustomerId = (payload.customer_id ?? url.searchParams.get("customer_id") ?? null) as string | null;

  let cfg: Awaited<ReturnType<typeof getGhlConfig>>;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── Who to ask about ──
  // Never re-ask about a known bounce: it is sticky by design, and the ONLY thing
  // that clears it is a new address on the merchant (the customers_reset_email_status
  // trigger nulls the verdict on an email change, which puts the row back in this
  // queue automatically).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  type Row = { id: string; email: string | null; ghl_contact_id: string | null; email_status: string | null };
  let rows: Row[] = [];

  if (onlyCustomerId) {
    const { data, error } = await db
      .from("customers").select("id, email, ghl_contact_id, email_status")
      .eq("id", onlyCustomerId).maybeSingle();
    if (error) return json({ error: `customer lookup failed: ${error.message}` }, 500);
    if (data) rows = [data as Row];
  } else {
    // (a) deliverability never established (newest lead first — a fresh lead is the
    //     whole point). A merchant GHL has never emailed stays 'unknown' forever, so
    //     we stamp email_checked_at on those too and back off for an hour; otherwise
    //     the same unemailable rows would fill every run and starve the real queue.
    const { data: fresh, error: fErr } = await db
      .from("customers").select("id, email, ghl_contact_id, email_status")
      .is("email_status", null).not("email", "is", null).not("ghl_contact_id", "is", null)
      .or(`email_checked_at.is.null,email_checked_at.lt.${hourAgo}`)
      .order("created_at", { ascending: false }).limit(limit);
    if (fErr) return json({ error: `customer scan failed: ${fErr.message}` }, 500);
    // (b) previously 'ok' but stale, on a still-young lead — an address can die
    //     between the welcome email and the application.
    const { data: stale, error: sErr } = await db
      .from("customers").select("id, email, ghl_contact_id, email_status")
      .eq("email_status", "ok").not("email", "is", null).not("ghl_contact_id", "is", null)
      .lt("email_checked_at", dayAgo).gt("created_at", weekAgo)
      .order("email_checked_at", { ascending: true }).limit(Math.max(0, limit - (fresh?.length ?? 0)));
    if (sErr) return json({ error: `customer scan failed: ${sErr.message}` }, 500);
    rows = [...((fresh ?? []) as Row[]), ...((stale ?? []) as Row[])];
  }

  const bounced: Array<{ customer_id: string; email: string; reason: string | null }> = [];
  let checked = 0, ok = 0, unknown = 0;

  for (const c of rows) {
    if (!c.email || !c.ghl_contact_id) continue;
    // Compare against the merchant's CURRENT address: a bounce to an address they've
    // since replaced is history, not a verdict on the new one.
    const outcome = await lastEmailFailure(cfg, c.ghl_contact_id, c.email);
    checked++;
    if (!outcome.status) {
      // GHL has never emailed this contact → no verdict to record. Stamp the ATTEMPT
      // (not the status) so we back off for an hour instead of re-asking every cycle.
      unknown++;
      const { error } = await db.from("customers")
        .update({ email_checked_at: new Date().toISOString() }).eq("id", c.id);
      if (error) console.error("[check-email-bounces] checked_at stamp failed:", error.message);
      await sleep(PACE_MS);
      continue;
    }
    await recordEmailOutcome(db, c.id, c.email, outcome);
    if (outcome.bounced) {
      bounced.push({ customer_id: c.id, email: c.email, reason: outcome.error });
      console.warn("[check-email-bounces] UNDELIVERABLE", JSON.stringify({
        customer_id: c.id, email: c.email, status: outcome.status, error: outcome.error,
      }));
    } else ok++;
    // ── Lead-score refresh when the deliverability VERDICT changed (a dead email
    // is a strong negative already stored — the score must reflect it). Fire-and-
    // forget: scoring never blocks or fails the sweep.
    const priorBounced = c.email_status === "bounced";
    if (priorBounced !== outcome.bounced) {
      const { data: dealRows } = await db
        .from("deals").select("id").eq("customer_id", c.id).neq("deal_type", "vcf");
      for (const d of dealRows ?? []) fireAndForgetScore(d.id as string, "email_health");
    }
    await sleep(PACE_MS);
  }

  return json({
    ok: true,
    scanned: rows.length,
    checked,
    bounced: bounced.length,
    deliverable: ok,
    never_emailed: unknown,
    newly_flagged: bounced,
  });
});
