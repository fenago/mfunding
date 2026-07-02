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
  listCustomFields, updateContactCustomFields, findFieldByName, addContactTags,
  createBusiness, linkContactToBusiness,
} from "../_shared/ghl.ts";

// ---- Funder / vendor → Business + Contact(s) helpers -------------------------

// Status → GHL tag so the Comms page can filter (lender vs vendor, active vs prospect).
function lenderStatusTag(s: string | null): string {
  switch (s) {
    case "live_vendor": case "approved": return "funder-active";
    case "application_submitted": return "funder-pending";
    case "inactive": case "rejected": return "funder-inactive";
    default: return "funder-prospect";
  }
}
function vendorStatusTag(s: string | null): string {
  switch (s) {
    case "active": return "vendor-active";
    case "testing": return "vendor-testing";
    case "discontinued": return "vendor-inactive";
    default: return "vendor-prospect";
  }
}

/** Pull the first usable phone out of a messy string and return E.164 (US default), or null. */
function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/\+?\d[\d\s().-]{6,}/);
  if (!m) return null;
  let d = m[0].replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  d = d.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : null;
}

interface JsonPerson { name?: string; email?: string; phone?: string; title?: string }

// Deal status → GHL pipeline stage name (matched case-insensitively).
// Known GHL pipeline IDs (5 pipelines exist; don't rely on order).
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
const VCF_PIPELINE_ID = "nsmH6jIeVA0SsZMMq4LC";

const STAGE_BY_STATUS: Record<string, string> = {
  new: "New Lead",
  contacted: "Contacted",
  qualifying: "Qualifying",
  application_sent: "Application Sent",
  docs_collected: "Docs Collected",
  bank_statements: "Bank Statements",
  submitted_to_funder: "Submitted to Funders",
  offer_received: "Offer Received",
  offer_presented: "Offer Presented",
  offer_accepted: "Offer Accepted",
  funded: "Funded",
  renewal_eligible: "Renewal Eligible",
  nurture: "Nurture / Re-engage",
  // VCF pipeline stages
  new_distressed: "New Lead (Distressed)",
  hardship_consult: "Hardship Consultation",
  positions_analysis: "Positions & Balances Analysis",
  strategy_proposal: "Strategy / Proposal",
  agreement_sent: "Agreement Sent",
  submitted_to_vcf: "Submitted to VCF",
  restructure_executed: "Restructure Executed",
  servicing: "Servicing / Monitoring",
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

    // Tag the deal's GHL contact submit:<funder> for each funder we submitted to,
    // which fires that funder's per-funder email workflow in GHL (Gap B — GHL sends).
    if (body.action === "tag_funders") {
      const dealId = body.id as string | undefined;
      const lenderIds = (body.lender_ids as string[] | undefined) ?? [];
      if (!dealId || lenderIds.length === 0) return json({ error: "id (deal) and lender_ids required" }, 400);

      const { data: d, error } = await db
        .from("deals")
        .select("ghl_contact_id, customer:customers!customer_id(ghl_contact_id)")
        .eq("id", dealId).single();
      if (error || !d) return json({ error: `deal not found: ${error?.message}` }, 404);
      const contactId = d.ghl_contact_id ?? d.customer?.ghl_contact_id ?? null;
      if (!contactId) return json({ error: "deal has no linked GHL contact — sync the deal first" }, 422);

      const { data: lenders } = await db.from("lenders").select("ghl_tag_slug").in("id", lenderIds);
      const tags = (lenders ?? [])
        .map((l: { ghl_tag_slug: string | null }) => l.ghl_tag_slug)
        .filter(Boolean)
        .map((slug: string) => `submit:${slug}`);
      if (tags.length === 0) return json({ ok: true, tagged: [], warning: "No GHL tag slugs on those funders." });

      const r = await addContactTags(cfg, contactId, tags);
      if (!r.ok) return json({ error: `GHL tag failed (${r.status}): ${r.error}` }, 502);
      await logActivity(db, "deal", dealId, "ghl_funder_tags_added", { tags });
      return json({ ok: true, tagged: tags });
    }


// Custom fields the e-sign documents pre-fill from ("linked fields"). Only
// fields we reliably store; option-list fields (industry, monthly revenue
// ranges) are skipped so an unmatched value can't fail the upsert.
// deno-lint-ignore no-explicit-any
function docPrefillFields(cust: any, deal?: any) {
  const out: { key: string; field_value: unknown }[] = [];
  const add = (key: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") out.push({ key, field_value: v });
  };
  add("business_name", cust?.business_name);
  add("months_in_business", cust?.time_in_business);
  add("funding_amount_requested", deal?.amount_requested);
  return out;
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
        customFields: docPrefillFields(c),
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
      if (cust) {
        // Always upsert: dedupes by email/phone AND refreshes the doc-prefill
        // custom fields (business name, months in business, amount requested)
        // so e-sign documents sent after this sync arrive pre-filled.
        const cr = await upsertContact(cfg, {
          firstName: cust.first_name, lastName: cust.last_name,
          email: cust.email, phone: cust.phone, companyName: cust.business_name,
          source: cust.source ?? "MFunding App",
          customFields: docPrefillFields(cust, d),
        });
        if (!cr.ok && !contactId) return json({ error: `GHL contact upsert failed (${cr.status}): ${cr.error}` }, 502);
        contactId = cr.data?.contact?.id ?? contactId;
        if (contactId && !cust.ghl_contact_id) await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", cust.id);
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
      // Pick the right pipeline by deal type. Prefer the known pipeline ID
      // (5 pipelines exist in the account, incl. an inactive Marketing one), and
      // fall back to a stage-name match if the IDs ever change.
      const isVcf = d.deal_type === "vcf";
      const wantId = isVcf ? VCF_PIPELINE_ID : MCA_PIPELINE_ID;
      const pipeline =
        pl.data.pipelines.find((p) => p.id === wantId) ??
        (isVcf
          ? pl.data.pipelines.find((p) => {
              const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
              return n.has("new lead (distressed)") || n.has("servicing / monitoring");
            })
          : pl.data.pipelines.find((p) => {
              const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
              return n.has("new lead") && n.has("funded");
            })
        ) ?? pl.data.pipelines[0];

      // Won / Lost are GHL opportunity STATUSES, not stages: funded => won,
      // declined/dead => lost (removed from the active board). Everything else is open.
      const isWon = d.status === "funded";
      const isLost = d.status === "declined" || d.status === "dead";
      const oppStatus: "open" | "won" | "lost" = isWon ? "won" : isLost ? "lost" : "open";

      // Resolve a stage. Lost statuses have no forward stage — park them in
      // "Nurture / Re-engage" (or the first stage) since the Lost status is what
      // actually pulls them off the board.
      const wantStage = (STAGE_BY_STATUS[d.status] ?? "Nurture / Re-engage").toLowerCase();
      const stage = pipeline.stages.find((s) => s.name.toLowerCase() === wantStage) ?? pipeline.stages[0];

      const name = cust?.business_name || `${cust?.first_name ?? ""} ${cust?.last_name ?? ""}`.trim() || `Deal ${id.slice(0, 8)}`;

      let oppId = d.ghl_opportunity_id as string | null;
      const r = oppId
        ? await updateOpportunity(cfg, oppId, { pipelineStageId: stage.id, status: oppStatus, monetaryValue: d.amount_requested ?? undefined })
        : await createOpportunity(cfg, { pipelineId: pipeline.id, pipelineStageId: stage.id, contactId, name, status: oppStatus, monetaryValue: d.amount_requested ?? undefined });
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

    // ---- LENDER (funder) → BUSINESS + CONTACTS -------------------------------
    if (entity === "lender") {
      const { data: l, error } = await db.from("lenders").select("*").eq("id", id).single();
      if (error || !l) return json({ error: `lender not found: ${error?.message}` }, 404);

      // 1) Business (group all this funder's people under it).
      let businessId: string | null = l.ghl_business_id ?? null;
      if (!businessId) {
        const b = await createBusiness(cfg, { name: l.company_name, website: l.website });
        businessId = b.data?.business?.id ?? null;
        if (businessId) await db.from("lenders").update({ ghl_business_id: businessId }).eq("id", id);
      }

      const baseTags = ["lender", "funder-network", "mfunding-import", lenderStatusTag(l.status)];

      // 2) Primary contact (keeps the company phone).
      const primaryEmail = l.primary_contact_email ?? l.submission_email ?? null;
      const primaryPhone = toE164(l.primary_contact_phone);
      let contactId: string | null = l.ghl_contact_id ?? null;
      if (primaryEmail || primaryPhone) {
        const cr = await upsertContact(cfg, {
          name: l.primary_contact_name ?? l.company_name,
          email: primaryEmail, phone: primaryPhone,
          companyName: l.company_name, website: l.website,
          source: "MFunding network", tags: baseTags,
        });
        if (cr.ok) {
          contactId = cr.data?.contact?.id ?? contactId;
          if (contactId && businessId) await linkContactToBusiness(cfg, contactId, businessId);
          if (contactId) await db.from("lenders").update({ ghl_contact_id: contactId }).eq("id", id);
        }
      }

      // 3) Extra people from contacts[] — email-keyed; never reuse the company
      //    phone across people (GHL dedupes by phone and would merge them).
      const people = (Array.isArray(l.contacts) ? l.contacts : []) as JsonPerson[];
      let extra = 0;
      for (const p of people) {
        const pEmail = p.email?.trim() || null;
        const pPhone = pEmail ? null : toE164(p.phone); // phone only when no email
        if (!pEmail && !pPhone) continue;
        if (pEmail && primaryEmail && pEmail.toLowerCase() === primaryEmail.toLowerCase()) continue;
        const pr = await upsertContact(cfg, {
          name: p.name ?? l.company_name, email: pEmail, phone: pPhone,
          companyName: l.company_name, website: l.website,
          source: "MFunding network", tags: baseTags,
        });
        const pid = pr.data?.contact?.id;
        if (pid && businessId) { await linkContactToBusiness(cfg, pid, businessId); extra++; }
      }

      await logActivity(db, "lender", id, "ghl_business_synced", { businessId, contactId, extra });
      return json({ ok: true, ghl_business_id: businessId, ghl_contact_id: contactId, people_synced: extra });
    }

    // ---- MARKETING VENDOR (lead source) → BUSINESS + CONTACT -----------------
    if (entity === "vendor") {
      const { data: v, error } = await db.from("marketing_vendors").select("*").eq("id", id).single();
      if (error || !v) return json({ error: `vendor not found: ${error?.message}` }, 404);

      let businessId: string | null = v.ghl_business_id ?? null;
      if (!businessId) {
        const b = await createBusiness(cfg, { name: v.vendor_name, website: v.website });
        businessId = b.data?.business?.id ?? null;
        if (businessId) await db.from("marketing_vendors").update({ ghl_business_id: businessId }).eq("id", id);
      }

      const email = v.contact_email ?? null;
      const phone = toE164(v.contact_phone);
      let contactId: string | null = v.ghl_contact_id ?? null;
      if (email || phone) {
        const cr = await upsertContact(cfg, {
          name: v.contact_name ?? v.vendor_name,
          email, phone, companyName: v.vendor_name, website: v.website,
          source: "MFunding network", tags: ["lead-vendor", "marketing-vendor", "mfunding-import", vendorStatusTag(v.status)],
        });
        if (cr.ok) {
          contactId = cr.data?.contact?.id ?? contactId;
          if (contactId && businessId) await linkContactToBusiness(cfg, contactId, businessId);
          if (contactId) await db.from("marketing_vendors").update({ ghl_contact_id: contactId }).eq("id", id);
        }
      }

      await logActivity(db, "marketing_vendor", id, "ghl_business_synced", { businessId, contactId });
      return json({ ok: true, ghl_business_id: businessId, ghl_contact_id: contactId });
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
