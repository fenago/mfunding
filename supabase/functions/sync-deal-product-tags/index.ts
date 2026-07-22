// sync-deal-product-tags — mirror a deal's products_interested onto its GHL
// contact as `product-*` tags (product-mca, product-sba-loan, …).
//
// Called from the Revenue Playbook after the closer toggles a product chip and
// the DB write lands. The DB (deals.products_interested) is the source of truth:
// this function reads it, computes the desired product-* tag set, and reconciles
// the contact — ADDING the tags now wanted and REMOVING the product-* tags no
// longer wanted. It ONLY ever touches tags that start with `product-`; every
// other tag on the contact (merchant, lt-source, DND markers, …) is left
// untouched. Idempotent: re-running with no change is a no-op.
//
// POST body: { dealId }
//
// Auth mirrors sync-lead-to-ghl: signed-in staff only (verify_jwt = true + an
// in-code role check), and a closer may only sync a deal assigned to them.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, getContact,
  addContactTags, removeContactTags,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// The validated product set (kept in lockstep with the DB CHECK constraint and
// the app's ProductInterest union). The tag is `product-` + dashes-for-underscores.
const PRODUCTS = new Set([
  "mca", "term_loan", "sba_loan", "line_of_credit",
  "equipment_financing", "cre", "debt_relief",
]);
const productTag = (p: string) => `product-${p.replace(/_/g, "-")}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  if (!dealId) return json({ error: "dealId is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: staff only; a closer may only sync a deal assigned to them. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // Read the deal (products = source of truth) + its GHL contact, falling back to
  // the customer's linked contact.
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, ghl_contact_id, customer_id, products_interested")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  const products = (deal.products_interested as string[] | null ?? []).filter((p) => PRODUCTS.has(p));
  if (products.length === 0) {
    return json({ error: "deal has no valid products_interested" }, 422);
  }

  let contactId = (deal.ghl_contact_id as string | null) ?? null;
  if (!contactId && deal.customer_id) {
    const { data: cust } = await db
      .from("customers").select("ghl_contact_id").eq("id", deal.customer_id).maybeSingle();
    contactId = (cust?.ghl_contact_id as string | null) ?? null;
  }
  const desired = products.map(productTag);
  if (!contactId) {
    // Nothing to tag yet — the deal has no GHL contact. Not an error: the DB is
    // already correct, and a contact gets tagged the next time products change
    // after one is linked.
    return json({ ok: true, skipped: "no linked GHL contact", desired });
  }

  // GHL config from the vault.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  // Read the contact's current tags so we only add/remove the product-* deltas.
  const got = await getContact(cfg, contactId);
  if (!got.ok) return json({ error: `GHL contact ${contactId} unreadable: ${got.error}`, contactId }, 502);
  const current = ((got.data?.contact as { tags?: unknown } | undefined)?.tags ?? []) as unknown[];
  const currentTags = current.map((t) => String(t).toLowerCase());
  const currentProductTags = new Set(currentTags.filter((t) => t.startsWith("product-")));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((t) => !currentProductTags.has(t));
  const toRemove = [...currentProductTags].filter((t) => !desiredSet.has(t));

  const errors: string[] = [];
  if (toAdd.length) {
    const r = await addContactTags(cfg, contactId, toAdd);
    if (!r.ok) errors.push(`add [${toAdd.join(", ")}]: ${r.error}`);
  }
  if (toRemove.length) {
    const r = await removeContactTags(cfg, contactId, toRemove);
    if (!r.ok) errors.push(`remove [${toRemove.join(", ")}]: ${r.error}`);
  }
  if (errors.length) return json({ error: `GHL tag sync failed — ${errors.join("; ")}`, contactId, added: toAdd, removed: toRemove }, 502);

  return json({ ok: true, contactId, desired, added: toAdd, removed: toRemove });
});
