import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

export type CampaignChannel =
  | "live_transfer"
  | "real_time"
  | "web_purchased"
  | "aged_transfer"
  | "cold_email"
  | "aged_leads"
  | "ucc"
  | "trigger"
  | "google_ads"
  | "referral"
  | "seo"
  | "social"
  | "other";

export type CampaignStatus = "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  budget: number;
  spent: number;
  leads_target: number | null;
  leads_purchased: number | null; // how many leads we actually BOUGHT (true acquisition cost)
  clicks: number | null;          // for click channels (Google Ads) → real CPC
  market: string | null;
  vendor_id: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignInput = Omit<Campaign, "id" | "created_at" | "updated_at">;

export const CHANNEL_LABELS: Record<CampaignChannel, string> = {
  live_transfer: "Live Transfer Leads",
  real_time: "Real-Time / Appointment Leads",
  web_purchased: "Purchased Web Leads",
  aged_transfer: "Aged Live Transfers",
  cold_email: "Cold Email (Instantly)",
  aged_leads: "Aged Leads",
  ucc: "UCC Data",
  trigger: "Trigger Leads",
  google_ads: "Google Ads",
  referral: "Referral",
  seo: "SEO / Organic",
  social: "Social",
  other: "Other",
};

export interface CampaignMetrics {
  spent: number;
  leads: number; // attributed deals (leads that entered the pipeline)
  leadsPurchased: number | null; // leads we bought (from the campaign record)
  byStatus: Record<string, number>;
  contacted: number; // reached at least 'contacted'
  contactPct: number; // contacted / leads
  funded: number;
  fundedAmount: number; // sum of amount_funded
  estCommission: number; // fundedAmount * commissionRate (the "revenue" to us)
  conversionPct: number; // funded / leads
  acquisitionCpl: number | null; // spent / leadsPurchased — TRUE cost per lead bought
  costPerLead: number | null;    // spent / attributed leads (pipeline entry cost)
  costPerFunded: number | null;  // spent / funded — the number that matters most
  cpc: number | null;            // spent / clicks (click channels only)
  roas: number | null;           // estCommission / spent — revenue-to-spend ratio (×)
  roiPct: number | null;         // (estCommission - spent) / spent
}

// Average broker commission on a funded deal ≈ 8 points.
const COMMISSION_RATE = 0.08;

// Statuses that mean the lead progressed past "new".
const PAST_NEW = (s: string) => s !== "new" && s !== "new_distressed";
const FUNDED = new Set(["funded", "restructure_executed"]);

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function saveCampaign(id: string | null, input: Partial<CampaignInput>): Promise<Campaign> {
  if (id) {
    const rows = await mustWrite<Campaign>("update campaign", supabase.from("campaigns").update(input).eq("id", id));
    return rows[0];
  }
  const rows = await mustWrite<Campaign>("create campaign", supabase.from("campaigns").insert(input));
  return rows[0];
}

export async function deleteCampaign(id: string): Promise<void> {
  await mustWrite("delete campaign", supabase.from("campaigns").delete().eq("id", id));
}

/** Compute metrics for every campaign in one pass over attributed deals. */
export async function getCampaignMetrics(campaigns: Campaign[]): Promise<Record<string, CampaignMetrics>> {
  const { data, error } = await supabase
    .from("deals")
    .select("campaign_id, status, amount_funded")
    .not("campaign_id", "is", null);
  if (error) throw error;

  const spentById = new Map(campaigns.map((c) => [c.id, c.spent || c.budget || 0]));
  const acc: Record<string, { leads: number; byStatus: Record<string, number>; funded: number; fundedAmount: number }> = {};

  for (const d of data ?? []) {
    const cid = d.campaign_id as string;
    if (!acc[cid]) acc[cid] = { leads: 0, byStatus: {}, funded: 0, fundedAmount: 0 };
    const a = acc[cid];
    a.leads += 1;
    a.byStatus[d.status] = (a.byStatus[d.status] || 0) + 1;
    if (FUNDED.has(d.status)) {
      a.funded += 1;
      a.fundedAmount += Number(d.amount_funded) || 0;
    }
  }

  const out: Record<string, CampaignMetrics> = {};
  for (const c of campaigns) {
    const a = acc[c.id] ?? { leads: 0, byStatus: {}, funded: 0, fundedAmount: 0 };
    const spent = spentById.get(c.id) ?? 0;
    const contacted = Object.entries(a.byStatus)
      .filter(([s]) => PAST_NEW(s))
      .reduce((n, [, v]) => n + v, 0);
    const estCommission = a.fundedAmount * COMMISSION_RATE;
    const purchased = c.leads_purchased ?? null;
    const clicks = c.clicks ?? null;
    out[c.id] = {
      spent,
      leads: a.leads,
      leadsPurchased: purchased,
      byStatus: a.byStatus,
      contacted,
      contactPct: a.leads ? (contacted / a.leads) * 100 : 0,
      funded: a.funded,
      fundedAmount: a.fundedAmount,
      estCommission,
      conversionPct: a.leads ? (a.funded / a.leads) * 100 : 0,
      acquisitionCpl: purchased && purchased > 0 ? spent / purchased : null,
      costPerLead: a.leads ? spent / a.leads : null,
      costPerFunded: a.funded ? spent / a.funded : null,
      cpc: clicks && clicks > 0 ? spent / clicks : null,
      roas: spent > 0 ? estCommission / spent : null,
      roiPct: spent > 0 ? ((estCommission - spent) / spent) * 100 : null,
    };
  }
  return out;
}
