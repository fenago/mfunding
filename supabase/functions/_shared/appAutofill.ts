// appAutofill (server copy) — the owner's autofill rules for partial
// applications, applied in push-application-to-ghl at sync/doc time so an
// application row nobody re-opens in a modal still gets them.
//
// ⚠ KEEP IN LOCKSTEP with src/lib/appAutofill.ts (the client copy applied at
// form-seed time in QuickAppModal and MerchantApplicationModal). The rules:
//   1. bank_routing_number / bank_account_number → "XXXX" placeholder when empty
//   2. owner home address (street/city/state/zip) ← business address when empty
//   3. business_type inferred from the legal name (LLC → LLC, Inc/Corp → C-Corp,
//      LLP → LLP) when empty
// Fill-empties only — a value a human entered is never overwritten.

export function inferEntityType(name: string): "" | "LLC" | "C-Corp" | "LLP" {
  const n = ` ${name.toUpperCase().replace(/[.,]/g, " ")} `;
  if (/\sL\s?L\s?P\s/.test(n)) return "LLP";
  if (/\sL\s?L\s?C\s/.test(n)) return "LLC";
  if (/\s(INC|INCORPORATED|CORP|CORPORATION)\s/.test(n)) return "C-Corp";
  return "";
}

const BANK_PLACEHOLDER = "XXXX";

/** Mutates `app` in place (fill-empties only) and returns the columns that were
 *  filled, so the caller can persist exactly those back to mca_applications. */
export function applyAppAutofillRow(app: Record<string, unknown>): Record<string, string> {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
  const filled: Record<string, string> = {};
  const fillIf = (col: string, v: string) => {
    if (s(app[col]) === "" && v.trim() !== "") { app[col] = v; filled[col] = v; }
  };

  fillIf("bank_routing_number", BANK_PLACEHOLDER);
  fillIf("bank_account_number", BANK_PLACEHOLDER);

  fillIf("owner_home_address", s(app.business_address));
  fillIf("owner_home_city", s(app.business_city));
  fillIf("owner_home_state", s(app.business_state));
  fillIf("owner_home_zip", s(app.business_zip));

  fillIf("business_type", inferEntityType(s(app.business_legal_name) || s(app.business_dba)));

  return filled;
}
