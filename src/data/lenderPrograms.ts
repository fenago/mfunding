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
}

export type ProgramFieldType = "money" | "number" | "percent" | "text" | "list";

export interface ProgramField {
  key: keyof LenderProgram;
  label: string;
  short: string; // compact column header for the matrix
  type: ProgramFieldType;
  unit?: string;
  help?: string;
  gate?: boolean; // used by the qualification matcher as a hard eligibility gate
}

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
  { key: "required_documents", label: "Documents for pre-approval", short: "Docs", type: "list" },
];

// Columns to SELECT for a program (lender_programs.*), plus the joined lender name/status.
export const PROGRAM_SELECT =
  "id, lender_id, product_type, is_active, approval_min, approval_max, term_text, min_credit_score, annual_revenue_required, monthly_revenue_required, time_in_business_months, cost_of_capital, points_min, points_max, time_to_approve, approval_pct_min, approval_pct_max, payment_frequency, industries_note, important_details, required_documents, notes";

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return "$" + Number(n).toLocaleString();
}

export function fmtField(f: ProgramField, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "money") return money(v as number);
  if (f.type === "percent") return `${v}%`;
  if (f.type === "number") return `${v}${f.unit ? " " + f.unit : ""}`;
  if (f.type === "list") return Array.isArray(v) && v.length ? (v as string[]).join(" · ") : "—";
  return String(v);
}
