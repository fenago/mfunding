// Business identity for "one owner, many businesses".
//
// An owner is a person (one phone, one email, one GHL contact). A BUSINESS is a
// `customers` row under that owner, and the only identifier every business
// actually has is its NAME — EIN is missing on ~98% of them, so keying business
// identity on EIN would collapse nearly every owner back to a single business.
//
// This is the browser-side twin of normBusiness() in
// supabase/functions/playbook-open-contact/index.ts. THE TWO MUST AGREE: the UI
// decides "is this a new business?" with this function and the edge function
// dedupes add_business with that one. If you change the rules here, change them
// there too, or the same typed name will create a duplicate on one path and
// resume on the other.

/** Entity suffixes that don't distinguish one business from another — "Acme
 *  Trucking" and "Acme Trucking LLC" are the same merchant to a setter. */
const ENTITY_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "lp", "llp", "pllc", "pc", "dba",
]);

/**
 * Normalized business name: lowercased, punctuation stripped, trailing entity
 * suffixes trimmed. Returns "" when there is no usable name — and "" must NEVER
 * be treated as matching another business.
 */
export function normBusinessName(v: unknown): string {
  const s = String(v ?? "")
    .toLowerCase()
    .replace(/\bl\.?\s*l\.?\s*c\b/g, "llc") // L.L.C. / L L C -> llc
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const parts = s.split(" ");
  while (parts.length > 1 && ENTITY_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}
