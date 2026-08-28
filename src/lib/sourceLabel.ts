// Canonical lead_source → display label + tone. ONE map, used by every surface that
// shows where a lead came from (My Day cards, /admin/deals, the Playbook context bar,
// the Assignments tab), so they can never drift apart again. Before this, each place
// carried its own partial map and ucc_list/ghl_other/ph_setter/aged_list fell through
// to a meaningless "Other" — 30% of the book. An UNKNOWN source now renders as its
// title-cased raw value (honest), never a blank "Other".

export type SourceTone =
  | "transfer" // live / real-time — someone is (or was) on the line
  | "ucc"      // purchased UCC-filing data — COLD (merchant never contacted us)
  | "aged"     // purchased aged/web leads — once raised a hand, now cold
  | "web"      // inbound website / apply form — merchant came to us
  | "email"    // cold email
  | "setter"   // PH setter sourced
  | "renewal"  // existing funded merchant
  | "referral" // partner/referral
  | "ghl"      // created by the GHL webhook — origin needs pinning
  | "neutral"; // unknown / other

interface SourceMeta {
  label: string;
  tone: SourceTone;
}

// Keys are the exact deals.lead_source / customers.source strings seen in the DB.
const SOURCE_MAP: Record<string, SourceMeta> = {
  live_transfer: { label: "Live Transfer", tone: "transfer" },
  realtime_appt: { label: "Real-Time Appt", tone: "transfer" },
  ucc_list: { label: "UCC", tone: "ucc" },
  ucc_lead: { label: "UCC", tone: "ucc" }, // legacy alias — same thing as ucc_list
  trigger_list: { label: "Trigger", tone: "ucc" },
  aged_list: { label: "Aged", tone: "aged" },
  aged_lead: { label: "Aged", tone: "aged" },
  aged_transfer: { label: "Aged Transfer", tone: "aged" },
  web_purchased: { label: "Web (Purchased)", tone: "aged" },
  website: { label: "Website", tone: "web" },
  website_apply: { label: "Website", tone: "web" },
  cold_email: { label: "Cold Email", tone: "email" },
  cold_email_landing: { label: "Cold Email", tone: "email" },
  cold_call: { label: "Cold Call", tone: "email" },
  ph_setter: { label: "PH Setter", tone: "setter" },
  ghl_other: { label: "GHL", tone: "ghl" },
  renewal: { label: "Renewal", tone: "renewal" },
  referral: { label: "Referral", tone: "referral" },
};

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Canonical {label, tone} for a lead_source. Unknown → honest title-cased raw, never "Other". */
export function sourceMeta(leadSource?: string | null): SourceMeta {
  if (!leadSource || !leadSource.trim()) return { label: "Unknown", tone: "neutral" };
  return SOURCE_MAP[leadSource] ?? { label: titleCase(leadSource), tone: "neutral" };
}

/** Just the label, for plain text (e.g. a table cell). */
export function sourceLabel(leadSource?: string | null): string {
  return sourceMeta(leadSource).label;
}

/** Tailwind chip classes per tone (light + dark). Consuming components render a chip with these. */
export const SOURCE_TONE_CLASS: Record<SourceTone, string> = {
  transfer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  ucc: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200",
  aged: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  web: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  email: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  setter: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200",
  renewal: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  referral: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200",
  ghl: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  neutral: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};
