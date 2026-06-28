import supabase from "../supabase";

// Lead source cost tracking — cost per lead, spend, and ROI by source. Feeds the
// golden-ratio metric (cost per funded deal < $1,500).

export type LeadSourceType =
  | "live_transfer" | "google_ads" | "aged_lead" | "ucc_filing"
  | "referral" | "sub_iso" | "organic" | "social_media" | "other";

export interface LeadSource {
  id: string;
  name: string;
  type: LeadSourceType;
  cost_per_lead: number | null;
  monthly_budget: number | null;
  total_leads: number;
  total_funded: number;
  total_spend: number;
  total_revenue: number;
  status: "active" | "inactive" | "archived";
}

export type LeadSourceInput = Omit<LeadSource, "id">;

export const LEAD_SOURCE_TYPES: { value: LeadSourceType; label: string }[] = [
  { value: "live_transfer", label: "Live Transfer" },
  { value: "google_ads", label: "Google Ads" },
  { value: "aged_lead", label: "Aged Lead" },
  { value: "ucc_filing", label: "UCC Filing" },
  { value: "referral", label: "Referral" },
  { value: "sub_iso", label: "Sub-ISO" },
  { value: "organic", label: "Organic / SEO" },
  { value: "social_media", label: "Social Media" },
  { value: "other", label: "Other" },
];

export function costPerFunded(s: Pick<LeadSource, "total_spend" | "total_funded">): number | null {
  return s.total_funded > 0 ? s.total_spend / s.total_funded : null;
}
export function roiPct(s: Pick<LeadSource, "total_spend" | "total_revenue">): number | null {
  return s.total_spend > 0 ? ((s.total_revenue - s.total_spend) / s.total_spend) * 100 : null;
}

export async function listLeadSources(): Promise<LeadSource[]> {
  const { data, error } = await supabase.from("lead_sources").select("*").order("name");
  if (error) throw error;
  return (data || []) as LeadSource[];
}

export async function saveLeadSource(id: string | null, input: Partial<LeadSourceInput>): Promise<LeadSource> {
  if (id) {
    const { data, error } = await supabase.from("lead_sources").update(input).eq("id", id).select().single();
    if (error) throw error;
    return data as LeadSource;
  }
  const { data, error } = await supabase.from("lead_sources").insert(input).select().single();
  if (error) throw error;
  return data as LeadSource;
}

export async function deleteLeadSource(id: string): Promise<void> {
  const { error } = await supabase.from("lead_sources").delete().eq("id", id);
  if (error) throw error;
}
