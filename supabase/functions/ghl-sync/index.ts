// ghl-sync — OUTBOUND sync: push a Supabase customer or deal into GoHighLevel.
//
// POST body:
//   { "entity": "customer", "id": "<customer uuid>" }
//   { "entity": "deal",     "id": "<deal uuid>" }
//   { "action": "pipelines" }   // utility: list GHL pipelines + stage IDs
//
// - customer → upsert GHL contact (dedupe by email/phone), save customers.ghl_contact_id
// - deal     → ensure contact exists, upsert opportunity into the deal pipeline,
//              save deals.ghl_contact_id + deals.ghl_opportunity_id
//
// Auth: requires a valid Supabase JWT (called from the admin app via
// supabase.functions.invoke). Credentials come from the vault, never the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig,
  upsertContact, createOpportunity, updateOpportunity, listPipelines,
  listCustomFields, updateContactCustomFields, findFieldByName,
} from "../_shared/ghl.ts";

// Deal status → GHL pipeline stage name (matched case-insensitively).
const STAGE_BY_STATUS: Record<string, string> = {
  new: "New Lead",
  contacted: "Contacted",
  qualifying: "Qualifying",
  application_sent: "Application Sent",
  docs_collected: "Docs Collected",
  submitted_to_funder: "Submitted to Funder",
  offer_received: "Offer Received",
  offer_presented: "Offer Presented",
  funded: "Funded",
  renewal_eligible: "Renewal Eligible",
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

  try {
    const db = serviceClient();
    const cfg = await getGhlConfig(db);
    const body = await req.json().catch(() => ({}));

    // Utility: list pipelines so we can wire stage IDs.
    if (body.action === "pipelines") {
      const r = await listPipelines(cfg);
      return json({ ok: r.ok, status: r.status, pipelines: r.data?.pipelines ?? [], error: r.error });
    }

    // Push a deal's paydown % to the GHL "Paydown %" contact field so GHL's
    // renewal workflow can fire at 40/60/75/100%. Automation lives in GHL.
    if (body.action === "paydown") {
      const dealId = body.id as string | undefined;
      if (!dealId) return json({ error: "id (deal) required" }, 400);
      const { data: d, error } = await db
        .from("deals")
        .select("id, paydown_percentage, ghl_contact_id, customer:customers!customer_id(ghl_contact_id)")
        .eq("id", dealId).single();
      if (error || !d) return json({ error: `deal not found: ${error?.message}` }, 404);
      const contactId = d.ghl_contact_id ?? d.customer?.ghl_contact_id ?? null;
      if (!contactId) return json({ error: "deal has no linked GHL contact — sync the deal first" }, 422);

      const cf = await listCustomFields(cfg);
      if (!cf.ok) return json({ error: `could not read custom fields (${cf.status}): ${cf.error}` }, 502);
      const field = findFieldByName(cf.data?.customFields ?? [], "paydown");
      if (!field) {
        return json({ ok: true, pushed: false, warning: "No 'Paydown %' custom field in GHL yet — create it, then re-push." });
      }
      const r = await updateContactCustomFields(cfg, contactId, [{ id: field.id, value: d.paydown_percentage ?? 0 }]);
      if (!r.ok) return json({ error: `GHL custom-field update failed (${r.status}): ${r.error}` }, 502);
      await logActivity(db, "deal", dealId, "ghl_paydown_pushed", { paydown: d.paydown_percentage, field: field.name });
      return json({ ok: true, pushed: true, paydown: d.paydown_percentage });
    }

    const { entity, id } = body as { entity?: string; id?: string };
    if (!entity || !id) return json({ error: "entity and id are required" }, 400);

    // ---- CUSTOMER → CONTACT --------------------------------------------------
    if (entity === "customer") {
      const { data: c, error } = await db.from("customers").select("*").eq("id", id).single();
      if (error || !c) return json({ error: `customer not found: ${error?.message}` }, 404);

      const r = await upsertContact(cfg, {
        firstName: c.first_name, lastName: c.last_name,
        email: c.email, phone: c.phone, companyName: c.business_name,
        address1: c.address_street, city: c.address_city,
        state: c.address_state, postalCode: c.address_zip,
        source: c.source ?? "MFunding App", tags: c.tags ?? [],
      });
      if (!r.ok) return json({ error: `GHL upsert failed (${r.status}): ${r.error}` }, 502);

      const contactId = r.data?.contact?.id;
      if (contactId) await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", id);
      await logActivity(db, "customer", id, "ghl_contact_synced", { ghl_contact_id: contactId });
      return json({ ok: true, ghl_contact_id: contactId });
    }

    // ---- DEAL → OPPORTUNITY --------------------------------------------------
    if (entity === "deal") {
      const { data: d, error } = await db
        .from("deals")
        .select("*, customer:customers!customer_id(*)")
        .eq("id", id).single();
      if (error || !d) return json({ error: `deal not found: ${error?.message}` }, 404);
      const cust = d.customer;

      // 1) Ensure a contact exists.
      let contactId: string | null = d.ghl_contact_id ?? cust?.ghl_contact_id ?? null;
      if (!contactId && cust) {
        const cr = await upsertContact(cfg, {
          firstName: cust.first_name, lastName: cust.last_name,
          email: cust.email, phone: cust.phone, companyName: cust.business_name,
          source: cust.source ?? "MFunding App",
        });
        if (!cr.ok) return json({ error: `GHL contact upsert failed (${cr.status}): ${cr.error}` }, 502);
        contactId = cr.data?.contact?.id ?? null;
        if (contactId) await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", cust.id);
      }
      if (!contactId) return json({ error: "could not resolve a GHL contact for this deal" }, 422);

      // 2) Resolve pipeline + stage.
      const pl = await listPipelines(cfg);
      if (!pl.ok || !pl.data?.pipelines?.length) {
        // Contact synced; opportunity needs a pipeline in GHL first.
        await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", id);
        return json({
          ok: true, ghl_contact_id: contactId, ghl_opportunity_id: null,
          warning: "No GHL pipeline found — create the 9-stage pipeline in GHL, then re-sync to attach an opportunity.",
        });
      }
      // Pick the MCA pipeline by stage-name match — there may also be a VCF
      // pipeline, so don't blindly take pipelines[0].
      const pipeline = pl.data.pipelines.find((p) => {
        const names = new Set(p.stages.map((s) => s.name.toLowerCase()));
        return names.has("new lead") && names.has("funded");
      }) ?? pl.data.pipelines[0];
      const wantStage = (STAGE_BY_STATUS[d.status] ?? "New Lead").toLowerCase();
      const stage = pipeline.stages.find((s) => s.name.toLowerCase() === wantStage) ?? pipeline.stages[0];

      const name = cust?.business_name || `${cust?.first_name ?? ""} ${cust?.last_name ?? ""}`.trim() || `Deal ${id.slice(0, 8)}`;
      const oppFields = {
        pipelineId: pipeline.id, pipelineStageId: stage.id, contactId,
        name, monetaryValue: d.amount_requested ?? undefined,
      };

      let oppId = d.ghl_opportunity_id as string | null;
      const r = oppId
        ? await updateOpportunity(cfg, oppId, { pipelineStageId: stage.id, monetaryValue: d.amount_requested ?? undefined })
        : await createOpportunity(cfg, oppFields);
      if (!r.ok) return json({ error: `GHL opportunity ${oppId ? "update" : "create"} failed (${r.status}): ${r.error}` }, 502);
      oppId = oppId ?? r.data?.opportunity?.id ?? null;

      await db.from("deals").update({ ghl_contact_id: contactId, ghl_opportunity_id: oppId }).eq("id", id);

      // Keep GHL's "Paydown %" field current on every deal sync so the renewal
      // workflow (Sequence E) fires at 40/60/75/100% (best-effort).
      try {
        const cf = await listCustomFields(cfg);
        const field = cf.ok ? findFieldByName(cf.data?.customFields ?? [], "paydown") : undefined;
        if (field) await updateContactCustomFields(cfg, contactId, [{ id: field.id, value: d.paydown_percentage ?? 0 }]);
      } catch (_e) { /* paydown push is best-effort */ }

      await logActivity(db, "deal", id, "ghl_opportunity_synced", { ghl_opportunity_id: oppId, stage: stage.name });
      return json({ ok: true, ghl_contact_id: contactId, ghl_opportunity_id: oppId, stage: stage.name });
    }

    return json({ error: `unknown entity: ${entity}` }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

async function logActivity(db: ReturnType<typeof serviceClient>, entityType: string, entityId: string, action: string, meta: unknown) {
  try {
    await db.from("activity_log").insert({
      entity_type: entityType, entity_id: entityId,
      interaction_type: "system", subject: action, content: JSON.stringify(meta),
    });
  } catch { /* activity_log is best-effort */ }
}
