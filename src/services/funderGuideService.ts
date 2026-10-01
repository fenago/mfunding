import supabase from "../supabase";
import { productsOf, PRODUCT_LABEL_SHORT } from "../lib/lenderProducts";

// Broker-facing funder reference: who funds what + how to submit. Pulled live from
// the lenders table so it stays current with /admin/lenders.

export interface FunderGuideRow {
  id: string;
  company_name: string;
  status: string;
  website: string | null;
  lender_types: string[] | null;
  category: { products?: unknown } | null;
  submission_email: string | null;
  submission_portal_url: string | null;
  submission_notes: string | null;
  commission_rate: number | null;
  commission_structure: string | null;
  commission_type: string | null;
  min_credit_score: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business: number | null;
  factor_rate_range: string | null;
  term_lengths: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
}

/** Live + application-submitted funders, live first, alphabetical within. */
export async function getFunderGuide(): Promise<FunderGuideRow[]> {
  const { data, error } = await supabase
    .from("lenders")
    .select(`
      id, company_name, status, website, lender_types, category,
      submission_email, submission_portal_url, submission_notes,
      commission_rate, commission_structure, commission_type,
      min_credit_score, min_monthly_revenue, min_time_in_business,
      factor_rate_range, term_lengths,
      primary_contact_name, primary_contact_email, primary_contact_phone
    `)
    .in("status", ["live_vendor", "application_submitted"])
    .order("company_name", { ascending: true });
  if (error) throw error;
  // live_vendor first
  return ((data || []) as FunderGuideRow[]).sort((a, b) =>
    a.status === b.status ? 0 : a.status === "live_vendor" ? -1 : 1,
  );
}

export interface ProspectRow {
  id: string;
  company_name: string;
  website: string | null;
  lender_types: string[] | null;
  category: { products?: unknown } | null;
  notes: string | null;
}

/** Funders we've identified but not yet applied to (apply pipeline). */
export async function getProspects(): Promise<ProspectRow[]> {
  const { data, error } = await supabase
    .from("lenders")
    .select("id, company_name, website, lender_types, category, notes")
    .eq("status", "potential")
    .order("company_name", { ascending: true });
  if (error) throw error;
  return (data || []) as ProspectRow[];
}

/** Human commission string from the structured fields. */
export function commissionLabel(r: FunderGuideRow): string {
  if (r.commission_structure) return r.commission_structure;
  if (r.commission_rate != null) return `${r.commission_rate} ${r.commission_type ?? "points"}`;
  return "—";
}

/**
 * Products a funder does, via the ONE shared union in lib/lenderProducts.
 *
 * This used to union `lender_types` with `funding_products` and carry its own
 * label map — a third union with a fourth vocabulary. `funding_products` was
 * the wrong second column: 116 of 125 lenders sit at its never-written 2024
 * default, 8 of the 9 populated rows say only ['mca'], and where it IS
 * populated it contradicts the curated column (Swoop Funding read ['mca']
 * against six products in `category`). The caller already knew: FunderGuidePage
 * passed `funding_products: null` inline to suppress it, working around the
 * column locally instead of fixing it.
 */
export function productLabels(r: Pick<FunderGuideRow, "lender_types" | "category">): string {
  return productsOf(r).map((p) => PRODUCT_LABEL_SHORT[p]).join(", ") || "—";
}
