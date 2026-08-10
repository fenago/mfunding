// application-fields — the SINGLE SOURCE OF TRUTH for the MFunding merchant
// funding-application → GHL doc-merge machinery, shared by:
//   · push-application-to-ghl   (values sourced from Supabase: mca_applications / lead_qual / customers)
//   · ghl-send-application       (values sourced from the GHL CONTACT itself — the HotProspector setter's typed values)
//
// Both functions MUST import the field-id map and the doc-verification helpers from
// here so they can NEVER drift. A forked copy of `F` is how a merchant ends up
// signing a contract full of raw {{merge tags}} (see the 2026-07-13 incident writeup
// in push-application-to-ghl/index.ts). Do not re-declare any of this per-function.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. This module only
// transports data into GHL merge fields; it makes no product claims.

import {
  ghlFetch, getContact, listCustomFields, updateContactCustomFields,
  addContactTags, lastEmailFailure, bounceMessage,
} from "./ghl.ts";
import type { GhlConfig, GhlCustomField } from "./ghl.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── GHL workflow ids (MFunding location t7NmVR4WCy927j4Zon4b) ─────────────────
// These are WORKFLOW ids (UUIDs), the enrollment mechanism. NOTE: the 04B DOCUMENT
// TEMPLATE id is a separate 24-hex Mongo id (6a4e84d34bbf13c4cb87ae44) — you enroll
// into the WORKFLOW (afc21762…), which then mints the "04B MCA PREFILL" template.
export const MCA_04_WORKFLOW_ID = "076bee21-5667-4cdf-83ae-caf50bea44e2";  // SELF-FILL (fillable app)
export const MCA_04B_WORKFLOW_ID = "afc21762-6879-4de1-89a2-82cc77479bfa"; // PREFILL (04B MCA PREFILL)
export const MCA_04C_WORKFLOW_ID = "cdc8dbfa-aa89-4cc3-8d8b-7f1968ecf155"; // PARTIAL (04C)
export const PREFILL_TAG = "app-prefilled";
export const PARTIAL_TAG = "app-partial";

// ── Post-send verification (the safety net) ──────────────────────────────────
export const DOC_PREFILL = /04B\s*MCA\s*PREFILL/i;
export const DOC_PARTIAL = /04C\s*MCA\s*PARTIAL/i;
export const DOC_SELF_FILL = /MCA[\s_-]*Merchant[\s_-]*Funding[\s_-]*Application/i;
// Rides along on BOTH paths, so it can never settle WHICH application went out.
export const DOC_COMPANION = /broker\s*compensation\s*disclosure/i;

export type Verification = "confirmed" | "unconfirmed" | "wrong_template";
export type SendMode = "prefill" | "blank" | "partial";
export type GhlDoc = {
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  recipients?: Array<{ id?: string; email?: string }>;
  links?: Array<{ recipientId?: string; referenceId?: string }>;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const EXPECTED_DOC: Record<SendMode, RegExp> = {
  prefill: DOC_PREFILL,
  blank: DOC_SELF_FILL,
  partial: DOC_PARTIAL,
};

// The per-recipient viewer/signing link for THIS contact on a document record.
export function signingUrlFor(doc: GhlDoc, contactId: string): string | null {
  const myLink = (doc.links ?? []).find((l) => l.recipientId === contactId);
  const referenceId = myLink?.referenceId;
  return referenceId ? `https://link.vibereach.io/documents/v1/${referenceId}?locale=en-US` : null;
}

// GHL's API intermittently fails single enrollment calls; retry with backoff.
export async function enrollWithRetry(cfg: GhlConfig, contactId: string, workflowId: string) {
  let wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${workflowId}`, {});
  for (const delay of [1200, 2500]) {
    if (wf.ok) break;
    console.warn(`[app-fields] enrollment failed (${wf.status}) — retrying in ${delay}ms`, wf.error?.slice(0, 300));
    await sleep(delay);
    wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${workflowId}`, {});
  }
  return wf;
}

/**
 * Ask GHL what it ACTUALLY created for this contact, and confirm it is the template
 * asked for. Enrollment is async; poll with backoff. Not-appeared-yet = "unconfirmed"
 * (honest, not alarming). Wrong template = fail loud. `sinceMs` scopes to THIS send.
 */
export async function verifyDocumentSent(
  cfg: GhlConfig,
  contactId: string,
  email: string,
  mode: SendMode,
  sinceMs: number,
): Promise<{ verification: Verification; template: string | null; signingUrl: string | null }> {
  const expected = EXPECTED_DOC[mode];
  const wantEmail = email.trim().toLowerCase();

  const deadline = Date.now() + 15_000;
  let delay = 1_500;

  for (;;) {
    await sleep(delay);

    const res = await ghlFetch<{ documents?: GhlDoc[] }>(
      cfg,
      "GET",
      `/proposals/document?locationId=${cfg.locationId}&limit=20`,
    );

    if (res.ok) {
      const mine = (res.data?.documents ?? []).filter((d) => {
        const ts = Date.parse(d.createdAt ?? d.updatedAt ?? "");
        if (!Number.isFinite(ts) || ts < sinceMs) return false;
        return (d.recipients ?? []).some(
          (r) => r.id === contactId || (r.email ?? "").trim().toLowerCase() === wantEmail,
        );
      });

      const apps = mine.filter((d) => !DOC_COMPANION.test(d.name ?? ""));

      const right = apps.find((d) => expected.test(d.name ?? ""));
      if (right) return { verification: "confirmed", template: right.name ?? null, signingUrl: signingUrlFor(right, contactId) };

      const wrong = apps[0];
      if (wrong) return { verification: "wrong_template", template: wrong.name ?? null, signingUrl: null };
    }

    if (Date.now() >= deadline) return { verification: "unconfirmed", template: null, signingUrl: null };
    delay = Math.min(Math.round(delay * 1.6), 4_000);
  }
}

// The fields the 04B PREFILL template merges that ONLY a filled-in application can
// supply. GHL renders an EMPTY custom field as its literal "{{tag}}", so any one of
// these left blank prints as raw garbage on a document a merchant signs. Mirrors
// REQUIRED_KEYS in MerchantApplicationModal.
export const REQUIRED_FOR_PREFILL: Array<[string, string]> = [
  ["business_legal_name", "Business legal name"], ["business_type", "Entity type"],
  ["ein", "EIN"], ["business_start_date", "Business start date"], ["industry", "Industry"],
  ["business_phone", "Business phone"], ["business_email", "Business email"],
  ["business_address", "Business street address"], ["business_city", "Business city"],
  ["business_state", "Business state"], ["business_zip", "Business ZIP"],
  ["owner_first_name", "Owner first name"], ["owner_last_name", "Owner last name"],
  ["owner_title", "Owner title"], ["owner_ownership_pct", "Ownership %"],
  ["owner_dob", "Owner date of birth"],
  ["owner_email", "Owner email"],
  ["owner_phone", "Owner cell phone"], ["owner_home_address", "Owner home address"],
  ["owner_home_city", "Owner home city"], ["owner_home_state", "Owner home state"],
  ["owner_home_zip", "Owner home ZIP"],
  ["bank_name", "Bank name"], ["bank_routing_number", "Bank routing number"],
  ["bank_account_number", "Bank account number"],
  ["amount_requested", "Amount requested"], ["use_of_funds", "Use of funds"],
  ["monthly_revenue", "Average monthly revenue"],
];

// ── Field-ID map (MFunding location t7NmVR4WCy927j4Zon4b) ─────────────────────
// The document merges from these contact custom fields. Where a field has a "(Doc)"
// TEXT variant, THAT is the document's merge source — so we populate the (Doc)
// variant AND the plain typed field (numeric/monetary) when both exist.
export const F = {
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

  business_website: "OBGCHWdcOdl2mSNlDJqb",       // Business Website (TEXT)
  owner_home_phone: "GjrEktqueuhPjQvatDjm",       // Owner Home Phone (TEXT)
  bank_account_type: "gxdgf6Dcs4aoeZGIvdfW",      // Bank Account Type (SINGLE_OPTIONS: Checking | Savings)
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

  annual_gross_revenue_doc: "q7bLalmdbBVkpFWf97Ik", // Annual Gross Revenue (Doc) (TEXT)
  annual_gross_revenue_num: "E4q0GUonhOKtzyNBIhy6", // Annual Gross Revenue (MONETORY)
  avg_monthly_deposits_doc: "rn1Is6Bg5yn4cM3QKi9Z", // Avg Monthly Deposits (Doc) (TEXT)
  avg_monthly_deposits_num: "41DkL0Wz3kvuxXuJts7B", // Average Monthly Deposits (MONETORY)
  number_of_employees_doc: "Elu4SI1XCNuqFupQhYJA", // Number of Employees (Doc) (TEXT)
  number_of_employees_num: "hR4DxjGNp2uSRpw8LH30", // Number of Employees (NUMERICAL)
  bankruptcy_history_radio: "m0szKaJ6b238TmB5sxS6", // Bankruptcy History (RADIO)
  bankruptcy_details: "IxvevRxrPbgboHA5AMJo",       // Bankruptcy Details (TEXT)
  tax_liens_radio: "BZATgeXZTImXxCm2yPyb",          // Tax Liens or Judgments (RADIO: No | Yes)
  tax_lien_details: "aGs110pozxr3o8ICU2In",         // Tax Lien Details (TEXT)
} as const;

// ── Shared value helpers ──────────────────────────────────────────────────────
export const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
export const joinCsz = (city: unknown, state: unknown, zip: unknown) =>
  [s(city), [s(state), s(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");

// No dollar sign: the doc templates print their own literal "$" next to the tag, so
// pushing "$42,000" rendered "$$42,000". The template owns the currency symbol; we
// own the number. Commas kept for readability. Blank/zero → "".
export const money = (v: unknown): string => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("en-US") : "";
};

// A GHL DATE custom field comes back as an ISO string or epoch ms. Render it US-style
// for a merchant-facing document; fall back to the raw string if unparseable.
export const usDate = (v: unknown): string => {
  const raw = s(v);
  if (!raw) return "";
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return raw;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

// ── Reading values off a GHL contact ──────────────────────────────────────────

/** A GHL contact's customFields entry. `value` may be a string, number, array
 * (MULTIPLE_OPTIONS) or object (FILE_UPLOAD — irrelevant here). */
export interface GhlContactCustomField { id: string; value?: unknown }

/** Coerce a contact custom-field value into a trimmed string (joins option arrays). */
export function cfString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => s(v)).filter(Boolean).join(", ");
  if (typeof value === "object") return ""; // file-upload / structured — not a merge scalar
  return s(value);
}

/** id → string value map built from a GHL contact's customFields array. */
export function contactFieldMap(customFields: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of (Array.isArray(customFields) ? customFields : []) as GhlContactCustomField[]) {
    if (f && typeof f.id === "string") out.set(f.id, cfString(f.value));
  }
  return out;
}

/** Standard (non-custom) contact fields we fall back to for combined values. */
export interface ContactStd {
  firstName?: unknown;
  lastName?: unknown;
  companyName?: unknown;
  email?: unknown;
  phone?: unknown;
  address1?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
}

// REQUIRED 04B doc-merge fields, by the F-map key that carries them, with a label.
// A blank here would print a raw {{tag}} on a signed contract, so the caller blocks
// the send and reports these as missing_fields. Mirrors REQUIRED_FOR_PREFILL /
// MerchantApplicationModal REQUIRED_KEYS, expressed as the doc fields 04B merges.
export const REQUIRED_04B_DOC: Array<[keyof typeof F, string]> = [
  ["business_name", "Business name"],
  ["business_entity", "Entity type"],
  ["ein", "EIN"],
  ["date_established_text", "Business established date"],
  ["industry_doc", "Industry"],
  ["business_phone", "Business phone"],
  ["business_email", "Business email"],
  ["business_address", "Business street address"],
  ["business_city_state_zip", "Business city / state / ZIP"],
  ["owner_full_name", "Owner full name"],
  ["owner_title", "Owner title"],
  ["ownership_pct_doc", "Ownership %"],
  ["owner_dob", "Owner date of birth"],
  ["owner_email", "Owner email"],
  ["owner_cell_phone", "Owner cell phone"],
  ["owner_home_address", "Owner home address"],
  ["owner_city_state_zip", "Owner city / state / ZIP"],
  ["bank_name", "Bank name"],
  ["bank_routing", "Bank routing number"],
  ["bank_account", "Bank account number"],
  ["amount_requested_doc", "Amount requested"],
  ["use_of_funds_doc", "Use of funds"],
  ["avg_monthly_revenue_doc", "Average monthly revenue"],
];

export interface ContactBuildResult {
  /** [{id,value}] to PUT onto the contact (both twins populated + optionals orNA'd). */
  fields: Array<{ id: string; value: string | number }>;
  /** REQUIRED 04B doc fields still blank after normalization (raw-tag hazards). */
  missing: string[];
}

/**
 * Build the 04B merge-field array from a GHL CONTACT (the HotProspector setter's
 * freshly-typed values), NOT from Supabase. This is the whole reason ghl-send-
 * application exists: a fresh HP lead may have no mca_applications row.
 *
 * `cf` is the id→value map from the contact's customFields; `std` are its standard
 * fields (for combined/fallback values); `industryOptId`/`useOfFundsOptId` are the
 * runtime-resolved ids of the SINGLE/MULTIPLE_OPTIONS "Industry" / "Use of Funds"
 * fields the setter picks from (these two source ids are NOT in the F map — only
 * their "(Doc)" TEXT twins are — so the caller resolves them by name and passes them
 * in; if unresolved, we still accept a value the setter typed straight into the Doc
 * twin).
 *
 * Every doc field 04B merges is either given a real value or, for OPTIONAL fields,
 * orNA-proofed so nothing ever prints as a raw {{tag}}. REQUIRED fields left blank
 * are NOT defaulted — they are returned in `missing` so the caller can refuse to send.
 */
export function buildFieldsFromContact(
  cf: Map<string, string>,
  std: ContactStd,
  opts?: { industryOptId?: string | null; useOfFundsOptId?: string | null },
): ContactBuildResult {
  const out: Array<{ id: string; value: string | number }> = [];
  const push = (id: string, value: string | number | "") => {
    if (value === "" || value === null || value === undefined) return;
    if (out.some((f) => f.id === id)) return; // first write wins
    out.push({ id, value });
  };
  const get = (id: string) => cf.get(id) ?? "";

  const ownerFull = get(F.owner_full_name) || [s(std.firstName), s(std.lastName)].filter(Boolean).join(" ");

  // Business
  push(F.business_name, get(F.business_name) || s(std.companyName));
  push(F.business_website, get(F.business_website));
  push(F.dba, get(F.dba));
  push(F.business_entity, get(F.business_entity)); // setter picks from the GHL options → already valid
  push(F.ein, get(F.ein));
  // Date twin: nice DATE (business_established_date) → doc TEXT (date_established_text).
  push(F.date_established_text, get(F.date_established_text) || usDate(get(F.business_established_date)));
  push(F.business_phone, get(F.business_phone) || s(std.phone));
  push(F.business_email, get(F.business_email) || s(std.email));
  push(F.business_address, get(F.business_address) || s(std.address1));
  push(F.business_city_state_zip, get(F.business_city_state_zip) || joinCsz(std.city, std.state, std.postalCode));
  // Industry twin: options field (id not in F — resolved by name) → doc TEXT.
  const industry = get(F.industry_doc) || (opts?.industryOptId ? get(opts.industryOptId) : "");
  push(F.industry_doc, industry);

  // Owner / guarantor
  push(F.owner_full_name, ownerFull);
  push(F.owner_title, get(F.owner_title) || "Owner");
  // Ownership twin: NUMERICAL (ownership_pct_num) → doc TEXT (ownership_pct_doc). No
  // "%" appended — matches buildFields (04B template owns the symbol/line).
  push(F.ownership_pct_doc, get(F.ownership_pct_doc) || get(F.ownership_pct_num));
  push(F.ssn, get(F.ssn));
  push(F.owner_dob, get(F.owner_dob));
  push(F.dl_number, get(F.dl_number));
  push(F.owner_email, get(F.owner_email) || s(std.email));
  const ownerCell = get(F.owner_cell_phone) || s(std.phone);
  push(F.owner_cell_phone, ownerCell);
  // HOME PHONE = CELL PHONE always (owner's call — mirrors buildFields).
  push(F.owner_home_phone, get(F.owner_home_phone) || ownerCell);
  push(F.owner_home_address, get(F.owner_home_address));
  push(F.owner_city_state_zip, get(F.owner_city_state_zip));

  // Banking (account holder defaults to the owner's name)
  push(F.bank_name, get(F.bank_name));
  const acct = get(F.bank_account_type);
  if (acct === "Checking" || acct === "Savings") push(F.bank_account_type, acct);
  push(F.bank_routing, get(F.bank_routing));
  push(F.bank_account, get(F.bank_account));
  push(F.bank_holder, get(F.bank_holder) || ownerFull);

  // Funding request. Money twins: MONETORY nice → doc TEXT (bare number, no $).
  push(F.amount_requested_doc, get(F.amount_requested_doc) || money(get(F.funding_amount_requested)));
  const uof = get(F.use_of_funds_doc) || (opts?.useOfFundsOptId ? get(opts.useOfFundsOptId) : "");
  push(F.use_of_funds_doc, uof);
  push(F.avg_monthly_revenue_doc, get(F.avg_monthly_revenue_doc) || money(get(F.avg_monthly_revenue_num)));

  // Business financials
  push(F.annual_gross_revenue_doc, get(F.annual_gross_revenue_doc) || money(get(F.annual_gross_revenue_num)));
  push(F.avg_monthly_deposits_doc, get(F.avg_monthly_deposits_doc) || money(get(F.avg_monthly_deposits_num)));
  const emp = get(F.number_of_employees_doc) || (() => {
    const n = Number(get(F.number_of_employees_num).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
  })();
  push(F.number_of_employees_doc, emp);

  // Derogatory disclosures — RADIOs only with exact valid option values.
  const taxLiens = get(F.tax_liens_radio);
  if (taxLiens === "Yes" || taxLiens === "No") push(F.tax_liens_radio, taxLiens);
  push(F.tax_lien_details, get(F.tax_lien_details));
  const bk = get(F.bankruptcy_history_radio);
  if (bk === "No" || bk === "Yes - discharged" || bk === "Yes - active") push(F.bankruptcy_history_radio, bk);
  push(F.bankruptcy_details, get(F.bankruptcy_details));

  // ── Compute REQUIRED-field gaps BEFORE orNA-proofing (which only fills optionals). ──
  const has = (id: string) => out.some((f) => f.id === id && s(f.value) !== "");
  const missing = REQUIRED_04B_DOC.filter(([key]) => !has(F[key])).map(([, label]) => label);

  // ── RAW-TAG PROOFING for the OPTIONAL doc fields (never a raw {{tag}}). ──
  const orNA = (id: string, value: string | number = "N/A") => {
    if (!out.some((f) => f.id === id)) out.push({ id, value });
  };
  orNA(F.dba);
  orNA(F.business_website);
  orNA(F.ssn);
  orNA(F.dl_number);
  orNA(F.annual_gross_revenue_doc);
  orNA(F.avg_monthly_deposits_doc);
  orNA(F.number_of_employees_doc);
  orNA(F.bankruptcy_details, "None");
  orNA(F.tax_lien_details, "None");
  orNA(F.active_mca_positions, 0);          // NUMERICAL — number, not "N/A"
  orNA(F.total_outstanding_mca_balance, 0); // MONETORY — same

  return { fields: out, missing };
}

// ── SEND ORCHESTRATION (single source of truth) ───────────────────────────────
// The ENTIRE 04B-PREFILL send flow — fetch contact, twin-map, orNA, require an
// email + all required fields, deliverability guard, enroll into 04B, verify what
// GHL actually minted — lives HERE so both callers share ONE implementation and can
// never drift:
//   · ghl-send-application  (GHL workflow webhook — x-webhook-secret vs GHL_SEND_APP_SECRET)
//   · send-app-link         (setter's one-press link — ?k= vs SEND_APP_LINK_TOKEN)
// A forked copy of this flow is how a merchant ends up signing a contract full of
// raw {{merge tags}}. Do not re-implement it per-function.

export const EXPECTED_04B_TEMPLATE = "04B MCA PREFILL";

export const isEmail = (e: unknown): e is string =>
  typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Resolve a SINGLE/MULTIPLE_OPTIONS field id by name, excluding the "(Doc)" TEXT
 * twin. Industry / Use-of-Funds picks land on these fields, whose ids are NOT in the
 * F map (only their doc twins are), so they are looked up at runtime. */
export function findOptionFieldId(fields: GhlCustomField[], label: string): string | null {
  const want = label.toLowerCase();
  const f = fields.find((cf) => {
    const n = (cf.name ?? "").toLowerCase();
    if (n.includes("doc")) return false; // skip the "(Doc)" TEXT twin
    return n === want || n.startsWith(want + " ") || n.startsWith(want);
  });
  return f?.id ?? null;
}

/** Best-guess merchant display name off a contact (for a confirmation UI). */
export function contactBusinessName(cf: Map<string, string>, std: ContactStd): string {
  return (
    cf.get(F.business_name) ||
    s(std.companyName) ||
    [s(std.firstName), s(std.lastName)].filter(Boolean).join(" ") ||
    "this merchant"
  );
}

/** Peek a contact's display name WITHOUT sending anything — for the confirm page. */
export async function peekContact(
  cfg: GhlConfig,
  contactId: string,
): Promise<{ ok: boolean; business: string | null; email: string | null; error?: string }> {
  const got = await getContact(cfg, contactId);
  if (!got.ok || !got.data?.contact) {
    return { ok: false, business: null, email: null, error: got.error ?? String(got.status) };
  }
  const contact = got.data.contact as Record<string, unknown>;
  const cf = contactFieldMap(contact.customFields);
  const std: ContactStd = {
    firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName, email: contact.email,
  };
  return { ok: true, business: contactBusinessName(cf, std), email: (contact.email as string) ?? null };
}

export interface SendPrefillResult {
  ok: boolean;
  /** HTTP status a caller should surface. */
  status: number;
  verification: Verification | null;
  template: string | null;
  expected_template: string;
  sent_to: string | null;
  fields_pushed: number;
  missing_fields: string[];
  contactId: string;
  signing_url: string | null;
  business: string | null;
  email_undeliverable?: boolean;
  error?: string;
}

/**
 * Send the FULLY PRE-FILLED 04B application to a GHL contact, sourcing every value
 * from the contact itself. Refuses (no GHL write) if there is no usable email or any
 * required field is blank (raw-{{tag}} hazard) or the primary address is known-bounced.
 * On send: pushes both merge twins, gates the fillable app out (PREFILL_TAG), clears
 * crossing/prior enrollments so a repeat click re-fires cleanly, enrolls into 04B,
 * then reads the minted document back to confirm the template. Never throws for an
 * expected failure — returns a SendPrefillResult with the HTTP status to surface.
 */
export async function sendPrefillApplication(
  cfg: GhlConfig,
  db: SupabaseClient,
  contactId: string,
): Promise<SendPrefillResult> {
  const base = {
    expected_template: EXPECTED_04B_TEMPLATE,
    contactId,
    verification: null as Verification | null,
    template: null as string | null,
    sent_to: null as string | null,
    fields_pushed: 0,
    missing_fields: [] as string[],
    signing_url: null as string | null,
    business: null as string | null,
  };

  // ── Fetch the contact and read its custom-field VALUES (keyed by field id). ──
  const got = await getContact(cfg, contactId);
  if (!got.ok || !got.data?.contact) {
    return { ...base, ok: false, status: 502, error: `Could not fetch GHL contact ${contactId}: ${got.error ?? got.status}` };
  }
  const contact = got.data.contact as Record<string, unknown>;
  const cf = contactFieldMap(contact.customFields);
  const std: ContactStd = {
    firstName: contact.firstName, lastName: contact.lastName,
    companyName: contact.companyName, email: contact.email, phone: contact.phone,
    address1: contact.address1, city: contact.city, state: contact.state, postalCode: contact.postalCode,
  };
  const business = contactBusinessName(cf, std);

  // Resolve the option-field ids (Industry / Use of Funds). Non-fatal.
  const fieldsList = await listCustomFields(cfg);
  const allFields = fieldsList.data?.customFields ?? [];
  const industryOptId = findOptionFieldId(allFields, "Industry");
  const useOfFundsOptId = findOptionFieldId(allFields, "Use of Funds");

  // ── NORMALIZE for 04B: copy nice → doc twin, orNA optionals, collect required gaps. ──
  const { fields, missing } = buildFieldsFromContact(cf, std, { industryOptId, useOfFundsOptId });

  // ── PRIMARY EMAIL (House Rule #2): no usable email → nothing sent. ──
  const bizEmail = cf.get(F.business_email) ?? "";
  const ownerEmail = cf.get(F.owner_email) ?? "";
  const existingEmail = s(std.email);
  const primaryEmail =
    isEmail(bizEmail) ? bizEmail.trim()
    : isEmail(ownerEmail) ? ownerEmail.trim()
    : isEmail(existingEmail) ? existingEmail
    : "";
  if (!primaryEmail) {
    return {
      ...base, business, ok: false, status: 422, verification: "unconfirmed", missing_fields: missing,
      error: "This merchant has no usable email on the GHL contact (business, owner, or primary). " +
        "The 04B application can't be e-mailed for e-signature without one, so nothing was sent. " +
        "Add an email to the contact, then re-fire Send Application.",
    };
  }

  // ── COMPLETENESS GATE: a blank required field prints a raw {{tag}}. Refuse first. ──
  if (missing.length > 0) {
    return {
      ...base, business, ok: false, status: 422, verification: "unconfirmed", sent_to: primaryEmail, missing_fields: missing,
      error: `The 04B prefilled application would print raw merge tags where these are blank, so nothing was sent. ` +
        `Collect them on the contact and re-fire. Missing: ${missing.join(", ")}.`,
    };
  }

  // ── DELIVERABILITY: known bounce → don't mint a doc nobody can receive. ──
  const bounce = await lastEmailFailure(cfg, contactId, primaryEmail);
  if (bounce.bounced) {
    return {
      ...base, business, ok: false, status: 422, verification: "unconfirmed", sent_to: primaryEmail, missing_fields: missing,
      email_undeliverable: true,
      error: `The application was NOT sent. ${bounceMessage(primaryEmail, bounce)}`,
    };
  }

  // ── Ensure the contact's PRIMARY email is the one we'll send to. ──
  if (primaryEmail.toLowerCase() !== existingEmail.toLowerCase()) {
    const setEmail = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, { email: primaryEmail });
    if (!setEmail.ok) {
      if (isEmail(existingEmail)) {
        console.warn(`[app-fields] could not set primary email to ${primaryEmail} (${setEmail.status}); using existing primary`);
      } else {
        return {
          ...base, business, ok: false, status: 502, verification: "unconfirmed", sent_to: primaryEmail, missing_fields: missing,
          error: `Could not set the contact's primary email (${setEmail.error ?? setEmail.status}); nothing was sent.`,
        };
      }
    }
  }
  const sentTo = primaryEmail.toLowerCase() !== existingEmail.toLowerCase()
    ? primaryEmail
    : (isEmail(existingEmail) ? existingEmail : primaryEmail);

  // ── Push the normalized merge fields onto the contact (both twins populated). ──
  const upd = await updateContactCustomFields(cfg, contactId, fields);
  if (!upd.ok) {
    return { ...base, business, ok: false, status: 502, verification: "unconfirmed", sent_to: sentTo, missing_fields: missing, error: `GHL custom-field update failed: ${upd.error}` };
  }

  // ── ENROLL into 04B PREFILL. Clear crossing paths + re-clear 04B so a repeat
  // click re-fires cleanly instead of no-op'ing (the resend/re-enroll pattern). ──
  const sendStartedMs = Date.now() - 5_000;
  await addContactTags(cfg, contactId, [PREFILL_TAG]);
  await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [PARTIAL_TAG] });
  await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04C_WORKFLOW_ID}`, {});
  await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04_WORKFLOW_ID}`, {});
  await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${MCA_04B_WORKFLOW_ID}`, {});
  const wf = await enrollWithRetry(cfg, contactId, MCA_04B_WORKFLOW_ID);
  if (!wf.ok) {
    return {
      ...base, business, ok: false, status: 502, verification: "unconfirmed", sent_to: sentTo, fields_pushed: fields.length, missing_fields: missing,
      error: `Could not enroll the merchant into the 04B prefill workflow: ${wf.error ?? "enrollment failed"} — the document was NOT sent.`,
    };
  }

  // ── VERIFY WHAT GHL ACTUALLY SENT (read the document back). ──
  const { verification, template, signingUrl } = await verifyDocumentSent(cfg, contactId, sentTo, "prefill", sendStartedMs);
  if (verification === "wrong_template") {
    return {
      ...base, business, ok: false, status: 502, verification, template, sent_to: sentTo, fields_pushed: fields.length, missing_fields: missing,
      error: `WRONG DOCUMENT SENT — do NOT re-fire. GHL was asked to send "${EXPECTED_04B_TEMPLATE}" to ${sentTo}, ` +
        `but the document it created is "${template ?? "an unrecognized document"}". ` +
        `A GHL workflow is minting the wrong template; it must be repaired before any further application is sent.`,
    };
  }

  // Best-effort audit note against a matching customer row.
  try {
    const { data: cust } = await db.from("customers").select("id").eq("ghl_contact_id", contactId).maybeSingle();
    if (cust?.id) {
      await db.from("activity_log").insert({
        entity_type: "customer",
        entity_id: cust.id,
        interaction_type: "note",
        subject: "application:pushed-to-ghl",
        content: `Setter sent the 04B PREFILL application to ${sentTo} (pushed ${fields.length} merge fields). ` +
          (verification === "confirmed"
            ? `VERIFIED: GHL created "${template}".`
            : `NOT YET CONFIRMED within 15s — expected "${EXPECTED_04B_TEMPLATE}". Check GHL → Documents & Contracts.`),
      });
    }
  } catch { /* best-effort */ }

  return {
    ...base, business, ok: true, status: 200, verification, template, sent_to: sentTo,
    fields_pushed: fields.length, missing_fields: missing, signing_url: signingUrl,
  };
}
