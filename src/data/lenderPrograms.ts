// Funder Approval Matrix — single source of truth for per-lender, per-product
// approval criteria (modeled on the GoKapital "Business Loan Product Summary").
// Backed by the public.lender_programs table (one row per lender × product_type).
// MCA is the only active product today; the rest are scaffolded for later.

export interface ProductType {
  value: string;
  label: string;
  active: boolean;
}

export const PRODUCT_TYPES: ProductType[] = [
  { value: "mca", label: "Revenue-Based / MCA", active: true },
  { value: "equipment", label: "Equipment Financing", active: false },
  { value: "personal_startup", label: "Personal & Start-up Loan", active: false },
  { value: "sba_7a", label: "SBA 7(a) Loan", active: false },
  { value: "term_loan", label: "Business Term Loan", active: false },
  { value: "line_of_credit", label: "Business Line of Credit", active: false },
];

export interface LenderProgram {
  id: string;
  lender_id: string;
  product_type: string;
  is_active: boolean;
  approval_min: number | null;
  approval_max: number | null;
  term_text: string | null;
  min_credit_score: number | null;
  annual_revenue_required: number | null;
  monthly_revenue_required: number | null;
  time_in_business_months: number | null;
  cost_of_capital: string | null;
  points_min: number | null;
  points_max: number | null;
  time_to_approve: string | null;
  approval_pct_min: number | null;
  approval_pct_max: number | null;
  payment_frequency: string | null;
  industries_note: string | null;
  important_details: string[] | null;
  required_documents: string[] | null;
  notes: string | null;
  // ── Structured doc requirements (supersede required_documents free-text) ──
  doc_bank_statement_months: number | null;
  doc_application: boolean;
  doc_photo_id: boolean;
  doc_voided_check: boolean;
  doc_cc_processing: DocTriState;
  doc_mtd_statement: boolean;
  doc_proof_of_ownership: boolean;
  doc_ar_aging: DocTriState;
  doc_tax_financials: DocTriState;
  doc_conditions: string | null;
  doc_other: string | null;
}

// The 3-state doc columns share the same shape: a "no" default plus two "yes"
// flavors. cc_processing/ar_aging use if_applicable; tax_financials uses conditional.
export type DocTriState = "no" | "if_applicable" | "conditional" | "required";

// 'bool' → ✓ / — ; 'tri' → Required / If applic. / Conditional / — (per field options).
export type ProgramFieldType = "money" | "number" | "percent" | "text" | "list" | "bool" | "tri";

export interface TriOption {
  value: DocTriState;
  label: string; // full label for editors
  short: string; // compact label for the matrix cell
}

export interface ProgramField {
  key: keyof LenderProgram;
  label: string;
  short: string; // compact column header for the matrix
  type: ProgramFieldType;
  unit?: string;
  help?: string;
  gate?: boolean; // used by the qualification matcher as a hard eligibility gate
  doc?: boolean; // structured doc-requirement column (inline-editable in the matrix)
  options?: TriOption[]; // for type 'tri'
}

// Tri-state option sets. "no" always renders as an em-dash (not a requirement).
const CC_AR_OPTIONS: TriOption[] = [
  { value: "no", label: "No", short: "—" },
  { value: "if_applicable", label: "If applicable", short: "If applic." },
  { value: "required", label: "Required", short: "Required" },
];
const TAX_OPTIONS: TriOption[] = [
  { value: "no", label: "No", short: "—" },
  { value: "conditional", label: "Conditional", short: "Conditional" },
  { value: "required", label: "Required", short: "Required" },
];

// Ordered like the GoKapital sheet — these ARE the matrix columns and the
// per-lender editor rows. Keep this list as the one place fields are defined.
export const PROGRAM_FIELDS: ProgramField[] = [
  { key: "approval_min", label: "Approval amount (min)", short: "Approve min", type: "money", gate: true },
  { key: "approval_max", label: "Approval amount (max)", short: "Approve max", type: "money", gate: true },
  { key: "term_text", label: "Term length", short: "Term", type: "text", help: "e.g. 3 to 18 Months" },
  { key: "min_credit_score", label: "Minimum credit score", short: "Min FICO", type: "number", help: "blank = none", gate: true },
  { key: "annual_revenue_required", label: "Annual revenue required", short: "Annual rev", type: "money", gate: true },
  { key: "monthly_revenue_required", label: "Monthly revenue required", short: "Monthly rev", type: "money", gate: true },
  { key: "time_in_business_months", label: "Time in business", short: "TIB", type: "number", unit: "mo", gate: true },
  { key: "cost_of_capital", label: "Cost of capital", short: "Cost", type: "text", help: "e.g. 1.20–1.49 factor" },
  { key: "points_min", label: "Commission points (min)", short: "Pts min", type: "number", unit: "pts", help: "what we get paid" },
  { key: "points_max", label: "Commission points (max)", short: "Pts max", type: "number", unit: "pts", help: "what we get paid" },
  { key: "time_to_approve", label: "Time to approve", short: "Speed", type: "text", help: "e.g. 24–48 hrs" },
  { key: "approval_pct_min", label: "Approval % of monthly sales (min)", short: "% min", type: "percent", unit: "%" },
  { key: "approval_pct_max", label: "Approval % of monthly sales (max)", short: "% max", type: "percent", unit: "%" },
  { key: "payment_frequency", label: "Payment frequency", short: "Payments", type: "text", help: "Daily / Weekly / Monthly" },
  { key: "industries_note", label: "Industry restrictions", short: "Industries", type: "text" },
  { key: "important_details", label: "Important details", short: "Details", type: "list" },
  // ── Structured doc requirements (replace the free-text "Docs" column) ──
  { key: "doc_bank_statement_months", label: "Bank statements required", short: "Bank stmts", type: "number", unit: "mo", doc: true, help: "months of statements" },
  { key: "doc_application", label: "Signed application", short: "App", type: "bool", doc: true },
  { key: "doc_photo_id", label: "Photo ID", short: "ID", type: "bool", doc: true },
  { key: "doc_voided_check", label: "Voided check", short: "Voided", type: "bool", doc: true },
  { key: "doc_mtd_statement", label: "Month-to-date statement", short: "MTD", type: "bool", doc: true },
  { key: "doc_proof_of_ownership", label: "Proof of ownership", short: "Ownership", type: "bool", doc: true },
  { key: "doc_cc_processing", label: "CC processing statements", short: "CC stmts", type: "tri", doc: true, options: CC_AR_OPTIONS },
  { key: "doc_ar_aging", label: "A/R aging report", short: "A/R", type: "tri", doc: true, options: CC_AR_OPTIONS },
  { key: "doc_tax_financials", label: "Tax return / financials", short: "Tax", type: "tri", doc: true, options: TAX_OPTIONS },
  { key: "doc_conditions", label: "Conditional doc rules", short: "Conditions", type: "text", doc: true },
  { key: "doc_other", label: "Other documents", short: "Docs — other", type: "text", doc: true },
];

// Keys of the structured doc columns (used by the matrix inline editor + filters).
export const DOC_FIELD_KEYS = PROGRAM_FIELDS.filter((f) => f.doc).map((f) => f.key);

// Columns to SELECT for a program (lender_programs.*), plus the joined lender name/status.
export const PROGRAM_SELECT =
  "id, lender_id, product_type, is_active, approval_min, approval_max, term_text, min_credit_score, annual_revenue_required, monthly_revenue_required, time_in_business_months, cost_of_capital, points_min, points_max, time_to_approve, approval_pct_min, approval_pct_max, payment_frequency, industries_note, important_details, required_documents, notes, doc_bank_statement_months, doc_application, doc_photo_id, doc_voided_check, doc_cc_processing, doc_mtd_statement, doc_proof_of_ownership, doc_ar_aging, doc_tax_financials, doc_conditions, doc_other";

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return "$" + Number(n).toLocaleString();
}

export function fmtField(f: ProgramField, v: unknown): string {
  if (f.type === "bool") return v === true ? "✓" : "—";
  if (f.type === "tri") {
    const opt = (f.options ?? CC_AR_OPTIONS).find((o) => o.value === v);
    return opt ? opt.short : "—";
  }
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "money") return money(v as number);
  if (f.type === "percent") return `${v}%`;
  if (f.type === "number") return `${v}${f.unit ? " " + f.unit : ""}`;
  if (f.type === "list") return Array.isArray(v) && v.length ? (v as string[]).join(" · ") : "—";
  return String(v);
}
