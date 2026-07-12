// merchantDocMerge — turn a merchant document TEMPLATE into signable text.
//
// Mirrors closerDocMerge.ts, but for merchant-facing documents. It substitutes
// OUR merge tokens and injects the state compliance disclosure at
// [STATE_DISCLOSURE].
//
// THREE token classes, by whether an unresolved leftover should block the send:
//
//   1. HARD identity tokens ([COMPANY], [BUSINESS NAME], [MERCHANT/BUSINESS NAME],
//      [MERCHANT NAME], [SIGNER NAME], [DATE]). These come from reliable record
//      data. Any that survive the merge are a HARD send blocker — a merchant
//      instrument with an empty company or business name is not sendable.
//
//   2. SOFT field tokens (address, phone, EIN, revenue, amount, …). These mirror
//      the application's per-field data. Each resolves to the record value if we
//      hold it, else to a labeled blank rule (`__________`) the merchant fills on
//      the signed page. They NEVER block the send — a customer legitimately may
//      not have an EIN or address on file yet.
//
//   3. CONSTANT tokens ([PHONE/EMAIL], [Privacy Policy], [Terms]). Company contact
//      + policy links; resolved from input or a sane default. Never block.
//
// Plus [STATE_DISCLOSURE]: the injected disclosure body legitimately carries the
// funder's own per-offer brackets ([APR], [TOTAL_REPAYMENT], …) — those are filled
// by the funder's official per-transaction disclosure at OFFER time, not by us at
// APPLICATION time. So we do NOT default-deny every leftover bracket; only OUR
// unresolved HARD tokens block.
//
// WHAT THIS DOES NOT DO: author, reword, or soften legal language. Every
// substitution swaps a token for a value; the disclosure text is injected
// verbatim from compliance_disclosures.

export interface MerchantMergeInput {
  companyLegalName: string;        // platform_settings.closer_docs.company_legal_name
  businessName?: string | null;    // customers.business_name
  merchantName?: string | null;    // customers.first_name + last_name
  effectiveDate?: string | null;   // ISO date or null → today
  /** Disclosure body to drop into [STATE_DISCLOSURE], already selected by state+product. */
  disclosureBody?: string | null;
  /** Human note when no disclosure applies (state has none / not an enacted state). */
  noDisclosureNote?: string;
  /**
   * Per-field application data, keyed by SOFT token (e.g. "[EIN]"). Missing keys
   * and empty values render as a labeled blank. Never blocks the send.
   */
  fields?: Record<string, string | null | undefined>;
  /** Company opt-out contact (TCPA "[PHONE/EMAIL]"). */
  contactPhoneEmail?: string | null;
  /** Rendered text for the "[Privacy Policy]" / "[Terms]" links. */
  privacyPolicyText?: string | null;
  termsText?: string | null;
}

export interface MerchantMissingField {
  token: string;
  label: string;
}

export interface MerchantMergeResult {
  content: string;
  missing: MerchantMissingField[];
}

/** "2026-07-11" (or nothing) → "July 11, 2026". Local-parsed to avoid TZ slips. */
export function formatDocDate(iso?: string | null): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const sub = (s: string, token: string, value: string | null): string =>
  value === null ? s : s.split(token).join(value);

// The labeled blank a SOFT field renders to when we hold no value for it. Long
// enough to read as a fill-in rule on the signed page.
const BLANK = "__________________";

// HARD tokens: any left after merge is a send blocker.
const HARD_TOKENS: Record<string, string> = {
  "[COMPANY]": "Company legal name (platform settings)",
  "[BUSINESS NAME]": "Merchant business name (customer record)",
  "[MERCHANT/BUSINESS NAME]": "Merchant business name (customer record)",
  "[MERCHANT NAME]": "Authorized signer name (customer record)",
  "[SIGNER NAME]": "Authorized signer name (customer record)",
  "[DATE]": "Effective date",
};

// SOFT field tokens: value-or-blank, never block. The edge function supplies
// values via `fields`; anything absent renders as a labeled blank.
const SOFT_FIELD_TOKENS: string[] = [
  "[BUSINESS ADDRESS]",
  "[BUSINESS CITY STATE ZIP]",
  "[BUSINESS PHONE]",
  "[BUSINESS EMAIL]",
  "[CELL PHONE]",
  "[OWNER EMAIL]",
  "[EIN]",
  "[ENTITY TYPE]",
  "[INDUSTRY]",
  "[MONTHLY REVENUE]",
  "[AMOUNT REQUESTED]",
  "[USE OF FUNDS]",
  "[TIME IN BUSINESS]",
  "[TITLE]",
];

export function mergeMerchantDoc(
  templateBody: string,
  input: MerchantMergeInput,
): MerchantMergeResult {
  let s = templateBody;

  const merchantName = (input.merchantName ?? "").trim() || null;
  const businessName = (input.businessName ?? "").trim() || null;
  const effectiveDate = formatDocDate(input.effectiveDate) || null;

  // --- 1. HARD identity tokens. ---
  s = sub(s, "[COMPANY]", input.companyLegalName?.trim() || null);
  s = sub(s, "[BUSINESS NAME]", businessName);
  s = sub(s, "[MERCHANT/BUSINESS NAME]", businessName);
  s = sub(s, "[MERCHANT NAME]", merchantName);
  s = sub(s, "[SIGNER NAME]", merchantName);
  s = sub(s, "[DATE]", effectiveDate);

  // --- 2. SOFT field tokens: value or a labeled blank. ---
  const fields = input.fields ?? {};
  for (const token of SOFT_FIELD_TOKENS) {
    const raw = fields[token];
    const value = (raw ?? "").toString().trim();
    s = s.split(token).join(value.length ? value : BLANK);
  }

  // --- 3. CONSTANT tokens: company contact + policy links. ---
  s = s.split("[PHONE/EMAIL]").join(
    (input.contactPhoneEmail ?? "").trim() || "sales@send.mfunding.net",
  );
  s = s.split("[Privacy Policy]").join(
    (input.privacyPolicyText ?? "").trim() || "Privacy Policy (https://mfunding.net/privacy)",
  );
  s = s.split("[Terms]").join(
    (input.termsText ?? "").trim() || "Terms (https://mfunding.net/terms)",
  );

  // --- Disclosure injection (4.4). Always resolve [STATE_DISCLOSURE] to SOMETHING
  // so it is never left as a raw token: the matched disclosure body, or a note. ---
  const disclosure = (input.disclosureBody ?? "").trim();
  const note = input.noDisclosureNote ??
    "No additional state-specific commercial financing disclosure applies to your state at application. Any disclosure required with a specific offer will be provided by the funding partner before you sign the funding agreement.";
  s = sub(s, "[STATE_DISCLOSURE]", disclosure.length ? disclosure : note);

  // Only HARD tokens block the send.
  const seen = new Set<string>();
  const missing: MerchantMissingField[] = [];
  for (const token of Object.keys(HARD_TOKENS)) {
    if (s.includes(token) && !seen.has(token)) {
      seen.add(token);
      missing.push({ token, label: HARD_TOKENS[token] });
    }
  }

  return { content: s, missing };
}

/** SHA-256 of the merged content, hex. Same as closerDocMerge.sha256Hex. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
