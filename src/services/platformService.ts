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

// --- Closer document merge settings -------------------------------------------
// The company-side values that get substituted into every closer legal document
// before it is sent: [COMPANY], [SIGNATORY NAME, TITLE], [STATE], the clawback
// window, the renewal override, and the Schedule A §4 draw treatment.
//
// Read SERVER-SIDE by send-closer-onboarding-package at merge time, so a change
// here applies to the next document sent with no redeploy.
//
// NOTE: two screens edit this one key — the draw treatment lives on
// /admin/platform-config (it's an admin policy flag), the rest live on
// /admin/closer-docs (they're document fields). Both load the whole object and
// save the whole object, so neither clobbers the other's fields.

export type { DrawTreatment } from "@/lib/closerDocMerge";
import { DEFAULT_DRAW_TREATMENT, type DrawTreatment, type MergeSettings } from "@/lib/closerDocMerge";

export type CloserDocSettings = MergeSettings;

export const DRAW_TREATMENTS: { value: DrawTreatment; label: string; help: string }[] = [
  {
    value: "repayable",
    label: "Repayable (default)",
    help: "If the draw period ends with drawn amounts exceeding earned commission, the closer owes the balance back.",
  },
  {
    value: "forgiven",
    label: "Forgiven",
    help: "Any unrecovered draw balance is written off when the draw period ends.",
  },
];

export const DEFAULT_CLOSER_DOC_SETTINGS: CloserDocSettings = {
  // The entity that prints on every executed contract. Owner-confirmed 2026-07-11.
  // The saved DB value wins; this fallback must never be a stale//wrong entity.
  company_legal_name: "Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding",
  company_signatory: null,
  governing_state: "Florida",
  clawback_window_days: null,
  renewal_override_pct: null,
  draw_unrecovered_treatment: DEFAULT_DRAW_TREATMENT,
  payment_method: "direct deposit (ACH)",
};

export const getCloserDocSettings = () =>
  getSetting<CloserDocSettings>("closer_docs", DEFAULT_CLOSER_DOC_SETTINGS);
export const saveCloserDocSettings = (s: CloserDocSettings) => saveSetting("closer_docs", s);

// --- Shared company phone line (Google Voice) ---------------------------------
// The team's shared Google Voice login. Stored under key "company_voice"; the row is
// gated by a RESTRICTIVE RLS policy so ONLY authenticated staff can read it (every
// other platform_settings key stays publicly readable for the marketing site). The
// password is NEVER hardcoded in the repo — it lives only in the DB, set via SQL.
export interface CompanyVoice {
  url: string;
  username: string;
  password: string;
}

export const DEFAULT_COMPANY_VOICE: CompanyVoice = {
  url: "https://voice.google.com",
  username: "",
  password: "",
};

export const getCompanyVoice = () => getSetting<CompanyVoice>("company_voice", DEFAULT_COMPANY_VOICE);

// --- Instantly cold-email settings --------------------------------------------
// Instantly's v2 /accounts endpoint does NOT report a per-mailbox daily send
// limit for MANAGED accounts, so the Email page can't derive send capacity from
// the API alone. This workspace default fills that gap: it's the per-mailbox
// daily cap we ASSUME when the API doesn't report one. 30 = Instantly's own
// default. Editable inline on /admin/email (super-admin) to match your real
// Instantly setting.
export interface InstantlySettings {
  default_daily_limit: number;
}

export const DEFAULT_INSTANTLY_SETTINGS: InstantlySettings = {
  default_daily_limit: 30,
};

export const getInstantlySettings = () =>
  getSetting<InstantlySettings>("instantly_settings", DEFAULT_INSTANTLY_SETTINGS);
export const saveInstantlySettings = (s: InstantlySettings) => saveSetting("instantly_settings", s);

// --- AI underwriter models ----------------------------------------------------
// Which Claude models the underwrite-deal edge function uses. Read at RUN TIME by
// the function (platform_settings key "underwriting_models"); when unset it falls
// back to the hardcoded defaults in code, so a missing row never breaks a run.
// The owner default is Opus 5 (judge) + Sonnet 5 (extraction); super-admin can
// switch either from /admin/settings/underwriting.
export interface UnderwritingModels {
  judge_model: string;      // produces the risk/affordability verdict + narrative
  extraction_model: string; // reads the PDFs and extracts per-statement figures
}

export const DEFAULT_UNDERWRITING_MODELS: UnderwritingModels = {
  judge_model: "claude-opus-5",
  extraction_model: "claude-sonnet-5",
};

// Curated, verified-available model ids (checked against Anthropic /v1/models).
// Keep in sync with the edge function's expectations; only ids known to work here.
export const UNDERWRITING_MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

// Friendly label for a model id (falls back to the raw id for custom/unknown ids).
export const modelLabel = (id: string | null | undefined): string =>
  (id ? (UNDERWRITING_MODEL_OPTIONS.find((o) => o.id === id)?.label ?? id) : "—");

export const getUnderwritingModels = () =>
  getSetting<UnderwritingModels>("underwriting_models", DEFAULT_UNDERWRITING_MODELS);
export const saveUnderwritingModels = (m: UnderwritingModels) => saveSetting("underwriting_models", m);
