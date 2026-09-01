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
  lastEmailFailure, bounceMessage, recordEmailOutcome,
} from "../_shared/ghl.ts";
// Field-id map + doc-merge machinery: the SINGLE SOURCE OF TRUTH shared with
// ghl-send-application, so the two functions can never drift (see _shared header).
import {
  F, s, joinCsz, REQUIRED_FOR_PREFILL,
  MCA_04_WORKFLOW_ID, MCA_04B_WORKFLOW_ID, MCA_04C_WORKFLOW_ID, PREFILL_TAG, PARTIAL_TAG,
  DOC_PREFILL, type SendMode, enrollWithRetry, verifyDocumentSent,
} from "../_shared/application-fields.ts";

// TWO PARALLEL DOC PATHS (parallel GHL workflows):
//  · MCA 04  — SELF-FILL: was SUPPOSED to send the original fillable application
//    ("MCA_Merchant_Funding_Application"), which the merchant types themselves.
//    Fires on the Application Sent stage move. Its first step is an If/Else gate:
//    contacts tagged "app-prefilled" EXIT immediately.
//  · MCA 04B — PREFILL: sends "04B MCA PREFILL" (native-text template whose
//    {{contact.*}} merge tags render the values this function pushes) + the
//    disclosure + upload link. Fired by direct enrollment here.
// PATH CROSSING: a merchant being chased down path 1 whom the closer later
// prefill-sends is REMOVED from MCA 04, tagged, and enrolled in 04B (and the
// reverse on a blank send) — exactly one path active at a time.
// PATH 3 — 04C PARTIAL: we prefill the ~14 fields the LEAD already gave us (merge
// tags), and the merchant completes the rest as fillable fields on the document
// itself (EIN, SSN, addresses, banking). Enrollment-only, like 04B — NO stage
// trigger, ever. Workflow ids (MCA_04*_WORKFLOW_ID), tags (PREFILL_TAG/PARTIAL_TAG)
// and the doc-verification helpers all live in ../_shared/application-fields.ts now.

// ─────────────────────────────────────────────────────────────────────────────
// POST-SEND VERIFICATION — the safety net this system never had.
//
// Until now, NOTHING ever checked what GHL actually sent. We enrolled the contact,
// GHL answered 200, and we told the closer "sent ✅". A 200 on an enrollment means
// only that GHL ACCEPTED THE ENROLLMENT — it says nothing about which document the
// workflow then chose to mint. On 2026-07-13 that gap put a contract made of raw
// {{merge tags}} in front of five real merchants, and one of them SIGNED it. It went
// unnoticed for hours because every screen in this app said the send had succeeded.
//
// So we now read the documents BACK from GHL and confirm the template by name (see
// verifyDocumentSent in ../_shared/application-fields.ts). Verification is evidence,
// not optimism: we only report "confirmed" for a document we actually saw. Anything
// else is reported honestly as unconfirmed, and a document that is the WRONG template
// for the path the closer chose fails the whole call. DOC_PREFILL, SendMode,
// enrollWithRetry and verifyDocumentSent are imported from the shared module.

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ INCIDENT 2026-07-13 — historical record. READ BEFORE TOUCHING THE DOC PATHS.
//
// STATUS UPDATE (2026-07-13, verified live against t7NmVR4WCy927j4Zon4b):
// The self-fill path is NOT disabled — the header below is the original writeup and
// its final claim ("the fillable application has never once gone out") is no longer
// true. Once enrollment-only delivery was restored, self-fill began minting the
// correct template: "MCA_Merchant_Funding_Application" documents now exist in the
// location (2026-07-13T20:36:06Z and 2026-07-14T00:14:14Z, both to the test contact).
// Delivery is this function's job, via direct enrollment — never a pipeline-stage
// trigger. That is the whole lesson of the incident, and it is what the code does.
//
// What was missing even after the fix: nobody ever checked WHAT GHL ACTUALLY SENT.
// That is now done — see verifyDocumentSent() below, which reads the document back
// and refuses to report success for a template it did not see.
//
// The comment above describes what the GHL workflows are SUPPOSED to do. It is
// not what they actually do, and a real merchant paid for the difference.
//
// MF-2026-0028 (Braun Blaising and Wynne P.C.) e-signed a funding application
// consisting almost entirely of raw "{{contact.federal_tax_id_ein}}"-style merge
// tags. The closer had chosen the SELF-FILL path (blank:true). This function did
// exactly what it says it does: it pushed NO fields, stripped the prefill routing,
// enrolled the contact in NOTHING, and left delivery to the Application Sent stage
// move to fire MCA 04 (the fillable app). GHL sent 04B MCA PREFILL instead — the
// PREFILL template — against a contact with nothing prefilled.
//
// EVIDENCE (all verified against the live location t7NmVR4WCy927j4Zon4b):
//  · The contact's tags at signing time were ["merchant"] — no "app-prefilled".
//    So the tag gate is not the cause, and no 04B enrollment came from us.
//  · Our push ran at 19:25:01; the 04B document was minted at 19:25:04.972Z —
//    AFTER the opportunity moved into Application Sent (19:25:03). The stage
//    move, not this function, created the document.
//  · FIVE consecutive self-fill sends (Papa Diop, Jerry Espinoza, Carlton Rankin,
//    Victor Morran, Victor Nguyan) each produced a "04B MCA PREFILL" document
//    within ~3s of their stage move. Not one of them was enrolled in 04B by us.
//  · Of every document EVER sent from this location, not a single one came from
//    the "MCA_Merchant_Funding_Application" template. The fillable application
//    has never once gone out. MCA 04 does not send it.
//
// CONCLUSION: the workflow that fires on the Application Sent pipeline-stage move
// sends the 04B PREFILL template. Either MCA 04's Send-Document action was
// repointed at 04B, or 04B kept a stage trigger it was supposed to have had
// deleted. Either way, ANY move into Application Sent puts the PREFILL document
// in front of the merchant — so a send with nothing to prefill is a send of a
// document full of raw merge tags.
//
// We cannot fix that from here: we have no authority over GHL automations. What
// we CAN do is refuse to be the thing that pulls the trigger. Until the owner
// repairs the workflow (see the 422 message below), the only safe send is one
// where the contact's merge fields are FULLY populated first — i.e. the prefill
// path. So the self-fill path is closed.
//
// TO RE-ENABLE: fix the GHL workflow first, prove it by moving a TEST deal to
// Application Sent and confirming the document that lands is the fillable
// "MCA_Merchant_Funding_Application" — then flip this to false.

// REQUIRED_FOR_PREFILL (the completeness gate mirroring MerchantApplicationModal's
// REQUIRED_KEYS) is imported from ../_shared/application-fields.ts.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// The field-id map `F` (MFunding location t7NmVR4WCy927j4Zon4b) and the `s` /
// `joinCsz` value helpers are imported from ../_shared/application-fields.ts — the
// single source of truth shared with ghl-send-application. Do not re-declare them.
type App = Record<string, unknown>;

/**
 * The 04C push: the ~14 fields the LEAD already gave us, straight from
 * deals.lead_qual (the vendor's own answers) with customer/deal columns as
 * fallback. No mca_applications row involved — that is the whole point of the
 * partial path: the closer types nothing.
 *
 * Every 04C merge tag MUST have a value behind it or it prints as raw {{tag}}
 * on the signed contract, so this builder is deliberately exhaustive about
 * fallbacks and the caller refuses to send if the essentials are missing.
 */
function buildPartialFields(
  lq: Record<string, unknown>,
  cust: Record<string, unknown>,
  deal: Record<string, unknown>,
): Array<{ id: string; value: string | number }> {
  const out: Array<{ id: string; value: string | number }> = [];
  const push = (id: string, value: string | number | "") => {
    if (value === "" || value === null || value === undefined) return;
    out.push({ id, value });
  };
  // NO dollar sign, deliberately. These doc fields feed templates that print their
  // own literal "$" next to the tag — buildFields (the 04B path) has always pushed
  // bare numbers for exactly this reason, and pushing "$42,000" here rendered
  // "$$42,000" on the document. The template owns the currency symbol; we own the
  // number. Commas kept for readability.
  const money = (v: unknown): string => {
    const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n.toLocaleString("en-US") : "";
  };
  // "No" / "N/A" mean ZERO positions, not a literal string on a contract.
  const count = (v: unknown): number => {
    const t = String(v ?? "").trim();
    if (!t || /^(no|n\/?a|none)$/i.test(t)) return 0;
    const n = Number(t.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const business = s(lq["company"]) || s(cust.business_name);
  const first = s(cust.first_name);
  const last = s(cust.last_name);
  const contactName = s(lq["contact_name"]) || [first, last].filter(Boolean).join(" ");
  const phone = s(lq["phone"]) || s(cust.phone);
  const email = s(lq["email"]) || s(cust.email);

  push(F.business_name, business);
  push(F.industry_doc, s(lq["industry"]) || s(cust.industry));
  push(F.business_phone, phone);
  push(F.business_email, email);
  push(F.owner_full_name, contactName);
  // 100% of leads answer is_owner = Yes; the doc's Title/Ownership lines are merge
  // tags on 04C, so they need explicit values.
  push(F.owner_title, "Owner");
  push(F.ownership_pct_doc, "100%");
  push(F.owner_email, email);
  push(F.owner_cell_phone, phone);
  push(F.owner_home_phone, phone); // home = cell, always (owner's call — see buildFields)
  push(F.amount_requested_doc, money(lq["requested_amount"]) || money(deal.amount_requested));
  // Use of funds is on 100% of measured Synergy leads, so this fallback exists only
  // for hand-made deals with no lead payload. "Working Capital" is the generic MCA
  // purpose — deliberately bland, because a raw {{tag}} on the signed document is the
  // one outcome that is never acceptable.
  push(F.use_of_funds_doc, s(lq["use_of_funds"]) || s(deal.use_of_funds) || "Working Capital");
  push(F.avg_monthly_revenue_doc, money(lq["monthly_deposits"]) || money(cust.monthly_revenue));
  push(F.active_mca_positions, count(lq["open_positions"]));
  push(F.total_outstanding_mca_balance, count(lq["positions_balance"]));
  return out;
}

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
  push(F.business_website, s(app.business_website));
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
  // HOME PHONE = CELL PHONE, always (owner's call). Nobody has a home phone, the 04B
  // template prints the line anyway, and a blank merge tag is a raw {{tag}} on a signed
  // contract. Mirroring the cell keeps the line truthful without another form field.
  push(F.owner_home_phone, s(app.owner_phone));
  push(F.owner_home_address, s(app.owner_home_address));
  push(F.owner_city_state_zip, joinCsz(app.owner_home_city, app.owner_home_state, app.owner_home_zip));

  // Banking (account holder defaults to the owner's name)
  push(F.bank_name, s(app.bank_name));
  const acct = s(app.bank_account_type);
  if (acct === "Checking" || acct === "Savings") push(F.bank_account_type, acct);
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

  // ── RAW-TAG PROOFING for the OPTIONAL fields. ──
  // Every field above is skipped when empty ("a draft doesn't blank GHL fields") — but
  // on the 04B document those fields are MERGE TAGS, and GHL prints an empty custom
  // field as its literal {{tag}} on the signed contract. Required fields are gated
  // before send; the OPTIONAL ones (DBA, SSN, DL#, the financials block) can be
  // legitimately skipped by a closer and used to ship raw template syntax.
  //
  // So: any optional TEXT doc-field still absent here gets an explicit "N/A", and the
  // numeric position fields get 0. "DBA: N/A" on a signed application is a true
  // statement; "DBA: {{contact.dba_doing_business_as}}" is a defect.
  const orNA = (id: string, value: string | number = "N/A") => {
    if (!out.some((f) => f.id === id)) out.push({ id, value });
  };
  orNA(F.dba);
  orNA(F.business_website);
  orNA(F.ssn);                       // optional by the owner's call — warned, never gated
  orNA(F.dl_number);                 // optional — the merchant uploads a photo of it anyway
  orNA(F.annual_gross_revenue_doc);
  orNA(F.avg_monthly_deposits_doc);
  orNA(F.number_of_employees_doc);
  orNA(F.bankruptcy_details, "None");
  orNA(F.tax_lien_details, "None");
  orNA(F.active_mca_positions, 0);          // NUMERICAL — must be a number, not "N/A"
  orNA(F.total_outstanding_mca_balance, 0); // MONETORY — same

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string; blank?: boolean; partial?: boolean; resend?: boolean; mintAnyway?: boolean; fields_only?: boolean; sync_only?: boolean };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  if (!dealId) return json({ error: "dealId is required" }, 400);
  // mintAnyway: override ONLY the email-deliverability guards (dead mailbox) so the
  // application document mints and its per-recipient signing link can be TEXTED. Every
  // other guard — the prefill raw-tag/completeness guards, the no-email guard — stays.
  const mintAnyway = payload.mintAnyway === true;
  // Set when a deliverability guard would have blocked but mintAnyway overrode it —
  // recorded in the audit note so the timeline shows the send went out to a dead email.
  let mintedDespiteBadEmail: string | null = null;
  // blank = "send the original docs, no prefill" (the merchant fills it out).
  // resend = re-fire the send even if the deal is already at Application Sent.
  const blank = payload.blank === true;
  const partial = payload.partial === true;
  if (blank && partial) return json({ error: "Pick one path: blank or partial, not both." }, 400);
  // prefill = closer filled everything; partial = we prefill the lead's 14, merchant
  // completes the rest on the document; blank = merchant fills everything.
  const mode: SendMode = blank ? "blank" : partial ? "partial" : "prefill";
  const resend = payload.resend === true;
  // Sync-on-save: write the app fields to the VibeReach contact WITHOUT sending any
  // document, enrolling, or moving the stage. No email guard (a save must never be
  // blocked). Used by the Fill-the-application modal's Save draft.
  const fieldsOnly = payload.fields_only === true || payload.sync_only === true;

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
    .select("id, customer_id, ghl_contact_id, ghl_opportunity_id, lead_qual, amount_requested, use_of_funds, existing_positions, existing_funders, mca_score")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  if (callerRole === "closer") {
    // A processor works the WHOLE board, so they may fill/send any deal's app.
    const { data: proc } = await db.rpc("is_processor", { uid: caller.id });
    if (!proc) {
      const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
      if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
    }
  }

  // The application the closer just filled.
  const { data: app, error: aErr } = await db
    .from("mca_applications").select("*").eq("deal_id", dealId).maybeSingle();
  if (aErr) return json({ error: `could not load application: ${aErr.message}` }, 500);

  // ── GUARD 1 — NEVER SEND A "PREFILL" DOCUMENT WITH NOTHING TO PREFILL. ──
  // The 04B template is nothing but merge tags. GHL prints an EMPTY custom field as
  // its literal "{{tag}}", so an application that was never filled in (or was only
  // half filled in) doesn't produce a sparse document — it produces a legally
  // worthless one covered in raw template syntax, which the merchant then E-SIGNS.
  // MF-2026-0028 had ZERO rows in mca_applications when its 04B went out.
  // Refuse BEFORE any GHL call: no contact upsert, no tag, no enrollment, nothing.
  // Only the FULL-prefill path needs a completed application: on 04C the unknown
  // fields are FILLABLE on the document (they render as input boxes, not merge
  // tags), so an absent application cannot produce raw template syntax.
  if (mode === "prefill") {
    if (!app) {
      return json({
        error: "The application hasn't been filled in yet, so there is nothing to prefill — nothing was sent. " +
          "Open the application, complete it, and send again.",
        missing_application: true,
      }, 422);
    }
    const missing = REQUIRED_FOR_PREFILL
      .filter(([col]) => s((app as App)[col]) === "")
      .map(([, label]) => label);
    if (missing.length > 0) {
      return json({
        error: `The application is incomplete, so the prefilled document would print raw merge tags where these are blank — nothing was sent. ` +
          `Fill in and send again. Missing: ${missing.join(", ")}.`,
        missing_fields: missing,
      }, 422);
    }
  }

  const { data: customer } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id, industry, monthly_revenue, address_street, address_city, address_state, address_zip")
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

  // ── SYNC-ONLY (Save draft) — mirror the app fields to VibeReach, nothing else. ──
  if (fieldsOnly) {
    let contactId =
      (customer.ghl_contact_id as string | null) ?? (deal.ghl_contact_id as string | null) ?? null;
    // No contact yet? Create one by email if we have it; otherwise skip GHL quietly
    // (the save still succeeds — GHL just catches up once an email exists / on send).
    if (!contactId && merchantEmail) {
      const cr = await upsertContact(cfg, {
        email: merchantEmail,
        firstName: (customer.first_name as string | null) ?? undefined,
        lastName: (customer.last_name as string | null) ?? undefined,
        companyName: (customer.business_name as string | null) ?? undefined,
        phone: (customer.phone as string | null) ?? undefined,
        address1: (customer.address_street as string | null) ?? undefined,
        city: (customer.address_city as string | null) ?? undefined,
        state: (customer.address_state as string | null) ?? undefined,
        postalCode: (customer.address_zip as string | null) ?? undefined,
        source: "MCA Application",
      });
      contactId = cr.data?.contact?.id ?? null;
      if (contactId) {
        await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
        if ((deal.ghl_contact_id ?? null) !== contactId) {
          await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
        }
      }
    }
    if (!contactId) {
      return json({ ok: true, synced: false, reason: "no VibeReach contact yet (an email is needed to create one)" });
    }
    const syncFields = buildFields(appRow);
    if (syncFields.length > 0) {
      const res = await updateContactCustomFields(cfg, contactId, syncFields);
      if (!res.ok) return json({ ok: false, synced: false, error: `VibeReach field sync failed: ${res.error}` }, 502);
    }
    return json({ ok: true, synced: true, fields: syncFields.length });
  }

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
    // Merchant mailing address → standard GHL contact fields (present-only; a null
    // column is omitted so we never blank an address GHL already holds).
    address1: (customer.address_street as string | null) ?? undefined,
    city: (customer.address_city as string | null) ?? undefined,
    state: (customer.address_state as string | null) ?? undefined,
    postalCode: (customer.address_zip as string | null) ?? undefined,
    // NO `tags` HERE — /contacts/upsert REPLACES the whole tag array, so passing
    // ["merchant"] silently WIPED every other tag the contact carried (that is how
    // 31% of Synergy contacts lost their `synergy` / `live-transfer` attribution
    // as they progressed). Tags are added ADDITIVELY below via POST /contacts/{id}/tags.
    source: "MCA Application",
  });
  const contactId = cr.data?.contact?.id ?? null;
  if (!contactId) return json({ error: `GHL upsert failed: ${cr.error ?? "no contact id"}` }, 502);
  // Additive: ADDS `merchant` without touching lead-source/campaign tags.
  await addContactTags(cfg, contactId, ["merchant"]); // best-effort
  if ((customer.ghl_contact_id ?? null) !== contactId) {
    await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
  }
  if ((deal.ghl_contact_id ?? null) !== contactId) {
    await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
  }

  // HARD GUARD #2 — A VALID-LOOKING ADDRESS IS NOT A LIVE ONE.
  // The guard above only proves an email EXISTS. It cannot tell a live mailbox
  // from a dead one, because a dead mailbox is syntactically perfect: every regex
  // passes, GHL accepts the contact, the workflow enrolls, the document records
  // get minted with status "sent" — and the merchant never receives anything.
  // That is exactly how deal MF-2026-0029 ended up with 6 orphan documents against
  // a vendor-supplied address whose FIRST automated email came back
  // "1 Requested mail action aborted, mailbox not found" (a 550 hard bounce).
  // So before we enroll anyone into a doc workflow, ask GHL what happened to the
  // last email it actually tried to send this contact. If it bounced, refuse:
  // minting documents nobody will ever see is worse than not sending, because the
  // app then LOOKS like it delivered. Every retry click would mint another set.
  // (a) The CHEAP check first: a verdict we already hold. Instantly verified this
  //     address at intake (customers_verify_email trigger), and a bounce sweep may have
  //     since PROVEN it dead. Either way we already know — don't pay GHL a round-trip
  //     to re-learn it, and don't mint documents against it.
  const { data: health } = await db
    .from("customers").select("email, email_status, email_bounce_reason").eq("id", customer.id).maybeSingle();
  // THE VERDICT MUST BELONG TO THE ADDRESS WE ARE SENDING TO. email_status is the
  // verdict on customers.email — if the send is going to a DIFFERENT address (e.g.
  // the app's business_email that the setter just captured), a stale verdict on the
  // old address must never veto it. (Hudson Valley MF-2026-0289: the gmail send was
  // blocked three times by the AOL address's verdict.) Path (b) still protects the
  // new address via GHL's actual bounce history.
  const verdictEmail = String(health?.email ?? "").trim().toLowerCase();
  const sendEmail = String(merchantEmail ?? "").trim().toLowerCase();
  const verdictApplies = verdictEmail !== "" && verdictEmail === sendEmail;
  const known = verdictApplies ? ((health?.email_status as string | null) ?? null) : null;
  if (known === "invalid" || known === "bounced") {
    const why = known === "bounced"
      ? `the last email to it bounced (${health?.email_bounce_reason ?? "hard bounce"})`
      : `our email verifier says the mailbox does not exist`;
    if (mintAnyway) {
      // Closer override: mint the document anyway so its signing link can be texted.
      mintedDespiteBadEmail = why;
    } else {
      try {
        await db.from("activity_log").insert({
          entity_type: "deal",
          entity_id: dealId,
          interaction_type: "note",
          subject: "application:pushed-to-ghl",
          content: `BLOCKED the application send: ${merchantEmail} is undeliverable — ${why}. ` +
            `No document was sent and no e-sign record was created. Needs a working email from the merchant.`,
          logged_by: caller.id,
        });
      } catch { /* best-effort */ }
      return json({
        error: `The application was NOT sent. ${merchantEmail} is undeliverable — ${why}. ` +
          `Sending would only create documents the merchant can never receive. ` +
          `Call them, get a working email, put it on the deal (that re-verifies it automatically), then send. ` +
          `Nothing was created in GHL — there is no document waiting for them to sign.`,
        email_bounced: known === "bounced",
        email_invalid: known === "invalid",
        email_undeliverable: true,
        attempted_email: merchantEmail,
        contactId,
      }, 422);
    }
  }

  // (b) The AUTHORITATIVE check: ask GHL what happened to the last email it actually
  //     tried to send this contact. Verification predicts; a bounce PROVES.
  // Only a bounce to the address we are about to USE can block this send. A bounce to
  // an old, since-corrected address must never veto a good one.
  const bounce = await lastEmailFailure(cfg, contactId, merchantEmail);
  if (bounce.bounced && !mintAnyway) {
    await recordEmailOutcome(db, customer.id as string, merchantEmail, bounce);
    try {
      await db.from("activity_log").insert({
        entity_type: "deal",
        entity_id: dealId,
        interaction_type: "note",
        subject: "application:pushed-to-ghl",
        content: `BLOCKED the application send: ${merchantEmail} is undeliverable (GHL: ${bounce.error ?? bounce.status}). ` +
          `No document was sent and no e-sign record was created. Needs a working email from the merchant.`,
        logged_by: caller.id,
      });
    } catch { /* best-effort */ }
    return json({
      error: `The application was NOT sent. ${bounceMessage(merchantEmail, bounce)} ` +
        `Nothing was created in GHL — there is no document waiting for them to sign.`,
      email_bounced: true,
      email_undeliverable: true,
      attempted_email: merchantEmail,
      bounce_reason: bounce.error,
      contactId,
    }, 422);
  }
  // mintAnyway override on a proven bounce: remember it for the audit note; the
  // document still mints below and we return its signing link for texting.
  if (bounce.bounced) mintedDespiteBadEmail = mintedDespiteBadEmail ?? `GHL: ${bounce.error ?? bounce.status}`;
  // Record the outcome either way. A real bounce is stamped (accurate truth); no
  // bounce clears any stale "bounced" flag so a corrected address stops showing red.
  await recordEmailOutcome(db, customer.id as string, merchantEmail, bounce);

  // Push the merge fields. Prefill = the closer's completed application; partial =
  // the 14 values the LEAD already gave us; blank = nothing (the merchant fills
  // the whole document themselves).
  const leadQual = (deal.lead_qual ?? {}) as Record<string, unknown>;
  const fields =
    mode === "prefill" ? buildFields(appRow)
    : mode === "partial" ? buildPartialFields(leadQual, customer as Record<string, unknown>, deal as Record<string, unknown>)
    : [];
  if (mode === "prefill" && fields.length === 0) return json({ error: "Nothing to push — the application is empty." }, 422);
  // The partial doc's merge tags are exactly these values — send with too few and
  // the contract prints raw {{tags}}. Business name, a name, phone and email are
  // the floor; a Synergy lead always clears it, so failing here means the deal has
  // no lead data AND no customer basics, and a human should look at it.
  if (mode === "partial" && fields.length < 6) {
    return json({
      error: "This deal doesn't carry enough lead data to prefill the partial application " +
        `(only ${fields.length} of ~14 fields have values — the merge tags for the rest would print as raw {{tags}} on the signed document). ` +
        "Fill the application and send it prefilled instead, or fix the lead info first.",
      fields_available: fields.length,
    }, 422);
  }
  // ── UCC-sourced structured data → the same three custom fields the UCC push and
  // the playbook use (ids resolved from get_ghl_config, so they never drift). A
  // deal carries existing_positions / existing_funders when it came from a UCC lead.
  // Fill GAPS ONLY — never overwrite a value the application already provided (app
  // wins): buildFields already sets active_mca_positions in prefill/partial, so on
  // those paths the deal value only fills when absent; on a blank send it lands here.
  const hasFieldId = (id: string) => fields.some((f) => f.id === id);
  if (cfg.cfExistingPositions && deal.existing_positions != null && !hasFieldId(cfg.cfExistingPositions)) {
    const n = Number(deal.existing_positions);
    if (Number.isFinite(n)) fields.push({ id: cfg.cfExistingPositions, value: n });
  }
  if (cfg.cfCurrentFunders && !hasFieldId(cfg.cfCurrentFunders)) {
    const funders = Array.isArray(deal.existing_funders)
      ? (deal.existing_funders as unknown[]).map((x) => String(x ?? "").trim()).filter((x) => x && !/agent-filed/i.test(x))
      : [];
    if (funders.length) fields.push({ id: cfg.cfCurrentFunders, value: funders.join(", ") });
  }
  // The UCC MCA quality score → GHL "MCA Score" custom field (present-only; skip null,
  // gap-fill only). deals.mca_score is seeded from ph_ucc_leads by playbook-open-contact.
  if (cfg.cfMcaScore && deal.mca_score != null && !hasFieldId(cfg.cfMcaScore)) {
    const n = Number(deal.mca_score);
    if (Number.isFinite(n)) fields.push({ id: cfg.cfMcaScore, value: n });
  }

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
  // Everything GHL mints from here on belongs to THIS send. The 5s slack absorbs
  // clock skew between us and GHL without reaching back to a previous send's document.
  const sendStartedMs = Date.now() - 5_000;

  let reenrolled: boolean | undefined;
  let enrollDirect = false;
  if (blank) {
    // ── PATH 1 (SELF-FILL): the fillable doc (MCA 04). ──
    // Clear the other paths' routing first (crossing): stop 04B/04C, drop the tags.
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {}); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04C_WORKFLOW_ID}`, {}); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [PREFILL_TAG, PARTIAL_TAG] }); // best-effort

    // ALWAYS ENROLL DIRECTLY. Delivery must never depend on a pipeline-stage trigger.
    //
    // This restores d09eb40 (2026-07-08, "enrollment-only delivery"), which commit
    // 8dd5f00 (2026-07-10, "Fix MCA 04 double-enroll") reverted — and that revert is
    // the whole bug. It made the self-fill path skip the direct enroll and wait for a
    // stage trigger to fire MCA 04. But the MCA 04 stage trigger had already been
    // DELETED, on purpose, precisely because we promised to enroll directly. So
    // self-fill enrolled the merchant in NOTHING, and the only thing that fired was
    // 04B's surviving stage trigger — which sent the PREFILL document to a merchant
    // whose application was, by definition, not filled in. GHL renders an unresolved
    // custom field as its literal {{tag}}, so five merchants received a contract full
    // of {{contact.federal_tax_id_ein}} and one of them SIGNED it (MF-2026-0028).
    //
    // The lesson is the one the July 8 commit already wrote down: a stage trigger
    // cannot tell the two paths apart. It fires on "the deal reached Application
    // Sent", which is true for BOTH a prefilled send and a self-fill send, and it has
    // no idea which document the closer asked for. Only this function knows that. So
    // this function delivers, always, and the stage move stays what it should be — a
    // pipeline update, not a delivery mechanism.
    enrollDirect = true;
    if (resend) await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {}); // allow re-fire
    const wf = await enrollWithRetry(cfg, contactId, MCA_04_WORKFLOW_ID);
    reenrolled = wf.ok;
    if (!wf.ok) {
      return json({
        error: `Could not enroll the merchant into the fillable application workflow (MCA 04): ` +
          `${wf.error ?? "enrollment failed"} — the document was NOT sent.`,
      }, 502);
    }
  } else if (partial) {
    // ── PATH 3 (04C PARTIAL): our 14 lead-derived merge fields + the merchant
    // completes the rest as FILLABLE fields on the document. Enrollment-only, like
    // every doc path: the workflow has NO trigger, so nothing fires unless this
    // function enrolls the contact.
    enrollDirect = true;
    await addContactTags(cfg, contactId, [PARTIAL_TAG]);
    // Crossing from another path mid-flight: stop the other doc workflows + tag.
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {}); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {}); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [PREFILL_TAG] }); // best-effort
    if (resend) await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04C_WORKFLOW_ID}`, {});
    const wf = await enrollWithRetry(cfg, contactId, MCA_04C_WORKFLOW_ID);
    reenrolled = wf.ok;
    if (!wf.ok) {
      return json({
        error: `Could not enroll the merchant into the partial application workflow (MCA 04C): ` +
          `${wf.error ?? "enrollment failed"} — the document was NOT sent.`,
      }, 502);
    }
  } else {
    // ── PATH 2 (PREFILL): the merged doc, sent by MCA 04B. The doc send ALWAYS
    // comes from a direct 04B enrollment (04B has no stage trigger); the caller's
    // stage move only syncs the pipeline, and MCA 04's tag gate exits.
    enrollDirect = true;
    await addContactTags(cfg, contactId, [PREFILL_TAG]); // gate MCA 04 out
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [PARTIAL_TAG] }); // best-effort
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04C_WORKFLOW_ID}`, {}); // best-effort
    // Path 1 → path 2 crossing: stop the fillable-app chase mid-flight.
    await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {}); // best-effort
    // Re-sends must re-fire: remove from 04B first so re-enrollment isn't a no-op.
    if (resend) await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {});
    const wf = await enrollWithRetry(cfg, contactId, MCA_04B_WORKFLOW_ID);
    reenrolled = wf.ok;
    if (!wf.ok) return json({ error: `Could not enroll the merchant into the prefill doc workflow (MCA 04B): ${wf.error ?? "enrollment failed"} — the document was NOT sent.` }, 502);
  }

  // ── VERIFY WHAT GHL ACTUALLY SENT. ──
  // The enrollment above returned ok. That is NOT the same as the right document
  // going out, and the difference is what a real merchant signed on 2026-07-13.
  const expectedName =
    mode === "blank" ? "MCA_Merchant_Funding_Application"
    : mode === "partial" ? "04C MCA PARTIAL"
    : "04B MCA PREFILL";
  const { verification, template, signingUrl } = await verifyDocumentSent(
    cfg, contactId, merchantEmail, mode, sendStartedMs,
  );

  // ── WRONG TEMPLATE → FAIL LOUDLY. ──
  // GHL minted a document for this merchant that is NOT the one the closer asked for.
  // The document is already out — we cannot recall it — but we refuse to report
  // success, we refuse to let the caller stamp the deal as sent, and we say plainly
  // what landed. Retrying would only mint a second wrong document, so we say so.
  if (verification === "wrong_template") {
    const got = template ?? "an unrecognized document";
    // The dangerous direction: the PREFILL template against a contact we deliberately
    // did NOT prefill. Every merge tag renders as literal "{{contact.*}}" text.
    // Raw-tag hazard: the FULL-prefill template landing on a send that did not push
    // the full application (blank pushed nothing; partial pushed only the lead's 14).
    const rawTags = mode !== "prefill" && DOC_PREFILL.test(template ?? "");
    const MODE_LABEL: Record<SendMode, string> = {
      blank: "fillable self-fill application",
      partial: "partial application (lead fields prefilled, merchant completes the rest)",
      prefill: "pre-filled application",
    };
    const detail =
      `GHL was asked to send the ${MODE_LABEL[mode]} ` +
      `("${expectedName}") to ${merchantEmail}, but the document it actually created is "${got}".` +
      (rawTags
        ? ` That is the PREFILL template on a contact with nothing prefilled — the merchant is looking at a ` +
          `contract full of raw {{merge tags}}. This is the 2026-07-13 failure repeating.`
        : ``);

    try {
      await db.from("activity_log").insert({
        entity_type: "deal",
        entity_id: dealId,
        interaction_type: "note",
        subject: "application:wrong-template-sent",
        content: `WRONG DOCUMENT SENT. ${detail} The deal was NOT marked as sent. ` +
          `A GHL workflow is sending a template that does not match the path this code requested — ` +
          `it must be repaired in GHL before any further application is sent.`,
        logged_by: caller.id,
      });
    } catch { /* best-effort */ }

    return json({
      error: `WRONG DOCUMENT SENT — do NOT click send again. ${detail} ` +
        `The deal has NOT been marked as sent. Clicking send again will only put a second wrong document ` +
        `in front of the merchant. Call them and tell them not to sign it, then have the GHL workflow fixed.`,
      verification,
      verified_template: template,
      expected_template: expectedName,
      contactId,
      dealId,
    }, 502);
  }

  // Audit trail (best-effort). Records what we VERIFIED, not what we assumed.
  try {
    await db.from("activity_log").insert({
      entity_type: "deal",
      entity_id: dealId,
      interaction_type: "note",
      subject: "application:pushed-to-ghl",
      content: (mode === "blank"
        ? `Sent the original application docs (no prefill) — merchant fills + e-signs.`
        : mode === "partial"
          ? `Sent the PARTIAL application (04C): pushed ${fields.length} lead-derived fields; the merchant completes the rest on the document.`
          : `Pushed ${fields.length} application fields to the merchant's GHL contact for e-signature.`)
        + (enrollDirect
          ? ` ${resend ? "Re-enrolled" : "Enrolled"} in ${mode === "blank" ? "MCA 04" : mode === "partial" ? "MCA 04C" : "MCA 04B"} directly (${reenrolled ? "ok" : "failed"}).`
          : ` Delivery left to the Application Sent stage trigger to fire MCA 04 (deal already has an opportunity).`)
        + (verification === "confirmed"
          ? ` VERIFIED: GHL created "${template}" for ${merchantEmail}.`
          : ` NOT YET CONFIRMED: no document from GHL within 15s — expected "${expectedName}". Check GHL → Documents & Contracts.`)
        + (mintedDespiteBadEmail
          ? ` NOTE: email known bad (${mintedDespiteBadEmail}) — the document was minted anyway so the closer can TEXT the signing link.`
          : ``),
      logged_by: caller.id,
    });
  } catch { /* best-effort */ }

  // enrolled_via tells the caller how the doc was (or will be) delivered:
  //  · "direct"        — we enrolled the contact into the workflow ourselves
  //  · "stage_trigger" — the caller's move to Application Sent will fire MCA 04
  // verification tells the caller what GHL ACTUALLY DID:
  //  · "confirmed"   — we read the document back and it is the right template
  //  · "unconfirmed" — nothing visible yet; sent, but do not claim it landed
  return json({
    ok: true, dealId, contactId, fieldsPushed: fields.length, blank, mode, reenrolled,
    enrolled_via: enrollDirect ? "direct" : "stage_trigger",
    verification,
    verified_template: template,
    expected_template: expectedName,
    // Per-recipient signing link (null if not extractable within the verify window),
    // so the closer can text it — the free win, and the payoff of mintAnyway.
    signing_url: signingUrl,
    minted_despite_bad_email: !!mintedDespiteBadEmail,
  });
});
