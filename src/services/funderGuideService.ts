import supabase from "../supabase";

// Broker-facing funder reference: who funds what + how to submit. Pulled live from
// the lenders table so it stays current with /admin/lenders.

export interface FunderGuideRow {
  id: string;
  company_name: string;
  status: string;
  lender_types: string[] | null;
  funding_products: string[] | null;
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
      id, company_name, status, lender_types, funding_products,
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

/** Human commission string from the structured fields. */
export function commissionLabel(r: FunderGuideRow): string {
  if (r.commission_structure) return r.commission_structure;
  if (r.commission_rate != null) return `${r.commission_rate} ${r.commission_type ?? "points"}`;
  return "—";
}

export function productLabels(r: FunderGuideRow): string {
  const set = new Set([...(r.lender_types ?? []), ...(r.funding_products ?? [])]);
  const MAP: Record<string, string> = {
    mca: "MCA", line_of_credit: "LOC", term_loan: "Term", sba: "SBA",
    equipment: "Equipment", equipment_financing: "Equipment", revenue_based: "RBF",
    startup: "Startup", real_estate: "Real Estate", vcf: "Debt Relief",
  };
  return [...set].map((t) => MAP[t] ?? t).join(", ") || "—";
}
