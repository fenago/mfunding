// mca-intake — PUBLIC intake for MCA / working-capital leads (calculators, Apply form, ads).
// Mirrors vcf-intake: creates the customer + an MCA deal server-side (service role),
// then best-effort creates the GHL contact + an MCA-pipeline opportunity at "New Lead"
// so the lead lands in GHL and fires the Speed-to-Lead workflow.
//
// Deployed with verify_jwt = false (public form). Validates input itself.
// Compliance: MCA is funding/working capital — never a "loan".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig,
  upsertContact, createOpportunity, listPipelines,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const firstName = String(body.contact_first_name ?? "").trim();
  const lastName = String(body.contact_last_name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const business = String(body.business_name ?? "").trim();
  if (!firstName || !email || !phone) return json({ error: "first name, email, and phone are required" }, 400);

  const db = serviceClient();

  // 1) Customer (dedupe by email)
  let customerId: string | null = null;
  const { data: existing } = await db.from("customers").select("id").eq("email", email).maybeSingle();
  if (existing) {
    customerId = existing.id;
  } else {
    const { data: c, error } = await db.from("customers").insert({
      first_name: firstName, last_name: lastName || null, email, phone,
      business_name: business || null, status: "lead", source: "other",
    }).select("id").single();
    if (error) return json({ error: `could not create customer: ${error.message}` }, 500);
    customerId = c.id;
  }

  // 2) MCA deal — DEDUPE (audit #15): reuse the customer's existing OPEN MCA deal
  // instead of creating a duplicate (and a duplicate GHL opportunity) on repeat
  // submissions. "Open" = not in a terminal stage.
  let dealId: string;
  let dealGhlContactId: string | null = null;
  const { data: openDeal } = await db.from("deals")
    .select("id, ghl_contact_id")
    .eq("customer_id", customerId).eq("deal_type", "mca")
    .not("status", "in", "(funded,declined,dead,nurture)")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (openDeal) {
    dealId = openDeal.id;
    dealGhlContactId = openDeal.ghl_contact_id ?? null;
    // Backfill amount / use-of-funds if this submission has them.
    const patch: Record<string, unknown> = {};
    const amt = num(body.amount_requested);
    if (amt != null) patch.amount_requested = amt;
    if (body.use_of_funds) patch.use_of_funds = body.use_of_funds as string;
    if (Object.keys(patch).length) await db.from("deals").update(patch).eq("id", dealId);
  } else {
    const { data: deal, error: dErr } = await db.from("deals").insert({
      customer_id: customerId,
      deal_type: "mca",
      status: "new",
      lead_source: String(body.lead_source ?? "mca_web"),
      lead_source_detail: (body.lead_source_detail as string) || null,
      amount_requested: num(body.amount_requested),
      use_of_funds: (body.use_of_funds as string) || null,
    }).select("id").single();
    if (dErr) return json({ error: `could not create deal: ${dErr.message}` }, 500);
    dealId = deal.id;
  }

  // 3) GHL sync — skip if the deal is already in GHL (no duplicate opportunity).
  // Failures are SURFACED, not swallowed (audit #8): we log + return a warning, and
  // the deal is left with ghl_contact_id IS NULL so a reconciliation job can re-push.
  let ghlSynced = !!dealGhlContactId;
  let ghlWarning: string | undefined;
  if (!ghlSynced) {
    try {
      const cfg = await getGhlConfig(db);
      const cr = await upsertContact(cfg, {
        firstName, lastName, email, phone, companyName: business, source: "MCA Web",
      });
      const contactId = cr.data?.contact?.id;
      if (!contactId) {
        ghlWarning = cr.error || "GHL upsert returned no contact id";
      } else {
        await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
        await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
        const pl = await listPipelines(cfg);
        // Canonical "MFunding MCA Pipeline" by id (same id ghl-webhook keys off, so
        // stage changes round-trip). Fallback heuristic uses the unique "renewal
        // eligible" stage so the INACTIVE MCA-Restructure pipeline doesn't win.
        const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
        const mca = pl.data?.pipelines?.find((p) => p.id === MCA_PIPELINE_ID)
          ?? pl.data?.pipelines?.find((p) => {
            const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
            return n.has("new lead") && n.has("renewal eligible");
          });
        const stage = mca?.stages.find((s) => s.name.toLowerCase() === "new lead") ?? mca?.stages[0];
        if (mca && stage) {
          const opp = await createOpportunity(cfg, {
            pipelineId: mca.id, pipelineStageId: stage.id, contactId,
            name: business || `${firstName} ${lastName}`.trim(),
          });
          const oppId = opp.data?.opportunity?.id;
          if (oppId) await db.from("deals").update({ ghl_opportunity_id: oppId }).eq("id", dealId);
        }
        ghlSynced = true;
      }
    } catch (e) {
      ghlWarning = e instanceof Error ? e.message : String(e);
    }
    if (!ghlSynced) console.error("mca-intake: GHL sync failed", { dealId, ghlWarning });
  }

  return json({ ok: true, deal_id: dealId, ghl_synced: ghlSynced, ghl_warning: ghlWarning });
});
