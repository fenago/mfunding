// verify-merchant-email — ask Instantly whether a merchant's mailbox actually EXISTS,
// and persist the verdict on the customer, so a dead vendor-supplied address indicts
// itself the moment the lead lands.
//
// WHY (deal MF-2026-0029): a lead vendor supplied klbreen3@yahoo.com. Syntactically
// perfect, so every check we had passed it. It was a dead mailbox — GHL's first
// automated email hard-bounced (550 "mailbox not found"), GHL flagged the address, and
// every subsequent send 400'd. The closer found out only after completing the whole
// application, by which point 6 e-sign documents had been minted against a mailbox
// nobody will ever read. Instantly answers the question in ~20 seconds for 0.25 credits.
//
// CALLED BY:
//   · the customers_verify_email TRIGGER — every new lead, and every time someone puts
//     a new email on a merchant (which is how the fix takes seconds, not a re-run).
//   · the "Re-verify" button on the deal's email-health chip.
//
// POST { customerId }  or  { email }  (email-only = a read-only probe, persists nothing)
//
// Auth (mirrors synergy-reconcile / check-email-bounces):
//   · Trusted system → ?secret=<GHL webhook secret> (+ anon-key Bearer for the gateway).
//     This is the path the DB trigger uses.
//   · Staff UI      → user JWT with closer/admin/super_admin. A service-role bearer is
//     NOT a session and deliberately fails the role check — use the secret path.
//
// It NEVER emails anyone: verification is a DNS/SMTP probe run by Instantly, not a send.
// Compliance: internal data quality only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getInstantlyKey, verifyEmail, recordVerification } from "../_shared/instantly.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted system (shared secret) OR a signed-in staff user ──
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

  let payload: { customerId?: string; email?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const customerId = payload.customerId;
  let email = (payload.email ?? "").trim();

  if (!customerId && !email) return json({ error: "customerId or email is required" }, 400);

  // Resolve the address from the customer when we were given an id.
  if (customerId) {
    const { data: c, error } = await db
      .from("customers").select("id, email, email_status").eq("id", customerId).maybeSingle();
    if (error) return json({ error: `customer lookup failed: ${error.message}` }, 500);
    if (!c) return json({ error: "customer not found" }, 404);
    if (!c.email) return json({ ok: true, skipped: "customer has no email on file" });
    // A PROVEN bounce is stronger than anything Instantly can tell us. Don't spend a
    // credit re-litigating it, and never risk a cheerier verdict overwriting the proof.
    if (c.email_status === "bounced") {
      return json({ ok: true, customerId, email: c.email, health: "bounced", skipped: "already proven bounced" });
    }
    email = c.email as string;
  }

  let apiKey: string;
  try { apiKey = await getInstantlyKey(db); }
  catch (e) { return json({ error: `Instantly not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // Instantly is asynchronous: the POST usually says "pending" and the verdict lands on
  // a later GET. verifyEmail polls it out, and degrades to "unknown" — never to a false
  // pass and never to a false block — if it can't get an answer.
  const result = await verifyEmail(apiKey, email);

  if (customerId) {
    await recordVerification(db, customerId, email, result);
    if (result.health === "invalid") {
      console.warn("[verify-merchant-email] INVALID MAILBOX", JSON.stringify({
        customerId, email, raw: result.raw,
      }));
    }
  }

  return json({
    ok: true,
    customerId: customerId ?? null,
    email,
    health: result.health,
    catch_all: result.catchAll,
    instantly_status: result.raw,
    persisted: !!customerId,
    ...(result.error ? { note: result.error } : {}),
  });
});
