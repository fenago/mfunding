// submit-to-funders — Gap B: actually SEND the deal to the selected funders.
//
// The app records submissions in `deal_submissions`, but historically nothing
// emailed the funders. This function closes that gap: given a deal and a list of
// lender ids, it composes a submission email and sends it to each funder's
// `submission_email` THROUGH GHL (no third-party ESP — MFunding uses GHL for all
// email). Each funder is upserted as a GHL contact (tagged "funder") and emailed
// via the GHL conversations API. It records/updates the `deal_submissions` row,
// logs to `activity_log`, and the caller advances the deal stage.
//
// Invoked from the app (admin) via supabase.functions.invoke("submit-to-funders").
// verify_jwt = true (only authenticated staff can submit deals).
//
// Compliance: MCA is a purchase of future receivables, not a loan. This is a
// B2B ISO→funder submission, so funder-facing copy uses standard deal terminology
// but never calls the MCA a "loan".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const money = (n: unknown) =>
  n == null || n === "" ? "—" : `$${Number(n).toLocaleString("en-US")}`;

const tib = (months: unknown) => {
  const m = Number(months);
  if (!m || Number.isNaN(m)) return "—";
  if (m < 12) return `${m} months`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y} yr ${r} mo` : `${y} yr`;
};

interface Lender { id: string; name: string | null; submission_email: string | null; submission_portal_url: string | null }

function buildEmail(deal: Record<string, unknown>, c: Record<string, unknown>, notes?: string) {
  const owner = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
  const biz = (c.business_name as string) || "Unknown business";
  const rows: Array<[string, string]> = [
    ["Business", biz],
    ["Owner", owner],
    ["Industry", (c.industry as string) || (c.business_type as string) || "—"],
    ["State", (c.address_state as string) || "—"],
    ["EIN", (c.ein as string) || "—"],
    ["Time in business", tib(c.time_in_business)],
    ["Monthly revenue", money(c.monthly_revenue)],
    ["Credit range", (c.credit_score_range as string) || "—"],
    ["Amount requested", money(deal.amount_requested ?? c.amount_requested)],
    ["Use of funds", (deal.use_of_funds as string) || (c.use_of_funds as string) || "—"],
    ["Owner phone", (c.phone as string) || "—"],
    ["Owner email", (c.email as string) || "—"],
    ["Deal #", (deal.deal_number as string) || "—"],
  ];

  const textBody =
    `New MCA submission from MFunding (ISO).\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    (notes ? `\n\nNotes: ${notes}` : "") +
    `\n\nMCA = purchase of future receivables (not a loan). Bank statements and full stips are ready — reply and we'll send the complete file immediately.\n\n— MFunding Submissions`;

  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0f172a;font-weight:600">${v}</td></tr>`,
    )
    .join("");
  const htmlBody =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:560px">` +
    `<p style="margin:0 0 12px">New <strong>MCA submission</strong> from <strong>MFunding</strong> (ISO).</p>` +
    `<table style="border-collapse:collapse;margin:0 0 12px">${htmlRows}</table>` +
    (notes ? `<p style="margin:0 0 12px"><strong>Notes:</strong> ${notes}</p>` : "") +
    `<p style="margin:0 0 4px;color:#64748b;font-size:12px">MCA = purchase of future receivables (not a loan). Bank statements and full stips are ready — reply and we'll send the complete file immediately.</p>` +
    `<p style="margin:8px 0 0">— MFunding Submissions</p></div>`;

  const subject = `New MCA Submission — ${biz} — ${money(deal.amount_requested ?? c.amount_requested)}`;
  return { subject, textBody, htmlBody };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string; lenderIds?: string[]; notes?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  const lenderIds = (payload.lenderIds ?? []).filter(Boolean);
  const notes = payload.notes;
  if (!dealId || lenderIds.length === 0) return json({ error: "dealId and lenderIds are required" }, 400);

  const db = serviceClient();

  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, deal_number, deal_type, amount_requested, use_of_funds, status, customer_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  const { data: customer } = await db.from("customers").select("*").eq("id", deal.customer_id).maybeSingle();
  const c = (customer ?? {}) as Record<string, unknown>;

  const { data: lenders } = await db
    .from("lenders")
    .select("id, name, submission_email, submission_portal_url")
    .in("id", lenderIds);
  const lenderList = (lenders ?? []) as Lender[];

  const { subject, htmlBody, textBody } = buildEmail(deal as Record<string, unknown>, c, notes);

  // GHL is the email transport. Load creds once; if missing, submissions are still
  // recorded and we report it (never break the submit flow).
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }

  const nowIso = new Date().toISOString();
  const results: Array<Record<string, unknown>> = [];

  for (const lender of lenderList) {
    // Record/refresh the submission row first (so it's logged even if email fails).
    const { data: existing } = await db.from("deal_submissions")
      .select("id").eq("deal_id", dealId).eq("lender_id", lender.id).maybeSingle();
    let submissionId = existing?.id as string | undefined;
    if (submissionId) {
      await db.from("deal_submissions").update({ status: "submitted", submitted_at: nowIso, notes: notes ?? null }).eq("id", submissionId);
    } else {
      const { data: ins } = await db.from("deal_submissions")
        .insert({ deal_id: dealId, lender_id: lender.id, status: "submitted", submitted_at: nowIso, notes: notes ?? null })
        .select("id").maybeSingle();
      submissionId = ins?.id as string | undefined;
    }

    let emailSent = false;
    let emailError: string | undefined;
    const to = lender.submission_email ?? "";
    if (!to) {
      emailError = "no submission_email on file for this funder";
    } else if (!cfg) {
      emailError = `GHL not configured: ${ghlError ?? "missing credentials"}`;
    } else {
      // Upsert the funder as a GHL contact (tagged "funder"), then email via GHL.
      const cr = await upsertContact(cfg, {
        email: to, firstName: lender.name ?? "Funder", tags: ["funder"], source: "Funder Submission",
      });
      const funderContactId = cr.data?.contact?.id;
      if (!funderContactId) {
        emailError = `GHL upsert failed: ${cr.error ?? "no contact id"}`;
      } else {
        const sr = await sendEmailToContact(cfg, funderContactId, subject, htmlBody, { text: textBody });
        emailSent = sr.ok;
        if (!sr.ok) emailError = `GHL send failed: ${sr.error}`;
      }
    }

    // Annotate the row + activity log with the email outcome.
    if (submissionId) {
      const stamp = emailSent ? `Emailed ${to} via GHL ${nowIso}` : `Email NOT sent (${emailError})`;
      await db.from("deal_submissions").update({ notes: [notes, stamp].filter(Boolean).join(" | ") }).eq("id", submissionId);
    }
    try {
      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: dealId, interaction_type: "system",
        subject: `submit-to-funder:${lender.name ?? lender.id}`,
        content: JSON.stringify({ lenderId: lender.id, to, emailSent, emailError, via: "ghl", subject }),
      });
    } catch { /* best-effort */ }

    results.push({ lenderId: lender.id, name: lender.name, to, emailSent, emailError, submissionId });
  }

  // NOTE: the deal stage is advanced to "submitted_to_funder" by the caller
  // (dealService.updateDealStatus), which also syncs the GHL opportunity.

  const anySent = results.some((r) => r.emailSent);
  return json({
    ok: true,
    dealId,
    sentCount: results.filter((r) => r.emailSent).length,
    total: results.length,
    via: "ghl",
    warning: ghlError
      ? `GHL credentials unavailable (${ghlError}) — funders were NOT emailed; submissions are recorded.`
      : anySent ? undefined : "No funder emails were sent (check each funder's submission_email).",
    results,
  });
});
