import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

// Key-value platform settings (white-label branding + misc super-admin config).

export interface Branding {
  company_name: string;
  tagline: string;
  primary_color: string;
  accent_color: string;
  logo_url: string;
  support_email: string;
}

export const DEFAULT_BRANDING: Branding = {
  company_name: "Momentum Funding",
  tagline: "Business funding, fast.",
  primary_color: "#0A3D62",
  accent_color: "#34C759",
  logo_url: "",
  support_email: "",
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return { ...fallback, ...((data?.value as Partial<T>) ?? {}) };
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  await mustWrite("save platform setting", supabase.from("platform_settings").upsert({ key, value }, { onConflict: "key" }));
}

export const getBranding = () => getSetting<Branding>("branding", DEFAULT_BRANDING);
export const saveBranding = (b: Branding) => saveSetting("branding", b);

// --- Lead assignment strategy -------------------------------------------------
// Read at INSERT time by the `trg_deals_auto_assign_closer` BEFORE INSERT trigger on
// `deals`, so it applies to every intake path (mca-intake, vcf-intake,
// live-transfer-intake, ghl-webhook, bulk-lead-import) with no redeploy.
// Whatever the strategy, if no eligible closer resolves the deal is left UNASSIGNED —
// the lead is never dropped, and the super-admin sees it via "Unassigned only" on /admin/deals.

export type LeadAssignmentStrategy =
  | "round_robin"       // rotate across eligible closers (default)
  | "least_open_deals"  // assign to the eligible closer with the fewest open deals
  | "manual"            // never auto-assign; super-admin works the Unassigned queue
  | "specific_closer";  // always assign to one chosen closer

export interface LeadAssignmentSetting {
  strategy: LeadAssignmentStrategy;
  /** profiles.id (== closers.user_id) — only used when strategy === "specific_closer". */
  specific_closer_profile_id: string | null;
}

export const LEAD_ASSIGNMENT_STRATEGIES: { value: LeadAssignmentStrategy; label: string; help: string }[] = [
  { value: "round_robin", label: "Round-robin (default)", help: "Rotates evenly across active closers — least-recently-assigned wins." },
  { value: "least_open_deals", label: "Least open deals", help: "Load-balances: the active closer with the lightest open pipeline gets the lead." },
  { value: "manual", label: "Manual (no auto-assign)", help: "Leads arrive unassigned. Assign them yourself from the Unassigned queue on Deals." },
  { value: "specific_closer", label: "Specific closer", help: "Every new lead goes to one chosen closer." },
];

export const DEFAULT_LEAD_ASSIGNMENT: LeadAssignmentSetting = {
  strategy: "round_robin",
  specific_closer_profile_id: null,
};

export const getLeadAssignment = () =>
  getSetting<LeadAssignmentSetting>("lead_assignment", DEFAULT_LEAD_ASSIGNMENT);
export const saveLeadAssignment = (s: LeadAssignmentSetting) => saveSetting("lead_assignment", s);
