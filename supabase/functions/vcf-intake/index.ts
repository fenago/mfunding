// vcf-intake — PUBLIC intake for the VCF (debt relief / consolidation) product line.
// Creates the customer + a vcf deal server-side (service role, so no anon RLS needed),
// then best-effort creates the GHL contact + a VCF-pipeline opportunity so the lead
// also lands in GHL and fires the VCF intake workflow.
//
// Deployed with verify_jwt = false (public form). Validates input itself.

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

  // 2) VCF deal
  const { data: deal, error: dErr } = await db.from("deals").insert({
    customer_id: customerId,
    deal_type: "vcf",
    status: "new_distressed",
    lead_source: "vcf_web",
    vcf_active_positions: num(body.active_positions),
    vcf_total_balance: num(body.total_balance),
    vcf_daily_debit: num(body.daily_debit),
    vcf_current_funders: (body.current_funders as string) || null,
    vcf_hardship_reason: (body.hardship_reason as string) || null,
  }).select("id").single();
  if (dErr) return json({ error: `could not create deal: ${dErr.message}` }, 500);

  // 3) Best-effort: create GHL contact + VCF opportunity (never fail the intake on this)
  try {
    const cfg = await getGhlConfig(db);
    const cr = await upsertContact(cfg, {
      firstName, lastName, email, phone, companyName: business, source: "VCF Web",
    });
    const contactId = cr.data?.contact?.id;
    if (contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
      await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", deal.id);
      const pl = await listPipelines(cfg);
      const vcf = pl.data?.pipelines?.find((p) => {
        const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
        return n.has("new lead (distressed)") || n.has("servicing / monitoring");
      });
      const stage = vcf?.stages.find((s) => s.name.toLowerCase() === "new lead (distressed)") ?? vcf?.stages[0];
      if (vcf && stage) {
        const opp = await createOpportunity(cfg, {
          pipelineId: vcf.id, pipelineStageId: stage.id, contactId,
          name: business || `${firstName} ${lastName}`.trim(),
        });
        const oppId = opp.data?.opportunity?.id;
        if (oppId) await db.from("deals").update({ ghl_opportunity_id: oppId }).eq("id", deal.id);
      }
    }
  } catch (_e) { /* GHL sync is best-effort */ }

  return json({ ok: true, deal_id: deal.id });
});
