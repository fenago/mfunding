/**
 * appAutofill — the owner's "get it moving" rules for partial applications,
 * applied wherever an application form is seeded so a processor never retypes
 * what the record already implies. Every rule fills EMPTY fields only — a value
 * a human typed (or a saved draft holds) is never overwritten.
 *
 * The rules (owner-set, 2026-09-04 — "we had some rules around that"):
 *   1. Bank routing # / account # default to "XXXX" — safe placeholders so
 *      completeness clears and the doc can go out; fixed later by the
 *      merchant/processor (same approved design as the Quick App).
 *   2. Owner home address (street/city/state/zip) mirrors the business address.
 *   3. Entity type is inferred from the legal name: "LLC" in the name → LLC,
 *      "Inc"/"Corp" → C-Corp, "LLP" → LLP. Anything else stays unset for a
 *      human to pick.
 *
 * ⚠ KEEP IN LOCKSTEP with supabase/functions/_shared/appAutofill.ts — the same
 * rules run server-side in push-application-to-ghl so applications that nobody
 * re-opens in a modal still get them at sync/doc time.
 */

/** Infer the entity type from a business legal name (or DBA). Empty string when
 *  the name doesn't say. Word-boundary match, punctuation-tolerant ("ACME L.L.C."). */
export function inferEntityType(name: string): "" | "LLC" | "C-Corp" | "LLP" {
  const n = ` ${name.toUpperCase().replace(/[.,]/g, " ")} `;
  if (/\sL\s?L\s?P\s/.test(n)) return "LLP";
  if (/\sL\s?L\s?C\s/.test(n)) return "LLC";
  if (/\s(INC|INCORPORATED|CORP|CORPORATION)\s/.test(n)) return "C-Corp";
  return "";
}

const BANK_PLACEHOLDER = "XXXX";

/** Apply the autofill rules to a string-keyed application form. Returns a new
 *  object; only empty fields change. (The mapped-type constraint accepts plain
 *  interfaces like the full modal's AppForm, which lack an index signature.) */
export function applyAppAutofill<T extends { [K in keyof T]: string }>(form: T): T {
  const next: Record<string, string> = { ...form };
  const empty = (k: string) => (next[k] ?? "").trim() === "";
  const fillIf = (k: string, v: string) => { if (empty(k) && v.trim() !== "") next[k] = v; };

  // 1. Bank placeholders.
  fillIf("bank_routing_number", BANK_PLACEHOLDER);
  fillIf("bank_account_number", BANK_PLACEHOLDER);

  // 2. Home address mirrors business address.
  fillIf("owner_home_address", next.business_address ?? "");
  fillIf("owner_home_city", next.business_city ?? "");
  fillIf("owner_home_state", next.business_state ?? "");
  fillIf("owner_home_zip", next.business_zip ?? "");

  // 3. Entity type from the name.
  fillIf("business_type", inferEntityType(next.business_legal_name || next.business_dba || ""));

  return next as T;
}
