// plaid-mint-link — a closer needs a textable "connect your bank" link for a merchant
// who isn't logged into the portal. This returns that merchant's single-purpose,
// expiring link (my.mfunding.net/connect-bank/<t>) — reusing their live one when
// they have one, minting when they don't. The mint/reuse/expiry rules live in
// _shared/bankLink.ts, shared with ph-send-packet and the application senders.
//
// The token is validated server-side by plaid-create-link-token / plaid-exchange (via
// resolvePlaidCaller) — it is NEVER readable over the API and grants nothing but the
// ability to start a Plaid connection for that one merchant.
//
// verify_jwt = true at the gateway PLUS an in-code staff role check (a service-role
// bearer is not a session and is rejected — house rule).
//
// POST body: { dealId } | { customerId }
// Returns:   { ok, url, token, expires_at }
//
// Compliance: MCA = purchase of future receivables, NOT a loan. The returned copy is
// neutral "connect your bank" language only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
// Minting, reuse and expiry live in ONE place — this function used to carry its
// own copy of them, and ph-send-packet carried a second.
import { ensureBankLink } from "../_shared/bankLink.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // ── Auth: staff JWT ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
  if (staff !== true) return json({ error: "Forbidden — staff only" }, 403);

  let body: { dealId?: string; customerId?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  let customerId = body.customerId ?? null;
  let dealId = body.dealId ?? null;
  if (!customerId && dealId) {
    const { data: deal } = await db.from("deals").select("customer_id").eq("id", dealId).maybeSingle();
    customerId = (deal?.customer_id as string | null) ?? null;
  }
  if (!customerId) return json({ error: "customerId or dealId is required" }, 400);

  // Reuse the merchant's live link rather than minting a second one: a merchant
  // holding three different URLs uploads against whichever they happen to find.
  const link = await ensureBankLink(db, { customerId, dealId, createdBy: caller.id });
  if (!link.ok) {
    console.error("[plaid-mint-link] ensureBankLink failed", link.error);
    return json({ error: link.error ?? "Could not create the bank-connection link." }, 500);
  }

  return json({
    ok: true, url: link.url, token: link.token, expires_at: link.expiresAt,
    reused: link.reused, extended: link.extended,
  });
});
