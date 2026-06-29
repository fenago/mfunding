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

// We auto-create deals for opportunities in these two pipelines.
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
const VCF_PIPELINE_ID = "nsmH6jIeVA0SsZMMq4LC";

// Stage id -> deal status (webhooks reliably include pipelineStageId).
const STATUS_BY_STAGE_ID: Record<string, string> = {
  // MCA pipeline
  "d60d563a-9904-423f-9a8e-0d0df0b12976": "new",
  "bc68ac6f-d45d-4d56-b1c8-c10a7ec4fdf7": "contacted",
  "27960f79-0b08-48ac-8fee-f4a9bf7748e3": "qualifying",
  "2071ceb6-b0cf-4700-b57b-f8a3ef4b15bf": "application_sent",
  "c49fa9f8-a155-4d14-a597-2b23fd937b32": "docs_collected",
  "72d926b3-ee88-4ee5-8ca2-ddb7071b2fc5": "bank_statements",
  "47d3f297-bf23-40a3-8e2b-48fa6c04e809": "submitted_to_funder",
  "5881c6a8-a84a-4753-be7f-6b8cd3f7d5be": "offer_received",
  "718d76bc-58c9-4913-a68d-e0345ed0b515": "offer_presented",
  "7e3cfb93-8e6e-428c-be99-9dfc77f300e6": "offer_accepted",
  "69995f02-4f20-41b9-8206-bbaaf7060c10": "funded",
  "bfd0515e-7dfd-4527-8460-1edef442311a": "renewal_eligible",
  "d4c4ce2d-75af-4766-82cf-c3ff56f0137b": "nurture",
  // VCF pipeline
  "625e5afd-94a9-455c-b1bd-d712cad4cb17": "new_distressed",
  "bcdd76ef-f798-4d14-8606-4087edaa6d42": "hardship_consult",
  "a1c7e1c8-2404-4a81-bf70-0bd21837fd33": "positions_analysis",
  "36ccf48f-c0a4-4264-bc42-066803ec6b75": "strategy_proposal",
  "046a711e-2303-4aa1-84e5-c32dac68d72b": "agreement_sent",
  "6ad1513c-08e1-4e60-99c5-7809da5a6d99": "submitted_to_vcf",
  "a46a57f5-b75c-4ae7-8705-98979db4bb53": "restructure_executed",
  "5e684647-324c-4f31-90aa-59d9ca6a596c": "servicing",
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

  // GHL delivers two shapes:
  //  1) Native event webhooks: { type: "OpportunityCreate", opportunity: {...}, contact: {...} }
  //  2) Workflow "Webhook" action: flat snake_case fields (id, pipeline_id, pipleline_stage,
  //     contact_id, lead_value, first_name, ...) with our key/value pairs nested under `customData`.
  // Support both. Prefer an explicit type; otherwise infer from the payload shape.
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const type = String(evt.type ?? evt.eventType ?? cd.type ?? "");
  const looksLikeOpportunity = !!(evt.pipeline_id || evt.opportunity_name || evt.opportunity || cd.opportunityId);
  const looksLikeContact = !!(evt.contact_id || evt.contactId || evt.contact);
  try {
    if (type.startsWith("Opportunity") || (!type && looksLikeOpportunity)) {
      await handleOpportunity(db, evt);
    } else if (type.startsWith("Contact") || (!type && looksLikeContact)) {
      await handleContact(db, evt);
    } else {
      // Acknowledge unhandled events so GHL doesn't retry forever.
      await logEvent(db, evt, type, "ignored", "unhandled event type");
      return json({ ok: true, ignored: type || "unknown" });
    }
    await logEvent(db, evt, type, "processed", null);
    return json({ ok: true, type });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await logEvent(db, evt, type, "error", msg);
    return json({ ok: false, type, error: msg }, 500);
  }
});

// Best-effort inbound event log (observability for Gap A/B). Never throws.
async function logEvent(db: DB, evt: Record<string, unknown>, type: string, outcome: string, detail: string | null) {
  try {
    const c = (evt.contact ?? {}) as Record<string, unknown>;
    const o = (evt.opportunity ?? {}) as Record<string, unknown>;
    const cd = (evt.customData ?? {}) as Record<string, unknown>;
    await db.from("ghl_webhook_events").insert({
      event_type: type || null,
      ghl_contact_id: (c.id ?? evt.contactId ?? evt.contact_id ?? cd.contactId ?? o.contactId ?? null) as string | null,
      ghl_opportunity_id: (o.id ?? evt.opportunityId ?? cd.opportunityId ?? (evt.pipeline_id ? evt.id : null) ?? null) as string | null,
      outcome,
      detail,
      payload: evt,
    });
  } catch { /* best-effort */ }
}

type DB = ReturnType<typeof serviceClient>;

async function handleContact(db: DB, evt: Record<string, unknown>) {
  const c = (evt.contact ?? evt) as Record<string, unknown>;
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  // Contact id: native (contact.id / contactId) or flat workflow payload (contact_id / customData.contactId).
  const ghlId = String(evt.contactId ?? cd.contactId ?? evt.contact_id ?? c.id ?? "");
  const email = (c.email ?? evt.email ?? null) as string | null;
  if (!ghlId && !email) return;

  const patch = {
    first_name: (c.firstName ?? evt.first_name ?? undefined) as string | undefined,
    last_name: (c.lastName ?? evt.last_name ?? undefined) as string | undefined,
    email: email ?? undefined,
    phone: (c.phone ?? evt.phone ?? undefined) as string | undefined,
    business_name: (c.companyName ?? evt.company_name ?? undefined) as string | undefined,
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
      .insert({ ...patch, status: "lead", source: "other" }).select("id").maybeSingle();
    if (created) await log(db, "customer", created.id, `ghl:${String(evt.type)}`, evt);
  }
}

async function handleOpportunity(db: DB, evt: Record<string, unknown>) {
  const o = (evt.opportunity ?? evt) as Record<string, unknown>;
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  // Opportunity id: native (o.id) or flat workflow payload (evt.id / customData.opportunityId).
  const oppId = String(o.id ?? evt.opportunityId ?? cd.opportunityId ?? evt.id ?? "");
  if (!oppId) return;

  // Resolve the GHL stage -> our deal status. Prefer stage id (native), then stage NAME
  // (the workflow webhook only sends the name, under GHL's misspelled key "pipleline_stage").
  const stageId = String(o.pipelineStageId ?? o.stageId ?? evt.pipelineStageId ?? "");
  const stageName = String(
    o.stageName ?? o.pipelineStageName ?? evt.pipelineStageName ?? evt.pipleline_stage ?? evt.pipeline_stage ?? "",
  ).toLowerCase().trim();
  const mapped = STATUS_BY_STAGE_ID[stageId] ?? STATUS_BY_STAGE[stageName] ?? null;

  // Monetary value: native (monetaryValue) or flat (lead_value).
  const monetary = (o.monetaryValue ?? evt.lead_value ?? null) as number | null;

  const { data: deal } = await db.from("deals").select("id,status,customer_id").eq("ghl_opportunity_id", oppId).maybeSingle();

  // ── Gap A: create the deal if this opportunity isn't linked to one yet ──
  if (!deal) {
    const pipelineId = String(o.pipelineId ?? evt.pipelineId ?? evt.pipeline_id ?? "");
    // Auto-create for the MCA and VCF pipelines; ignore anything else.
    const dealType = pipelineId === VCF_PIPELINE_ID ? "vcf" : pipelineId === MCA_PIPELINE_ID ? "mca" : null;
    if (!dealType) return;

    const contactId = String(
      o.contactId ?? evt.contactId ?? cd.contactId ?? evt.contact_id ?? (evt.contact as Record<string, unknown> | undefined)?.id ?? "",
    );
    if (!contactId) return; // can't tie a deal to a merchant without a contact

    // Find the customer by ghl_contact_id; create a minimal one if missing
    // (a Contact event will enrich it later).
    let customerId: string | null = null;
    const { data: cust } = await db.from("customers").select("id").eq("ghl_contact_id", contactId).maybeSingle();
    if (cust) {
      customerId = cust.id;
    } else {
      const c = (evt.contact ?? {}) as Record<string, unknown>;
      const { data: created } = await db.from("customers").insert({
        ghl_contact_id: contactId,
        first_name: (c.firstName ?? evt.first_name ?? null) as string | null,
        last_name: (c.lastName ?? evt.last_name ?? null) as string | null,
        email: (c.email ?? evt.email ?? null) as string | null,
        phone: (c.phone ?? evt.phone ?? null) as string | null,
        business_name: (c.companyName ?? evt.company_name ?? o.name ?? evt.opportunity_name ?? null) as string | null,
        status: "lead",
        source: "other",
      }).select("id").maybeSingle();
      customerId = created?.id ?? null;
    }
    if (!customerId) return;

    const status = mapped ?? (dealType === "vcf" ? "new_distressed" : "new");
    const insert: Record<string, unknown> = {
      customer_id: customerId,
      deal_type: dealType,
      status,
      amount_requested: monetary,
      ghl_contact_id: contactId,
      ghl_opportunity_id: oppId,
      lead_source: "ghl_other",
    };
    if (status === "funded" && monetary != null) insert.amount_funded = monetary;
    const { data: newDeal } = await db.from("deals").insert(insert).select("id").maybeSingle();
    if (newDeal) await log(db, "deal", newDeal.id, `ghl:${evtTypeLabel(evt)}:created`, { stage: mapped, evt });
    return;
  }

  // ── Existing deal: mirror the stage change from GHL ──
  const patch: Record<string, unknown> = {};
  if (mapped && mapped !== deal.status) patch.status = mapped;
  if (monetary != null) patch.amount_requested = monetary;

  if (Object.keys(patch).length) {
    await db.from("deals").update(patch).eq("id", deal.id);
    await log(db, "deal", deal.id, `ghl:${evtTypeLabel(evt)}`, { from: deal.status, to: patch.status, evt });
  }
}

// Best-effort event-type label for activity logging (native type or workflow customData.type).
function evtTypeLabel(evt: Record<string, unknown>): string {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  return String(evt.type ?? evt.eventType ?? cd.type ?? "opportunity");
}

async function log(db: DB, entityType: string, entityId: string, action: string, meta: unknown) {
  try {
    await db.from("activity_log").insert({
      entity_type: entityType, entity_id: entityId,
      interaction_type: "system", subject: action, content: JSON.stringify(meta),
    });
  } catch { /* best-effort */ }
}
