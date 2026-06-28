// ghl-webhook — INBOUND: receive GoHighLevel webhook events and reflect them
// into Supabase. Configure this URL in GHL (Settings → Webhooks, or a workflow
// "Webhook" action) for the events you care about.
//
// Handled event types (GHL `type` field):
//   ContactCreate / ContactUpdate            → upsert customers (match by ghl_contact_id, else email)
//   OpportunityStatusUpdate / OpportunityStageUpdate / OpportunityUpdate
//                                            → update deals (match by ghl_opportunity_id), map stage→status
//
// Auth: GHL cannot send a Supabase JWT, so this function uses verify_jwt = false
// and instead checks a shared secret. Set GHL_WEBHOOK_SECRET in the vault and
// pass it as `?secret=...` (or header `x-ghl-secret`) when registering the webhook.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

// GHL stage name (lowercased) → deal status
const STATUS_BY_STAGE: Record<string, string> = {
  "new lead": "new",
  "contacted": "contacted",
  "qualifying": "qualifying",
  "application sent": "application_sent",
  "docs collected": "docs_collected",
  "bank statements": "bank_statements",
  "submitted to funders": "submitted_to_funder",
  "submitted to funder": "submitted_to_funder",
  "offer received": "offer_received",
  "offer presented": "offer_presented",
  "offer accepted": "offer_accepted",
  "funded": "funded",
  "renewal eligible": "renewal_eligible",
  "nurture / re-engage": "nurture",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // Shared-secret check (GHL can't send a Supabase JWT).
  try {
    const { data: cfg } = await db.rpc("get_ghl_config"); // also confirms DB connectivity
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    const expected = (cfg?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (expected && provided !== expected) return json({ error: "unauthorized" }, 401);
  } catch (_e) { /* if config read fails, fall through and still attempt to process */ }

  let evt: Record<string, unknown>;
  try { evt = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const type = String(evt.type ?? evt.eventType ?? "");
  try {
    if (type.startsWith("Contact")) {
      await handleContact(db, evt);
    } else if (type.startsWith("Opportunity")) {
      await handleOpportunity(db, evt);
    } else {
      // Acknowledge unhandled events so GHL doesn't retry forever.
      return json({ ok: true, ignored: type || "unknown" });
    }
    return json({ ok: true, type });
  } catch (e) {
    return json({ ok: false, type, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

type DB = ReturnType<typeof serviceClient>;

async function handleContact(db: DB, evt: Record<string, unknown>) {
  const c = (evt.contact ?? evt) as Record<string, unknown>;
  const ghlId = String(c.id ?? evt.contactId ?? "");
  const email = (c.email as string) ?? null;
  if (!ghlId && !email) return;

  const patch = {
    first_name: (c.firstName as string) ?? undefined,
    last_name: (c.lastName as string) ?? undefined,
    email: email ?? undefined,
    phone: (c.phone as string) ?? undefined,
    business_name: (c.companyName as string) ?? undefined,
    ghl_contact_id: ghlId || undefined,
  };

  // Match existing customer by ghl_contact_id, then email.
  let existing: { id: string } | null = null;
  if (ghlId) {
    const { data } = await db.from("customers").select("id").eq("ghl_contact_id", ghlId).maybeSingle();
    existing = data;
  }
  if (!existing && email) {
    const { data } = await db.from("customers").select("id").eq("email", email).maybeSingle();
    existing = data;
  }

  if (existing) {
    await db.from("customers").update(patch).eq("id", existing.id);
    await log(db, "customer", existing.id, `ghl:${String(evt.type)}`, evt);
  } else {
    const { data: created } = await db.from("customers")
      .insert({ ...patch, status: "lead", source: "ghl" }).select("id").maybeSingle();
    if (created) await log(db, "customer", created.id, `ghl:${String(evt.type)}`, evt);
  }
}

async function handleOpportunity(db: DB, evt: Record<string, unknown>) {
  const o = (evt.opportunity ?? evt) as Record<string, unknown>;
  const oppId = String(o.id ?? evt.opportunityId ?? evt.id ?? "");
  if (!oppId) return;

  const { data: deal } = await db.from("deals").select("id,status").eq("ghl_opportunity_id", oppId).maybeSingle();
  if (!deal) return; // opportunity not linked to a known deal

  const stageName = String(o.stageName ?? o.pipelineStageName ?? evt.pipelineStageName ?? "").toLowerCase();
  const mapped = STATUS_BY_STAGE[stageName];
  const patch: Record<string, unknown> = {};
  if (mapped && mapped !== deal.status) patch.status = mapped;
  if (o.monetaryValue != null) patch.amount_requested = o.monetaryValue;

  if (Object.keys(patch).length) {
    await db.from("deals").update(patch).eq("id", deal.id);
    await log(db, "deal", deal.id, `ghl:${String(evt.type)}`, { from: deal.status, to: patch.status, evt });
  }
}

async function log(db: DB, entityType: string, entityId: string, action: string, meta: unknown) {
  try {
    await db.from("activity_log").insert({
      entity_type: entityType, entity_id: entityId,
      interaction_type: "system", subject: action, content: JSON.stringify(meta),
    });
  } catch { /* best-effort */ }
}
