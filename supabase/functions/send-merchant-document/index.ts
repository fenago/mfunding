// send-merchant-document — merge a merchant document template against a deal,
// freeze it, inject the state disclosure, and send the merchant to sign it.
//
// POST { deal_id, template_id }
//
// Mirrors send-closer-onboarding-package: the raw template has [COMPANY] /
// [BUSINESS NAME] / [MERCHANT NAME] / [DATE] / [STATE_DISCLOSURE] tokens — the
// merge substitutes real values SERVER-SIDE and freezes the result
// (merged_content + content_sha256) onto a merchant_documents row (status 'sent').
// That frozen text — not the mutable template — is what the merchant reads and
// what the signature ledger hashes.
//
// 4.4 disclosures: the matched compliance_disclosures body (by product_type +
// customer.address_state) is injected at [STATE_DISCLOSURE]. Its own per-offer
// brackets ([APR], [TOTAL_REPAYMENT], …) are the funder's to fill at offer time
// and are NOT treated as unresolved. Only OUR tokens block the send.
//
// Auth: verify_jwt = true + in-code check — ops staff (admin/super_admin/employee)
// OR the closer who owns the deal.
//
// Compliance: MCA = purchase of future receivables, never a "loan".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact, sendMarker,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";
import { mergeMerchantDoc, sha256Hex } from "../_shared/merchantDocMerge.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { deal_id?: string; template_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.deal_id;
  const templateId = payload.template_id;
  if (!dealId || !templateId) return json({ error: "deal_id and template_id are required" }, 400);

  const db = serviceClient();

  // --- Auth: ops staff, OR the closer who owns this deal. ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  // Load the deal + its customer first (needed for both authz and the merge).
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, customer_id, deal_type, amount_requested, use_of_funds")
    .eq("id", dealId)
    .maybeSingle();
  if (dErr || !deal) return json({ error: "deal not found" }, 404);

  const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
  let allowed = staff === true;
  if (!allowed) {
    const { data: owns } = await db.rpc("closer_owns_customer", {
      uid: caller.id,
      cust_id: deal.customer_id,
    });
    allowed = owns === true;
  }
  if (!allowed) return json({ error: "Forbidden — this deal isn't yours to send documents on" }, 403);

  const { data: customer, error: cErr } = await db
    .from("customers")
    .select(
      "id, user_id, first_name, last_name, business_name, email, phone, " +
      "address_street, address_city, address_state, address_zip, ein, " +
      "time_in_business, monthly_revenue, industry, business_type, " +
      "amount_requested, use_of_funds",
    )
    .eq("id", deal.customer_id as string)
    .maybeSingle();
  if (cErr || !customer) return json({ error: "customer not found" }, 404);

  // --- Load the template. ---
  const { data: tmpl, error: tErr } = await db
    .from("merchant_doc_templates")
    .select("id, slug, name, product_type, body_md, active, version")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr || !tmpl) return json({ error: "template not found" }, 404);
  if (!tmpl.active) return json({ error: "This template is inactive." }, 422);

  // --- Company legal name: single source of truth (platform_settings). ---
  const { data: settingRow } = await db
    .from("platform_settings").select("value").eq("key", "closer_docs").maybeSingle();
  const companyLegalName =
    ((settingRow?.value ?? {}) as { company_legal_name?: string }).company_legal_name ??
    "Momentum Funding";

  // --- 4.4: pick the state disclosure by product_type + merchant state. Prefer an
  // exact product match over a catch-all 'all' row. ---
  let disclosureBody: string | null = null;
  const state = (customer.address_state as string | null)?.trim().toUpperCase() || null;
  const productType = (deal.deal_type as string | null) ?? tmpl.product_type ?? "mca";
  if (state) {
    const { data: discs } = await db
      .from("compliance_disclosures")
      .select("state, product_type, body, is_active")
      .eq("state", state)
      .eq("is_active", true)
      .in("product_type", [productType, "all"]);
    if (discs?.length) {
      const exact = discs.find((d) => d.product_type === productType);
      disclosureBody = (exact ?? discs[0]).body as string;
    }
  }

  // --- Build the per-field application data (SOFT tokens). Anything null renders
  // as a labeled blank; none of these block the send. ---
  const usd = (v: unknown): string | null => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    if (!Number.isFinite(n)) return null;
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };
  const cityStateZip = [customer.address_city, customer.address_state, customer.address_zip]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(", ");
  const tib = customer.time_in_business as number | null;
  const timeInBusiness = tib != null && Number.isFinite(tib)
    ? (tib >= 12
      ? `${tib} months (${(tib / 12).toFixed(tib % 12 === 0 ? 0 : 1)} years)`
      : `${tib} months`)
    : null;
  const email = (customer.email as string | null) ?? null;
  const phone = (customer.phone as string | null) ?? null;
  const fields: Record<string, string | null> = {
    "[BUSINESS ADDRESS]": (customer.address_street as string | null) ?? null,
    "[BUSINESS CITY STATE ZIP]": cityStateZip || null,
    "[BUSINESS PHONE]": phone,
    "[BUSINESS EMAIL]": email,
    "[CELL PHONE]": phone,
    "[OWNER EMAIL]": email,
    "[EIN]": (customer.ein as string | null) ?? null,
    "[ENTITY TYPE]": (customer.business_type as string | null) ?? null,
    "[INDUSTRY]": (customer.industry as string | null) ?? null,
    "[MONTHLY REVENUE]": usd(customer.monthly_revenue),
    "[AMOUNT REQUESTED]": usd(deal.amount_requested ?? customer.amount_requested),
    "[USE OF FUNDS]": (deal.use_of_funds as string | null) ?? (customer.use_of_funds as string | null) ?? null,
    "[TIME IN BUSINESS]": timeInBusiness,
    "[TITLE]": null, // no column; merchant fills on the signed page
  };

  // --- Merge + freeze. One unresolved HARD token blocks the send. ---
  const merchantName = `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim();
  const { content, missing } = mergeMerchantDoc(tmpl.body_md as string, {
    companyLegalName,
    businessName: customer.business_name as string | null,
    merchantName,
    effectiveDate: null, // today
    disclosureBody,
    fields,
  });
  if (missing.length) {
    return json({
      ok: false,
      error: "This document still has unfilled fields. Nothing was sent.",
      missing,
    }, 422);
  }

  const sha = await sha256Hex(content);
  const nowIso = new Date().toISOString();

  const { data: docRow, error: insErr } = await db
    .from("merchant_documents")
    .insert({
      deal_id: dealId,
      customer_id: customer.id,
      template_id: tmpl.id,
      template_slug: tmpl.slug,
      name: tmpl.name,
      merged_content: content,
      content_sha256: sha,
      status: "sent",
      disclosure_state: disclosureBody ? state : null,
      created_by: caller.id,
      sent_at: nowIso,
    })
    .select("id")
    .single();
  if (insErr || !docRow) return json({ error: `could not create document: ${insErr?.message}` }, 500);

  const documentId = docRow.id as string;

  // --- Notify the merchant (best-effort; the doc also shows in their portal). ---
  let emailed = false;
  let emailNote: string | undefined;
  if (customer.email) {
    try {
      const cfg = await getGhlConfig(db);
      const cr = await upsertContact(cfg, {
        email: customer.email as string,
        firstName: (customer.first_name as string) ?? undefined,
        lastName: (customer.last_name as string) ?? undefined,
        tags: ["merchant", "portal"],
        source: "Merchant Portal",
      });
      const contactId = cr.data?.contact?.id ?? null;
      if (contactId) {
        const firstName = (customer.first_name as string) ?? "there";
        const portalUrl = `${APP_URL}/portal`;
        const subject = `Your funding documents are ready to review and sign`;
        const html = renderMerchantEmail({
          greeting: `Hi ${firstName},`,
          paragraphs: [
            `Your ${tmpl.name} is ready. Please sign in to your portal to read it in full and sign.`,
          ],
          ctaLabel: "Review & sign in your portal",
          ctaUrl: portalUrl,
          footerNote: "Signing takes a minute — type your full legal name and confirm you agree.",
        });
        const text = `Hi ${firstName},\n\nYour ${tmpl.name} is ready to review and sign. Sign in to your portal: ${portalUrl}\n\n— Momentum Funding`;
        const sr = await sendEmailToContact(cfg, contactId, subject, html, { text });
        emailed = sr.ok;
        if (!sr.ok) emailNote = sr.error;
        // Audit trail (best-effort).
        try {
          await db.from("activity_log").insert({
            entity_type: "deal", entity_id: dealId, interaction_type: "email",
            subject: `merchant:email — ${subject}`,
            content: `Sent "${tmpl.name}" to sign (${customer.email})` + sendMarker(sr.data),
            logged_by: caller.id,
          });
        } catch { /* best-effort */ }
      } else {
        emailNote = cr.error ?? "no contact id";
      }
    } catch (e) {
      emailNote = e instanceof Error ? e.message : String(e);
    }
  } else {
    emailNote = "customer has no email on file";
  }

  return json({
    ok: true,
    document_id: documentId,
    status: "sent",
    sha256: sha,
    disclosure_state: disclosureBody ? state : null,
    emailed,
    email_note: emailNote,
  });
});
