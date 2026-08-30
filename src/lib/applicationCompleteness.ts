// applicationCompleteness — the ONE definition of which merchant-application fields
// are mandatory, and a function that measures how complete a deal's application is.
//
// WHY THIS FILE EXISTS
// The Setter Ops checklist has to show the SAME "N required fields left" that
// MerchantApplicationModal shows on its Send button — if the two ever disagree, a
// setter is told the application is done when the modal still blocks the send (or
// vice-versa). So the required-field SET lives HERE and is imported by the modal
// (see REQUIRED_APPLICATION_FIELDS → the modal's REQUIRED_KEYS): one source of truth,
// no drift.
//
// The modal decides "filled?" off its in-memory form, which it builds two ways:
//   • a SAVED DRAFT exists (mca_applications row) → hydrate the form from that row
//     (nulls → "", with the ask/use-of-funds following the DEAL, not the frozen draft)
//   • NO draft yet → SEED the form from the customer + deal + the lead vendor payload
//     (deals.lead_qual), so a fresh application already reflects what we know.
// This helper reproduces BOTH branches so its % + missing list match the modal for a
// deal that has never been saved AND for one mid-draft. The value-derivation below is
// marked KEEP IN SYNC with MerchantApplicationModal's load effect + prefill.

import type { DealWithCustomer } from "@/types/deals";

export type AppSection = "business" | "owner" | "banking" | "funding";

// Section headings — same wording the modal's tabs use (TAB_LABEL).
export const SECTION_LABEL: Record<AppSection, string> = {
  business: "Business",
  owner: "Owner",
  banking: "Banking",
  funding: "Funding request",
};

export interface RequiredField {
  /** mca_applications column / AppForm key. */
  key: string;
  /** Human label (matches the modal's FIELD_LABEL). */
  label: string;
  section: AppSection;
}

// ── THE REQUIRED SET (single source of truth; imported by MerchantApplicationModal) ──
//
// Mirrors the real "Merchant Funding Application" the merchant e-signs. Everything the
// form marks "if any / if applicable" is OPTIONAL and excluded: business_dba,
// owner_dl_number, owner_dl_state, average_daily_balance, existing_positions,
// existing_balance, notes. owner_ssn is deliberately NOT required (owner's call
// 2026-07-13): a merchant who won't read their SSN on a first call shouldn't block the
// whole application — it still merges when filled, it just doesn't gate the send.
// Order is preserved because the modal jumps to the first tab with a gap
// (missingRequired[0]).
export const REQUIRED_APPLICATION_FIELDS: RequiredField[] = [
  // Business
  { key: "business_legal_name", label: "Business legal name", section: "business" },
  { key: "business_type", label: "Entity type", section: "business" },
  { key: "ein", label: "EIN", section: "business" },
  { key: "business_start_date", label: "Business start date", section: "business" },
  { key: "industry", label: "Industry", section: "business" },
  { key: "business_phone", label: "Business phone", section: "business" },
  { key: "business_email", label: "Business email", section: "business" },
  { key: "business_address", label: "Business street address", section: "business" },
  { key: "business_city", label: "Business city", section: "business" },
  { key: "business_state", label: "Business state", section: "business" },
  { key: "business_zip", label: "Business ZIP", section: "business" },
  // Owner / guarantor
  { key: "owner_first_name", label: "Owner first name", section: "owner" },
  { key: "owner_last_name", label: "Owner last name", section: "owner" },
  { key: "owner_title", label: "Owner title", section: "owner" },
  { key: "owner_ownership_pct", label: "Ownership %", section: "owner" },
  { key: "owner_dob", label: "Owner date of birth", section: "owner" },
  { key: "owner_email", label: "Owner email", section: "owner" },
  { key: "owner_phone", label: "Owner phone", section: "owner" },
  { key: "owner_home_address", label: "Home address", section: "owner" },
  { key: "owner_home_city", label: "Home city", section: "owner" },
  { key: "owner_home_state", label: "Home state", section: "owner" },
  { key: "owner_home_zip", label: "Home ZIP", section: "owner" },
  // Banking
  { key: "bank_name", label: "Bank name", section: "banking" },
  { key: "bank_routing_number", label: "Routing number", section: "banking" },
  { key: "bank_account_number", label: "Account number", section: "banking" },
  // Funding request
  { key: "amount_requested", label: "Amount requested", section: "funding" },
  { key: "use_of_funds", label: "Use of funds", section: "funding" },
  { key: "monthly_revenue", label: "Monthly revenue", section: "funding" },
];

export interface CompletenessResult {
  totalRequired: number;
  filled: number;
  /** 0–100, rounded. */
  pct: number;
  missing: RequiredField[];
  /** Missing counts per section, for a "Business: 4 · Owner: 5 · …" line. */
  missingBySection: Record<AppSection, number>;
}

// ── VALUE DERIVATION (KEEP IN SYNC with MerchantApplicationModal) ──
// Small string helpers ported verbatim from the modal so emptiness is judged the
// same way (a value that the modal treats as blank must be blank here too).

const txt = (v: unknown) => String(v ?? "").trim();

/** "$125,000" → "125000". Anything with no number in it ("N/A") → "". */
function money(v: unknown): string {
  const raw = txt(v);
  if (!raw) return "";
  const n = raw.replace(/[^0-9.]/g, "");
  if (!n || !Number.isFinite(Number(n))) return "";
  return String(Number(n));
}

/** "Carlton Rankin" → { first, last } (split on the LAST space). */
function splitName(v: unknown): { first: string; last: string } {
  const raw = txt(v).replace(/\s+/g, " ");
  if (!raw) return { first: "", last: "" };
  const i = raw.lastIndexOf(" ");
  if (i < 0) return { first: raw, last: "" };
  return { first: raw.slice(0, i), last: raw.slice(i + 1) };
}

/** "7 Years" / "18 Months" → an approximate start date, else "". */
function startDateFromTenure(v: unknown): string {
  const m = txt(v).match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b/i);
  if (!m) return "";
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return "";
  const months = /^(y)/i.test(m[2]) ? Math.round(n * 12) : Math.round(n);
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** First non-empty value wins (mirrors the modal's local `pick`). */
const pick = (...vals: (string | null | undefined)[]) => vals.find((v) => txt(v) !== "") ?? "";

/**
 * Reproduce the modal's SEEDED form (fresh application, no saved draft) for the
 * required keys only. KEEP IN SYNC with the modal's `else` branch (prefill).
 */
function seededValues(deal: DealWithCustomer): Record<string, string> {
  const cust = deal.customer;
  const q = (deal.lead_qual ?? {}) as Record<string, unknown>;
  const name = splitName(q.contact_name);
  return {
    business_legal_name: pick(cust?.business_name, txt(q.company)),
    business_type: "", // not seeded
    ein: "", // not seeded
    business_start_date: startDateFromTenure(q.time_as_owner),
    industry: pick(cust?.industry, txt(q.industry)),
    business_phone: pick(cust?.phone, txt(q.phone)),
    business_email: pick(cust?.email, txt(q.email)),
    business_address: txt(cust?.address_street),
    business_city: txt(cust?.address_city),
    business_state: pick(cust?.address_state, txt(q.state)).toUpperCase().slice(0, 2),
    business_zip: txt(cust?.address_zip),
    owner_first_name: pick(cust?.first_name, name.first),
    owner_last_name: pick(cust?.last_name, name.last),
    owner_title: "Owner", // seeded common case
    owner_ownership_pct: "100", // seeded common case
    owner_dob: "", // not seeded
    owner_email: pick(cust?.email, txt(q.email)),
    owner_phone: pick(cust?.phone, txt(q.phone)),
    owner_home_address: "", // not seeded
    owner_home_city: "", // not seeded
    owner_home_state: "", // not seeded
    owner_home_zip: "", // not seeded
    bank_name: "", // not seeded
    bank_routing_number: "", // not seeded
    bank_account_number: "", // not seeded
    amount_requested: pick(
      deal.amount_requested != null ? String(deal.amount_requested) : "",
      money(q.requested_amount),
    ),
    use_of_funds: pick(deal.use_of_funds, txt(q.use_of_funds)),
    monthly_revenue: pick(
      cust?.monthly_revenue != null ? String(cust.monthly_revenue) : "",
      money(q.monthly_deposits),
    ),
  };
}

/**
 * Reproduce the modal's HYDRATED form (a saved draft exists) for the required keys.
 * KEEP IN SYNC with the modal's load effect: nulls → "", and the ASK / USE-OF-FUNDS
 * follow the DEAL, not the frozen draft (every save writes them back to the deal, so
 * they can only diverge when the deal was edited afterwards).
 */
function hydratedValues(deal: DealWithCustomer, row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of REQUIRED_APPLICATION_FIELDS) {
    const v = row[key];
    out[key] = v === null || v === undefined ? "" : String(v);
  }
  // The ask follows the deal.
  const dealAsk = deal.amount_requested != null ? String(Number(deal.amount_requested)) : "";
  const draftAsk = out.amount_requested === "" ? "" : String(Number(out.amount_requested));
  if (dealAsk !== "" && dealAsk !== draftAsk) out.amount_requested = dealAsk;
  const dealUse = (deal.use_of_funds ?? "").trim();
  if (dealUse !== "" && dealUse !== out.use_of_funds.trim()) out.use_of_funds = dealUse;
  return out;
}

/**
 * Measure how complete a deal's merchant application is, EXACTLY as the modal would
 * judge it: hydrate from the saved draft row when one exists, otherwise seed from the
 * customer + deal + lead payload, then count the required fields that are non-empty.
 *
 * @param deal the loaded deal (carries customer + lead_qual for prefill).
 * @param row  the mca_applications row for this deal, or null if none saved yet.
 */
export function applicationCompleteness(
  deal: DealWithCustomer,
  row: Record<string, unknown> | null,
): CompletenessResult {
  const values = row ? hydratedValues(deal, row) : seededValues(deal);

  const missing: RequiredField[] = [];
  const missingBySection: Record<AppSection, number> = {
    business: 0,
    owner: 0,
    banking: 0,
    funding: 0,
  };
  for (const field of REQUIRED_APPLICATION_FIELDS) {
    if (txt(values[field.key]) === "") {
      missing.push(field);
      missingBySection[field.section] += 1;
    }
  }

  const totalRequired = REQUIRED_APPLICATION_FIELDS.length;
  const filled = totalRequired - missing.length;
  const pct = totalRequired === 0 ? 100 : Math.round((filled / totalRequired) * 100);
  return { totalRequired, filled, pct, missing, missingBySection };
}
