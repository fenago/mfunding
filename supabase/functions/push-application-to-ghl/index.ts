// push-application-to-ghl — push the closer-filled MCA application into the
// merchant's GHL contact custom fields, so the GHL "Merchant Funding Application"
// document (which MERGES from those contact custom fields) goes out PRE-FILLED
// for e-signature.
//
// This is called by MerchantApplicationModal's "Send to merchant to e-sign"
// BEFORE the deal is advanced to Application Sent (which fires the GHL MCA 04
// automation that sends the document). Without this, the e-signed document is
// blank. If this push fails, the caller does NOT advance the stage — no blank
// doc goes out.
//
// POST body: { dealId }  — the application is read server-side from mca_applications.
//
// Auth mirrors send-merchant-email / submit-to-funders: signed-in staff only
// (verify_jwt = true + in-code role check); a closer may only push their OWN deals.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. This function is a
// data transport into GHL; it adds no product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, updateContactCustomFields, ghlFetch, addContactTags,
} from "../_shared/ghl.ts";

// TWO PARALLEL DOC PATHS (parallel GHL workflows):
//  · MCA 04  — SELF-FILL: sends the original fillable application; the merchant
//    types everything themselves. Fires on the Application Sent stage move (and
//    direct enrollment below). Its first step is an If/Else gate: contacts
//    tagged "app-prefilled" EXIT immediately, so a prefilled deal that moves
//    stage never gets the fillable doc on top.
//  · MCA 04B — PREFILL: sends "04B MCA PREFILL" (native-text template whose
//    {{contact.*}} merge tags render the values this function pushes) + the
//    disclosure + upload link. NO stage trigger — fired ONLY by direct
//    enrollment here, so self-fill deals can never receive it.
// PATH CROSSING: a merchant being chased down path 1 whom the closer later
// prefill-sends is REMOVED from MCA 04, tagged, and enrolled in 04B (and the
// reverse on a blank send) — exactly one path active at a time.
const MCA_04_WORKFLOW_ID = "076bee21-5667-4cdf-83ae-caf50bea44e2";
const MCA_04B_WORKFLOW_ID = "afc21762-6879-4de1-89a2-82cc77479bfa";
const PREFILL_TAG = "app-prefilled";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Field-ID map (MFunding location t7NmVR4WCy927j4Zon4b) ─────────────────────
// The document merges from these contact custom fields. Where a field has a
// "(Doc)" TEXT variant, THAT is the document's merge source — so we populate the
// (Doc) variant AND the plain typed field (numeric/monetary) when both exist.
// Only TEXT / NUMERICAL / MONETORY / DATE fields are written — never a
// SINGLE/MULTIPLE_OPTIONS field with free text (a bad option value would reject
// the whole PUT), except Business Entity which the doc needs and whose options
// match the entity types closers type (LLC, Corp, Sole Prop…).
const F = {
  business_name: "uUpbL8PP2iGbGKkof7jX",        // Business Name (TEXT)
  dba: "kXEd1I68aUSpn9hrJBos",                    // DBA (Doing Business As) (TEXT)
  business_entity: "bg2F006hXRWpFBC0UcJQ",        // Business Entity (SINGLE_OPTIONS)
  ein: "xkJOmrJcV70Rb9stoQjL",                    // Federal Tax ID (EIN) (TEXT)
  date_established_text: "in2QGmSAMsUE8vgsdov7",  // Date Business Established (TEXT, doc)
  business_established_date: "yuu47NYYgNcoaVPNSPZf", // Business Established Date (DATE)
  business_phone: "OmXNC2kiyQNS1L2pYVpH",         // Business Phone (TEXT)
  business_email: "snE5zda8bij8nbIQEyv5",         // Business Email (TEXT)
  business_address: "PA7kUj7o5s87dsh4JrVQ",       // Business Address (TEXT)
  business_city_state_zip: "IM1VGEoADF6VvGpe8sH8", // Business City State ZIP (TEXT)
  industry_doc: "8u3WNvasTBqqpZg7v2aq",           // Industry (Doc) (TEXT)

  owner_full_name: "3QhArEyCuFSSfeYNZJ1L",        // Owner Full Name (TEXT)
  owner_title: "H43TGhc3iqkGUduq5oE6",            // Owner Title / Position (TEXT)
  ownership_pct_doc: "IoHyRiDTZuJC5cTwEyYF",      // Ownership Percent (Doc) (TEXT)
  ownership_pct_num: "OuX7uj6pZe8EEtNJj63c",      // Ownership % (NUMERICAL)
  ssn: "MYu4ceeAuebFuhrVLYAj",                    // Social Security Number (TEXT)
  owner_dob: "hKPmMa4rtVYSWRMZlAeb",              // Owner Date of Birth (TEXT)
  dl_number: "nWLHi7I8qQhTujVBjNRO",              // Driver's License Number (TEXT)
  owner_email: "ZZtXaRTB7mK5u8BgqHTC",            // Owner Email (TEXT)
  owner_cell_phone: "E0xwdkSiZyYZxL1rrCH1",       // Owner Cell Phone (TEXT)
  owner_home_address: "I1s7NPQrMKbZjIHDpIZf",     // Owner Home Address (TEXT)
  owner_city_state_zip: "qUlRkDnSWBrCtsEh2CX1",   // Owner City State ZIP (TEXT)

  bank_name: "FvxB7vdMuoaZagKSilez",              // Bank Name (TEXT)
  bank_routing: "8ozLoigFG8RC3Ce50JJL",           // Bank Routing Number (TEXT)
  bank_account: "XSHgbnsVQ9Mfs2V393X8",           // Bank Account Number (TEXT)
  bank_holder: "BCnfWTd40q3lt29d5LYZ",            // Bank Account Holder Name (TEXT)

  amount_requested_doc: "TC3PwzFysAhEnBtYGZa1",   // Amount Requested (Doc) (TEXT)
  funding_amount_requested: "neO6CR6lZOxQ02E37ktx", // Funding Amount Requested (MONETORY)
  use_of_funds_doc: "UYyM3aewFc7CLXdaC5po",       // Use of Funds (Doc) (TEXT)
  avg_monthly_revenue_doc: "KVkNckRzVT1GHtg8zzwc", // Avg Monthly Revenue (Doc) (TEXT)
  avg_monthly_revenue_num: "XM1zs3a1LuiZcv9IEYlb", // Avg Monthly Revenue ($) (MONETORY)
  active_mca_positions: "iqp4xxbM71Qkpn8xTQrK",   // Active MCA Positions (NUMERICAL)
  total_outstanding_mca_balance: "ChoLJU0EuLh22zHkVfO2", // Total Outstanding MCA Balance (MONETORY)

  // Business financials (the PDF's "Business Financial Information" section).
  annual_gross_revenue_doc: "q7bLalmdbBVkpFWf97Ik", // Annual Gross Revenue (Doc) (TEXT)
  annual_gross_revenue_num: "E4q0GUonhOKtzyNBIhy6", // Annual Gross Revenue (MONETORY)
  avg_monthly_deposits_doc: "rn1Is6Bg5yn4cM3QKi9Z", // Avg Monthly Deposits (Doc) (TEXT)
  avg_monthly_deposits_num: "41DkL0Wz3kvuxXuJts7B", // Average Monthly Deposits (MONETORY)
  number_of_employees_doc: "Elu4SI1XCNuqFupQhYJA", // Number of Employees (Doc) (TEXT)
  number_of_employees_num: "hR4DxjGNp2uSRpw8LH30", // Number of Employees (NUMERICAL)
  // Derogatory disclosures. The RADIOs are written ONLY with EXACT option values
  // (a bad option value rejects the whole PUT). Tax liens is a clean Yes/No, so we
  // map the boolean directly. Bankruptcy History's "Yes" options are "Yes -
  // discharged" / "Yes - active" — we can't tell which from a single boolean, so
  // we only write the radio for a definite "No" and otherwise rely on the details
  // TEXT field (which always gets written when there's content).
  bankruptcy_history_radio: "m0szKaJ6b238TmB5sxS6", // Bankruptcy History (RADIO: No | Yes - discharged | Yes - active)
  bankruptcy_details: "IxvevRxrPbgboHA5AMJo",       // Bankruptcy Details (TEXT)
  tax_liens_radio: "BZATgeXZTImXxCm2yPyb",          // Tax Liens or Judgments (RADIO: No | Yes)
  tax_lien_details: "aGs110pozxr3o8ICU2In",         // Tax Lien Details (TEXT)
} as const;

type App = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const joinCsz = (city: unknown, state: unknown, zip: unknown) =>
  [s(city), [s(state), s(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/** Build the [{id, value}] custom-field array from the application row. Only
 * non-empty values are included, so a partial (draft) doesn't blank GHL fields. */
function buildFields(app: App): Array<{ id: string; value: string | number }> {
  const out: Array<{ id: string; value: string | number }> = [];
  const push = (id: string, value: string | number | "") => {
    if (value === "" || value === null || value === undefined) return;
    out.push({ id, value });
  };

  const ownerName = [s(app.owner_first_name), s(app.owner_last_name)].filter(Boolean).join(" ");

  // Business
  push(F.business_name, s(app.business_legal_name));
  push(F.dba, s(app.business_dba));
  push(F.business_entity, s(app.business_type));
  push(F.ein, s(app.ein));
  push(F.date_established_text, s(app.business_start_date));
  push(F.business_established_date, s(app.business_start_date));
  push(F.business_phone, s(app.business_phone));
  push(F.business_email, s(app.business_email));
  push(F.business_address, s(app.business_address));
  push(F.business_city_state_zip, joinCsz(app.business_city, app.business_state, app.business_zip));
  push(F.industry_doc, s(app.industry));

  // Owner / guarantor
  push(F.owner_full_name, ownerName);
  push(F.owner_title, s(app.owner_title));
  push(F.ownership_pct_doc, s(app.owner_ownership_pct));
  if (s(app.owner_ownership_pct)) push(F.ownership_pct_num, Number(app.owner_ownership_pct));
  push(F.ssn, s(app.owner_ssn));
  push(F.owner_dob, s(app.owner_dob));
  push(F.dl_number, s(app.owner_dl_number));
  push(F.owner_email, s(app.owner_email));
  push(F.owner_cell_phone, s(app.owner_phone));
  push(F.owner_home_address, s(app.owner_home_address));
  push(F.owner_city_state_zip, joinCsz(app.owner_home_city, app.owner_home_state, app.owner_home_zip));

  // Banking (account holder defaults to the owner's name)
  push(F.bank_name, s(app.bank_name));
  push(F.bank_routing, s(app.bank_routing_number));
  push(F.bank_account, s(app.bank_account_number));
  push(F.bank_holder, ownerName);

  // Funding request
  push(F.amount_requested_doc, s(app.amount_requested));
  if (s(app.amount_requested)) push(F.funding_amount_requested, Number(app.amount_requested));
  push(F.use_of_funds_doc, s(app.use_of_funds));
  push(F.avg_monthly_revenue_doc, s(app.monthly_revenue));
  if (s(app.monthly_revenue)) push(F.avg_monthly_revenue_num, Number(app.monthly_revenue));
  if (s(app.existing_positions)) push(F.active_mca_positions, Number(app.existing_positions));
  if (s(app.existing_balance)) push(F.total_outstanding_mca_balance, Number(app.existing_balance));

  // Business financials
  push(F.annual_gross_revenue_doc, s(app.annual_gross_revenue));
  if (s(app.annual_gross_revenue)) push(F.annual_gross_revenue_num, Number(app.annual_gross_revenue));
  push(F.avg_monthly_deposits_doc, s(app.average_monthly_deposits));
  if (s(app.average_monthly_deposits)) push(F.avg_monthly_deposits_num, Number(app.average_monthly_deposits));
  push(F.number_of_employees_doc, s(app.number_of_employees));
  if (s(app.number_of_employees)) push(F.number_of_employees_num, Number(app.number_of_employees));

  // Derogatory disclosures. RADIOs get ONLY exact valid option values.
  //  · Tax Liens or Judgments: options are exactly "No" / "Yes" → map the boolean.
  //  · Bankruptcy History: "Yes" is split into "Yes - discharged" / "Yes - active"
  //    (unknown from a single bool), so only a definite false → "No" is safe; a
  //    true is conveyed via the Bankruptcy Details TEXT field instead.
  if (typeof app.has_tax_liens === "boolean") {
    push(F.tax_liens_radio, app.has_tax_liens ? "Yes" : "No");
  }
  push(F.tax_lien_details, s(app.tax_lien_details));
  if (app.has_bankruptcy === false) push(F.bankruptcy_history_radio, "No");
  push(F.bankruptcy_details, s(app.bankruptcy_details));

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string; blank?: boolean; resend?: boolean };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  if (!dealId) return json({ error: "dealId is required" }, 400);
  // blank = "send the original docs, no prefill" (the merchant fills it out).
  // resend = re-fire the send even if the deal is already at Application Sent.
  const blank = payload.blank === true;
  const resend = payload.resend === true;

  const db = serviceClient();

  // --- Authn/Authz: writes real merchant PII into GHL → signed-in staff only,
  // and a closer may only push their OWN deals. ---
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

  // Load the deal + its merchant. ghl_opportunity_id tells us whether the caller's
  // stage move can be trusted to fire MCA 04, or whether we must enroll directly.
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, customer_id, ghl_contact_id, ghl_opportunity_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // The application the closer just filled.
  const { data: app, error: aErr } = await db
    .from("mca_applications").select("*").eq("deal_id", dealId).maybeSingle();
  if (aErr) return json({ error: `could not load application: ${aErr.message}` }, 500);
  // Only the PREFILL path needs a saved application. The blank "send original
  // docs" path has nothing to merge — the merchant fills it in the doc itself.
  if (!app && !blank) return json({ error: "No application on this deal to push." }, 404);

  const { data: customer } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id")
    .eq("id", deal.customer_id).maybeSingle();
  if (!customer) return json({ error: "This deal has no merchant on file." }, 404);

  // GHL config from the vault.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  // Resolve the merchant's GHL contact (create via upsert if missing — same as
  // the submit/email engines). Persist a newly-created id for later comms.
  const appRow = (app ?? {}) as App;
  const merchantEmail = s(appRow.business_email) || s(appRow.owner_email) || s(customer.email);
  // HARD GUARD: the GHL contact MCA 04 fires against MUST carry an email, or the
  // doc-send + email actions silently SKIP and the merchant gets nothing (while
  // the app shows "sent"). So require an email up front — regardless of whether a
  // contact is already linked — and refuse to advance without one.
  if (!merchantEmail) {
    return json({ error: "This merchant has no email on file. MCA 04 can't e-mail the application for e-signature without one, so the send is blocked. Add the merchant's email, then send." }, 422);
  }
  // ALWAYS upsert BY EMAIL (GHL dedupes on it) rather than trusting the stored
  // ghl_contact_id. This: (a) guarantees the resolved contact actually HAS the
  // email; (b) collapses an emailless duplicate/orphan onto the canonical record;
  // (c) self-heals a deal still pointing at a deleted/mismatched contact. We then
  // re-link the deal + customer to whatever contact owns this email.
  const cr = await upsertContact(cfg, {
    email: merchantEmail,
    firstName: (customer.first_name as string | null) ?? undefined,
    lastName: (customer.last_name as string | null) ?? undefined,
    companyName: (customer.business_name as string | null) ?? undefined,
    phone: (customer.phone as string | null) ?? undefined,
    tags: ["merchant"],
    source: "MCA Application",
  });
  const contactId = cr.data?.contact?.id ?? null;
  if (!contactId) return json({ error: `GHL upsert failed: ${cr.error ?? "no contact id"}` }, 502);
  if ((customer.ghl_contact_id ?? null) !== contactId) {
    await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
  }
  if ((deal.ghl_contact_id ?? null) !== contactId) {
    await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
  }

  // Push the merge fields — only for the PREFILL path. The blank "send original
  // docs" path pushes nothing (the merchant fills the doc themselves).
  const fields = blank ? [] : buildFields(appRow);
  if (!blank && fields.length === 0) return json({ error: "Nothing to push — the application is empty." }, 422);
  if (fields.length > 0) {
    const res = await updateContactCustomFields(cfg, contactId, fields);
    if (!res.ok) return json({ error: `GHL custom-field update failed: ${res.error}` }, 502);
  }

  // Enroll the contact into MCA 04 directly (the deterministic doc-send trigger)
  // when EITHER:
  //  · resend — the deal is already at Application Sent, so the caller's stage
  //    move is a no-op and won't re-trigger the workflow; OR
  //  · first send on a deal with NO GHL opportunity yet — e.g. a bulk-imported
  //    web/aged lead (bulk-lead-import creates the deal but never syncs it to
  //    GHL). The caller's stage move will CREATE the opportunity directly AT the
  //    Application Sent stage, and a fresh create-into-stage does not reliably
  //    fire GHL's "stage changed" trigger, so MCA 04 could silently never send.
  //    Enrolling here guarantees it. Deals that already carry an opportunity
  //    (live transfer, website /apply, mca-intake) keep relying on the stage move
  //    exactly as before — no behavior change, no double send. And with GHL
  //    re-enrollment OFF (the same assumption the resend path makes) a direct
  //    enroll dedupes against any stage-move trigger, so the merchant gets one send.
  const noOpportunity = !deal.ghl_opportunity_id;
  let reenrolled: boolean | undefined;
  let enrollDirect = false;
  if (blank) {
    // ── PATH 1 (SELF-FILL): the fillable doc, sent by MCA 04. Clear any prefill
    // routing first (path 2 → path 1 crossing): stop 04B and drop the tag so
    // MCA 04's gate lets them through.
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {}); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [PREFILL_TAG] }); // best-effort
    enrollDirect = resend || noOpportunity;
    if (enrollDirect) {
      const wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {});
      reenrolled = wf.ok;
    }
  } else {
    // ── PATH 2 (PREFILL): the merged doc, sent by MCA 04B. The doc send ALWAYS
    // comes from a direct 04B enrollment (04B has no stage trigger); the caller's
    // stage move only syncs the pipeline, and MCA 04's tag gate exits.
    enrollDirect = true;
    await addContactTags(cfg, contactId, [PREFILL_TAG]); // gate MCA 04 out
    // Path 1 → path 2 crossing: stop the fillable-app chase mid-flight.
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {}); // best-effort
    // Re-sends must re-fire: remove from 04B first so re-enrollment isn't a no-op.
    if (resend) await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {});
    const wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {});
    reenrolled = wf.ok;
    if (!wf.ok) return json({ error: `Could not enroll the merchant into the prefill doc workflow (MCA 04B): ${wf.error ?? "enrollment failed"} — the document was NOT sent.` }, 502);
  }

  // Audit trail (best-effort).
  try {
    await db.from("activity_log").insert({
      entity_type: "deal",
      entity_id: dealId,
      interaction_type: "note",
      subject: "application:pushed-to-ghl",
      content: (blank
        ? `Sent the original application docs (no prefill) — merchant fills + e-signs.`
        : `Pushed ${fields.length} application fields to the merchant's GHL contact for e-signature.`)
        + (enrollDirect
          ? ` ${resend ? "Re-enrolled" : "Enrolled"} in MCA 04 directly (${reenrolled ? "ok" : "failed"}${!resend ? ", no opportunity yet" : ""}).`
          : ""),
      logged_by: caller.id,
    });
  } catch { /* best-effort */ }

  return json({ ok: true, dealId, contactId, fieldsPushed: fields.length, blank, reenrolled });
});
