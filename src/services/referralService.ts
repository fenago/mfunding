import supabase from "../supabase";

// Referral partner program — CPAs, bookkeepers, RE agents, equipment vendors.
// $100 (default) gift card per funded referral.

export type PartnerType = "cpa" | "bookkeeper" | "real_estate_agent" | "equipment_vendor" | "attorney" | "other";

export interface ReferralPartner {
  id: string;
  name: string;
  company: string | null;
  partner_type: PartnerType;
  email: string | null;
  phone: string | null;
  referral_count: number;
  funded_count: number;
  total_paid: number;
  reward_per_funded: number;
  status: "active" | "inactive";
  notes: string | null;
}

export type ReferralPartnerInput = Omit<ReferralPartner, "id">;

export const PARTNER_TYPES: { value: PartnerType; label: string }[] = [
  { value: "cpa", label: "CPA / Accountant" },
  { value: "bookkeeper", label: "Bookkeeper" },
  { value: "real_estate_agent", label: "Real Estate Agent" },
  { value: "equipment_vendor", label: "Equipment Vendor" },
  { value: "attorney", label: "Attorney" },
  { value: "other", label: "Other" },
];

export async function listReferralPartners(): Promise<ReferralPartner[]> {
  const { data, error } = await supabase.from("referral_partners").select("*").order("name");
  if (error) throw error;
  return (data || []) as ReferralPartner[];
}

export async function saveReferralPartner(id: string | null, input: Partial<ReferralPartnerInput>): Promise<ReferralPartner> {
  if (id) {
    const { data, error } = await supabase.from("referral_partners").update(input).eq("id", id).select().single();
    if (error) throw error;
    return data as ReferralPartner;
  }
  const { data, error } = await supabase.from("referral_partners").insert(input).select().single();
  if (error) throw error;
  return data as ReferralPartner;
}

export async function deleteReferralPartner(id: string): Promise<void> {
  const { error } = await supabase.from("referral_partners").delete().eq("id", id);
  if (error) throw error;
}
