// merchantDocMerge — turn a merchant document TEMPLATE into signable text.
//
// Mirrors closerDocMerge.ts, but for merchant-facing documents. It substitutes
// OUR merge tokens ([COMPANY], [BUSINESS NAME], [MERCHANT NAME], [DATE]) and
// injects the state compliance disclosure at [STATE_DISCLOSURE].
//
// KEY DIFFERENCE from the closer merge's placeholder check: the injected
// disclosure body legitimately carries the funder's own per-offer brackets
// ([APR], [TOTAL_REPAYMENT], [PAYMENT_FREQUENCY], …) — those are filled by the
// funder's official per-transaction disclosure at OFFER time, not by us at
// APPLICATION time. So we do NOT default-deny every leftover bracket. We only
// treat OUR OWN unresolved tokens as a send blocker; the disclosure's brackets
// are expected to survive.
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

// The tokens WE are responsible for resolving. Anything left here after merge is a
// hard send blocker. (The disclosure's own brackets are deliberately not in this set.)
const OUR_TOKENS: Record<string, string> = {
  "[COMPANY]": "Company legal name (platform settings)",
  "[BUSINESS NAME]": "Merchant business name (customer record)",
  "[MERCHANT NAME]": "Authorized signer name (customer record)",
  "[DATE]": "Effective date",
};

export function mergeMerchantDoc(
  templateBody: string,
  input: MerchantMergeInput,
): MerchantMergeResult {
  let s = templateBody;

  const merchantName = (input.merchantName ?? "").trim() || null;
  const businessName = (input.businessName ?? "").trim() || null;
  const effectiveDate = formatDocDate(input.effectiveDate) || null;

  s = sub(s, "[COMPANY]", input.companyLegalName?.trim() || null);
  s = sub(s, "[BUSINESS NAME]", businessName);
  s = sub(s, "[MERCHANT NAME]", merchantName);
  s = sub(s, "[DATE]", effectiveDate);

  // Disclosure injection (4.4). Always resolve [STATE_DISCLOSURE] to SOMETHING so
  // it is never left as a raw token: the matched disclosure body, or a plain note.
  const disclosure = (input.disclosureBody ?? "").trim();
  const note = input.noDisclosureNote ??
    "No additional state-specific commercial financing disclosure applies to your state at application. Any disclosure required with a specific offer will be provided by the funding partner before you sign the funding agreement.";
  s = sub(s, "[STATE_DISCLOSURE]", disclosure.length ? disclosure : note);

  // Only OUR tokens block the send.
  const seen = new Set<string>();
  const missing: MerchantMissingField[] = [];
  for (const token of Object.keys(OUR_TOKENS)) {
    if (s.includes(token) && !seen.has(token)) {
      seen.add(token);
      missing.push({ token, label: OUR_TOKENS[token] });
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
