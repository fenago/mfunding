// plaid-mint-link — a closer needs a textable "connect your bank" link for a merchant
// who isn't logged into the portal. This mints a single-purpose, expiring token bound
// to exactly one customer and returns the public URL (my.mfunding.net/connect-bank/<t>).
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

const PORTAL_BASE = "https://my.mfunding.net";
const TTL_DAYS = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function mintToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
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

  const tok = mintToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: insErr } = await db.from("merchant_bank_link_tokens").insert({
    token: tok, customer_id: customerId, deal_id: dealId, created_by: caller.id, expires_at: expiresAt,
  });
  if (insErr) {
    console.error("[plaid-mint-link] insert failed", insErr.message);
    return json({ error: "Could not create the bank-connection link." }, 500);
  }

  return json({ ok: true, url: `${PORTAL_BASE}/connect-bank/${tok}`, token: tok, expires_at: expiresAt });
});
