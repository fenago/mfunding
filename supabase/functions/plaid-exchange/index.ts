// plaid-exchange — the merchant just linked their bank; turn the one-time public
// token into a durable access token, store it ENCRYPTED, and kick off the pull.
//
// verify_jwt = false: same in-code auth as plaid-create-link-token (merchant JWT,
// staff JWT, or a public link_ref). The access token is NEVER returned to the client
// and NEVER stored plaintext — plaid_store_item() puts it in the vault and keeps only
// the vault uuid on plaid_items.
//
// POST body: { public_token, link_ref? } | { public_token, dealId?/customerId? }
// Returns:   { ok, institution, item_id }   (no tokens ever)
//
// After storing, it fires plaid-pull (best-effort, via the shared secret) so
// transactions/statements start flowing without waiting on the webhook.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. No merchant-facing
// product copy here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getPlaidConfig, plaidFetch, resolveEnv } from "../_shared/plaid.ts";
import { resolvePlaidCaller } from "../_shared/plaidAuth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const publicToken = body.public_token as string | undefined;
  if (!publicToken) return json({ error: "public_token is required" }, 400);

  const db = serviceClient();

  const ctx = await resolvePlaidCaller(db, req, body);
  if (!ctx.ok || !ctx.customerId) return json({ error: ctx.error ?? "Forbidden" }, ctx.status);

  const env = await resolveEnv(db, ctx.via === "staff" ? ctx.envOverride ?? null : null);
  let cfg;
  try { cfg = await getPlaidConfig(db, env); }
  catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }

  // ── 1) public_token → access_token + item_id ──
  const ex = await plaidFetch<{ access_token: string; item_id: string }>(cfg, "/item/public_token/exchange", {
    public_token: publicToken,
  });
  if (!ex.ok || !ex.data?.access_token || !ex.data?.item_id) {
    return json({ error: ex.error ?? "Could not complete the bank connection.", error_code: ex.errorCode }, 502);
  }
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;

  // ── 2) Institution name (best-effort, for a friendly "Connected to X" chip) ──
  let institutionId: string | null = null;
  let institutionName: string | null = null;
  try {
    const item = await plaidFetch<{ item: { institution_id?: string }; consent_expiration_time?: string | null }>(cfg, "/item/get", { access_token: accessToken });
    institutionId = item.data?.item?.institution_id ?? null;
    if (institutionId) {
      const inst = await plaidFetch<{ institution: { name?: string } }>(cfg, "/institutions/get_by_id", {
        institution_id: institutionId, country_codes: ["US"],
      });
      institutionName = inst.data?.institution?.name ?? null;
    }
  } catch { /* name is cosmetic — never fail the exchange on it */ }

  // ── 3) Store the item + token (encrypted in the vault). ──
  const { data: rowId, error: storeErr } = await db.rpc("plaid_store_item", {
    p_customer_id: ctx.customerId,
    p_deal_id: ctx.dealId ?? null,
    p_item_id: itemId,
    p_institution_id: institutionId,
    p_institution_name: institutionName,
    p_access_token: accessToken,
    p_environment: env,
  });
  if (storeErr) {
    console.error("[plaid-exchange] plaid_store_item failed", storeErr.message);
    return json({ error: "Could not save the bank connection." }, 500);
  }

  // ── 4) Audit trail. entity_type 'customer' + interaction_type 'note' are allowed. ──
  await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: ctx.customerId,
    interaction_type: "note",
    subject: "plaid:bank-connected",
    content: `Merchant connected their bank via Plaid${institutionName ? ` (${institutionName})` : ""} — ${env}. Pulling transactions.`,
  }).then(() => {}, () => {});

  // ── 5) Kick off the pull (best-effort; the webhook is the backstop). ──
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const { data: gc } = await db.rpc("get_ghl_config");
    const secret = (gc?.webhook_secret as string | undefined) ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (supabaseUrl && secret) {
      fetch(`${supabaseUrl}/functions/v1/plaid-pull?secret=${encodeURIComponent(secret)}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(anon ? { Authorization: `Bearer ${anon}` } : {}) },
        body: JSON.stringify({ item_id: itemId }),
      }).catch(() => {});
    }
  } catch { /* best-effort */ }

  return json({ ok: true, item_id: itemId, institution: institutionName, plaid_item_pk: rowId, environment: env });
});
