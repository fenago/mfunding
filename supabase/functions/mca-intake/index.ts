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

  // 2) MCA deal at "new" (New Lead)
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

  // 3) Best-effort: create GHL contact + MCA opportunity (never fail the intake on this)
  try {
    const cfg = await getGhlConfig(db);
    const cr = await upsertContact(cfg, {
      firstName, lastName, email, phone, companyName: business, source: "MCA Web",
    });
    const contactId = cr.data?.contact?.id;
    if (contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
      await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", deal.id);
      const pl = await listPipelines(cfg);
      // Use the canonical "MFunding MCA Pipeline" by id (same id the ghl-webhook
      // inbound sync keys off, so stage changes round-trip). Fall back to a heuristic
      // that uniquely identifies it via the "renewal eligible" stage — needed because
      // several other MCA-like pipelines (incl. an INACTIVE MCA-Restructure one) also
      // have "new lead" + "funded" and would otherwise win.
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
        if (oppId) await db.from("deals").update({ ghl_opportunity_id: oppId }).eq("id", deal.id);
      }
    }
  } catch (_e) { /* GHL sync is best-effort */ }

  return json({ ok: true, deal_id: deal.id });
});
