import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

// Renewal monitoring — funded deals tracked by paydown %. Renewal outreach in GHL
// fires off the "Paydown %" custom field (pushed via ghlService.pushDealPaydownToGHL),
// so this dashboard is where staff update paydown and trigger the renewal workflow.

export interface RenewalCandidate {
  id: string;
  deal_number: string | null;
  status: string;
  amount_funded: number | null;
  funded_at: string | null;
  paydown_percentage: number | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  customer: {
    business_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

export const RENEWAL_MILESTONES = [40, 60, 75, 100];

/** The next renewal milestone a deal has reached (or null if under 40%). */
export function reachedMilestone(paydown: number | null): number | null {
  const p = paydown ?? 0;
  let m: number | null = null;
  for (const milestone of RENEWAL_MILESTONES) if (p >= milestone) m = milestone;
  return m;
}

/** Funded / renewal-eligible deals, highest paydown first (closest to renewal). */
export async function getRenewalCandidates(): Promise<RenewalCandidate[]> {
  const { data, error } = await supabase
    .from("deals")
    .select(`
      id, deal_number, status, amount_funded, funded_at, paydown_percentage,
      ghl_contact_id, ghl_opportunity_id,
      customer:customers!customer_id ( business_name, first_name, last_name )
    `)
    .in("status", ["funded", "renewal_eligible"])
    .order("paydown_percentage", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as RenewalCandidate[];
}

/** Set a deal's paydown %. At >= 40% it also flips the deal to renewal_eligible. */
export async function updateDealPaydown(dealId: string, paydown: number): Promise<void> {
  const patch: Record<string, unknown> = { paydown_percentage: paydown };
  if (paydown >= 40) {
    patch.status = "renewal_eligible";
    patch.renewal_eligible_date = new Date().toISOString().slice(0, 10);
  }
  await mustWrite("update deal paydown", supabase.from("deals").update(patch).eq("id", dealId));
}
