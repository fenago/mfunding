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
  /**
   * CANONICAL = a value a human may deliberately CHOOSE for a deal, and therefore
   * an option in every lead-source picker (see LEAD_SOURCE_OPTIONS).
   *
   * Entries WITHOUT this flag still render — they are legacy spellings
   * (`ucc_lead` for `ucc_list`), or machine-written values nobody should pick by
   * hand (`ghl_other` means "the CRM does not know where this came from"; picking
   * it as an attribution would be a lie). Offering an alias alongside its
   * canonical twin is how a picker starts writing two spellings of one thing.
   */
  canonical?: true;
}

// Keys are the exact deals.lead_source / customers.source strings seen in the DB.
const SOURCE_MAP: Record<string, SourceMeta> = {
  live_transfer: { label: "Live Transfer", tone: "transfer", canonical: true },
  realtime_appt: { label: "Real-Time Appt", tone: "transfer", canonical: true },
  // OUR OWN setter handing a merchant to a closer — a live conversation we
  // generated, not one we bought. Owner's ruling, 2026-09-29: "I don't consider
  // that a live transfer. I consider that an internal transfer." tone "transfer"
  // is deliberate: the merchant is on the phone, so it belongs to the hot-lead
  // class (REALTIME_LEAD_SOURCES is derived from this) and the DB agrees —
  // is_realtime_lead_source() accepts it, so it routes to the processor pool and
  // owes no 5-minute callback clock. What it must NEVER do is count as vendor
  // delivery; that is lead_source's job, and the reason it is its own value.
  internal_transfer: { label: "Internal Transfer", tone: "transfer", canonical: true },
  ucc_list: { label: "UCC", tone: "ucc", canonical: true },
  ucc_lead: { label: "UCC", tone: "ucc" }, // legacy alias — same thing as ucc_list
  trigger_list: { label: "Trigger", tone: "ucc", canonical: true },
  aged_list: { label: "Aged", tone: "aged", canonical: true },
  aged_lead: { label: "Aged", tone: "aged" }, // legacy alias — same thing as aged_list
  aged_transfer: { label: "Aged Transfer", tone: "aged", canonical: true },
  web_purchased: { label: "Web (Purchased)", tone: "aged", canonical: true },
  website: { label: "Website", tone: "web", canonical: true },
  website_apply: { label: "Website", tone: "web" }, // legacy alias — same thing as website
  google_ads: { label: "Google Ads", tone: "web", canonical: true },
  cold_email: { label: "Cold Email", tone: "email", canonical: true },
  cold_email_landing: { label: "Cold Email", tone: "email" }, // legacy alias
  cold_call: { label: "Cold Call", tone: "email", canonical: true },
  ph_setter: { label: "PH Setter", tone: "setter", canonical: true },
  ghl_other: { label: "GHL", tone: "ghl" }, // machine-written — renders, never offered
  renewal: { label: "Renewal", tone: "renewal", canonical: true },
  repeat_customer: { label: "Repeat Customer", tone: "renewal" }, // legacy — use `renewal`
  referral: { label: "Referral", tone: "referral", canonical: true },
};

/**
 * Every lead_source that means "someone is (or just was) on the phone" — the
 * REAL-TIME class: Synergy live transfers and real-time appointments. These are
 * the most expensive leads we buy ($50–100+) and the most perishable.
 *
 * Derived from the map above rather than hand-listed, so adding a new real-time
 * vendor source to SOURCE_MAP with tone "transfer" automatically lights it up on
 * every surface that hunts for hot leads (the Hot Leads panel's DB filter reads
 * this array directly).
 */
export const REALTIME_LEAD_SOURCES: string[] = Object.entries(SOURCE_MAP)
  .filter(([, meta]) => meta.tone === "transfer")
  .map(([key]) => key);

/** Is this a real-time lead (live transfer / real-time appointment)? */
export function isRealtimeLead(leadSource?: string | null): boolean {
  return sourceMeta(leadSource).tone === "transfer";
}

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

export interface LeadSourceOption {
  value: string;
  label: string;
  /** True when this option exists ONLY because it is the row's current value. */
  isCurrent?: true;
}

/**
 * The lead sources a human may CHOOSE, derived from SOURCE_MAP so a picker can
 * never again drift from what the database actually holds.
 *
 * WHY THIS EXISTS. The deal edit modal carried its own hand-written list of nine
 * values. It omitted `realtime_appt` (207 deals), `ghl_other` (60), `ucc_list`
 * (35), `ph_setter` (18) and `aged_list` (1) — 322 of 424 deals, 76% of the book.
 * A <select> whose value matches no <option> renders BLANK, so three quarters of
 * deals presented their lead source as unset and invited a "repair"; the nearest
 * plausible option on the list was Live Transfer. That is how at least one
 * real-time lead (MF-2026-0100) silently became a live transfer, which in turn
 * moved it out of the only panel that grades its 5-minute clock. Nobody
 * mis-clicked — the form asked for it.
 */
export const LEAD_SOURCE_OPTIONS: ReadonlyArray<LeadSourceOption> = Object.entries(SOURCE_MAP)
  .filter(([, meta]) => meta.canonical)
  .map(([value, meta]) => ({ value, label: meta.label }));

/**
 * The options for a picker editing `current`, which ALWAYS includes `current`
 * itself — labelled honestly — even when it is a legacy alias, a machine-written
 * value, or something this build has never heard of.
 *
 * A real value must never be presented as empty. Falling out of the canonical
 * list is a reason to show a value plainly, not a reason to hide it: a hidden
 * value reads as "unset", and "unset" is what gets overwritten.
 */
export function leadSourceOptionsFor(current?: string | null): ReadonlyArray<LeadSourceOption> {
  const cur = (current ?? "").trim();
  if (!cur || LEAD_SOURCE_OPTIONS.some((o) => o.value === cur)) return LEAD_SOURCE_OPTIONS;
  // sourceLabel() title-cases anything unknown, so this is readable even for a
  // value added to the DB after this build shipped.
  return [{ value: cur, label: sourceLabel(cur), isCurrent: true }, ...LEAD_SOURCE_OPTIONS];
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
