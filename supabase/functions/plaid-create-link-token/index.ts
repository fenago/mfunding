// plaid-create-link-token — mint a Plaid Link token so a merchant can connect their
// bank in ~60 seconds. This is the entry point for the whole flow.
//
// verify_jwt = false: auth is enforced IN CODE (resolvePlaidCaller) because this
// serves BOTH the authenticated portal (merchant/staff JWT) and the public tokenized
// "connect your bank" link a closer texts (body.link_ref). See _shared/plaidAuth.ts.
//
// POST body: { link_ref? } | { dealId?, customerId?, environment? (staff only) }
// Returns:   { link_token, expiration, environment }
//
// The webhook is set to plaid-webhook (?secret=<GHL webhook secret>) so Plaid tells
// us when transactions are ready. Products come from platform_settings.plaid.products
// (default ['transactions']); we request 120 days so the underwriter gets ~4 months.
//
// STATEMENTS: we also consent to bank-statement PDFs so plaid-pull can list+download
// them (it already does — it just needed the Item to be statements-consented). It goes
// in `required_if_supported_products`, NOT the hard `products` array, so an institution
// that does not support Statements still links successfully on transactions alone.
// To add Statements to an ALREADY-linked Item, call /link/token/create with that item's
// access_token + products:['statements'] (no full re-link needed) — not built here.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. Merchant-facing
// error copy uses "connect your bank to verify your business revenue" language only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getPlaidConfig, getPlaidSettings, plaidFetch, resolveEnv } from "../_shared/plaid.ts";
import { resolvePlaidCaller } from "../_shared/plaidAuth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  const db = serviceClient();

  // ── Auth + bind to exactly one customer/deal. ──
  const ctx = await resolvePlaidCaller(db, req, body);
  if (!ctx.ok || !ctx.customerId) return json({ error: ctx.error ?? "Forbidden" }, ctx.status);

  // ── Environment (staff may override for testing; merchant/link use the setting). ──
  const env = await resolveEnv(db, ctx.via === "staff" ? ctx.envOverride ?? null : null);
  const settings = await getPlaidSettings(db);

  let cfg;
  try { cfg = await getPlaidConfig(db, env); }
  catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }

  // Webhook URL — Plaid will call it when transactions/statements are ready. It is
  // authenticated by the shared GHL webhook secret in the query string (fail-closed
  // gate inside plaid-webhook), the same pattern the cron paths use.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let webhook: string | undefined;
  try {
    const { data: gc } = await db.rpc("get_ghl_config");
    const secret = (gc?.webhook_secret as string | undefined) ?? "";
    if (supabaseUrl && secret) webhook = `${supabaseUrl}/functions/v1/plaid-webhook?secret=${encodeURIComponent(secret)}`;
  } catch { /* webhook is optional — link still works, we just won't get push updates */ }

  // Statements window: first day of the month 4 months back → today. Anchoring the
  // start on day 1 sidesteps end-of-month rollover (Aug 31 minus 4 months) and covers
  // ~4 posted statements, which is what the underwriter wants.
  const now = new Date();
  const stmtEnd = now.toISOString().slice(0, 10);
  const stmtStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1))
    .toISOString().slice(0, 10);

  const products = settings.products; // default ['transactions']
  const linkBody: Record<string, unknown> = {
    user: { client_user_id: ctx.customerId },
    client_name: "Momentum Funding",
    products,
    // Pull statement PDFs where the bank supports them; never fail the link if it doesn't.
    // (Plaid rejects a product listed in BOTH arrays, so skip if the setting already has it.)
    ...(products.includes("statements") ? {} : { required_if_supported_products: ["statements"] }),
    statements: { start_date: stmtStart, end_date: stmtEnd },
    country_codes: ["US"],
    language: "en",
    ...(webhook ? { webhook } : {}),
  };
  if (products.includes("transactions")) {
    linkBody.transactions = { days_requested: 120 };
  }

  const res = await plaidFetch<{ link_token: string; expiration: string }>(cfg, "/link/token/create", linkBody);
  if (!res.ok || !res.data?.link_token) {
    return json({ error: res.error ?? "Could not start bank connection.", error_code: res.errorCode }, 502);
  }

  return json({
    link_token: res.data.link_token,
    expiration: res.data.expiration,
    environment: env,
  });
});
