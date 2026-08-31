// Data Hygiene — shared types + helpers for the smart-list feature.
//
// Backend contract (migration 20260830_data_hygiene_smart_lists.sql):
//   • smart_lists         — a saved audience: name + criteria (the filter) + source store(s).
//   • smart_list_members  — materialized membership; polymorphic (source, source_id) into
//                           ph_ucc_leads / lead_records / customers, a denormalized snapshot,
//                           and the phone-validation write-back columns.
// Compliance: internal surface, but still never "loan" — MCA positions are advances/funding.

import supabase from "@/supabase";

/* A smart list draws from exactly one store in v1 ('mixed' is deferred).
   'ghl' is the GoHighLevel CRM book — searched/materialized via the
   ghl-contacts-search edge fn, NOT queried as a Supabase table. */
export type SmartListSource = "ghl" | "ph_ucc" | "lead_records" | "customers" | "mixed";

/* The sources that ARE plain Supabase tables (queried directly from the client).
   'ghl' is excluded — it goes through the edge fn — as is the deferred 'mixed'. */
export type DbSource = "ph_ucc" | "lead_records" | "customers";

export interface SmartList {
  id: string;
  name: string;
  description: string | null;
  source: SmartListSource | null;
  criteria: Record<string, unknown> | null;
  created_by: string | null;
  member_count: number | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
  // Setter-handoff stamps (migration 20260830s) — set by the smart-list-action push.
  dial_tag?: string | null;
  pushed_to_setters_at?: string | null;
  pushed_count?: number | null;
}

/* Results rollup returned by smart-list-action { action:'rollup' }.
   dialable = not excluded AND phone present AND not dead AND not dnc AND not litigator
   (the predicate lives in the smart_list_rollup() SQL RPC — the single source). */
export interface SmartListRollupCounts {
  total: number;
  reachable: number;
  dead: number;
  dnc: number;
  litigator: number;
  no_contact: number;
  unvalidated: number;
  excluded: number;
  dialable: number;
}

/* GHL-safe dial-tag slug, mirrors slugify() in the smart-list-action edge fn so the
   UI's prefilled tag matches the server default. */
export function slugifyTag(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "list"
  );
}

/* Parse a free-typed area-code box ("305, 786 / 212") into unique 3-digit codes.
   Anything that isn't a clean 3-digit run is dropped, so junk never reaches the RPC. */
export function parseAreaCodes(raw: string): string[] {
  const out = new Set<string>();
  for (const tok of (raw || "").split(/[^0-9]+/)) {
    if (/^\d{3}$/.test(tok)) out.add(tok);
  }
  return [...out];
}

/* Denormalized render row stored on each member. phone-validate reads snapshot.phone
   (or phone_number / mobile), so `phone` MUST be present when it exists. */
export interface MemberSnapshot {
  business?: string | null;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  city?: string | null;
  tags?: string[] | null; // GHL members carry their contact tags
}

export interface SmartListMember {
  id: string;
  smart_list_id: string;
  source: string;
  source_id: string;
  snapshot: MemberSnapshot | null;
  line_type: string | null;
  carrier: string | null;
  phone_reachable: boolean | null;
  phone_disconnected: boolean | null;
  phone_validated_at: string | null;
  validation_provider: string | null;
  validation_cost: number | null;
  created_at: string;
}

export const SOURCE_META: Record<
  Exclude<SmartListSource, "mixed">,
  { label: string; table: string; blurb: string; useWhen: string; chip: string; virtual?: boolean }
> = {
  ghl: {
    // 'ghl' stays the internal source key everywhere; only the LABEL is the product
    // name the owner uses — VibeReach (VibeReach.io), our white-label of the CRM.
    label: "VibeReach contacts",
    table: "", // virtual — searched via the ghl-contacts-search edge fn, not a table
    virtual: true,
    blurb: "The whole dialer book — every contact in VibeReach.",
    useWhen: "Use when you want to slice the live book by tag or location.",
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  lead_records: {
    label: "Purchased lists",
    table: "lead_records",
    blurb: "Aged / UCC / trigger lists you uploaded (Lead Machine).",
    useWhen: "Use for the raw purchased book — richest filters, biggest volume.",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  ph_ucc: {
    label: "UCC leads",
    table: "ph_ucc_leads",
    blurb: "Merchants with an advance on file, from UCC filings.",
    useWhen: "Use to target stacked merchants by funder / # of positions.",
    chip: "bg-ocean-blue/10 text-ocean-blue",
  },
  customers: {
    label: "My pipeline (CRM)",
    table: "customers",
    blurb: "Leads that became real deals in your pipeline.",
    useWhen: "Use for worked deals — filter by lead source, revenue, stage.",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

/* US states for the forgiving state picker. `state` is stored as the 2-LETTER
   code in both ph_ucc_leads and lead_records (e.g. 'FL', never 'Florida'), so a
   dropdown keyed on the code is what keeps a search from silently returning 0.
   normalizeState() accepts a full name OR a code and returns the stored code. */
export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const STATE_NAME_TO_CODE: Record<string, string> = US_STATES.reduce(
  (acc, s) => {
    acc[s.name.toLowerCase()] = s.code;
    acc[s.code.toLowerCase()] = s.code;
    return acc;
  },
  {} as Record<string, string>,
);

/* Accept a full state name OR a 2-letter code and return the stored 2-letter
   code ('Florida' → 'FL', 'fl' → 'FL'). Returns "" when the input is blank or
   unrecognized so the caller can skip the filter rather than match nothing. */
export function normalizeState(input: string): string {
  const key = input.trim().toLowerCase();
  if (!key) return "";
  return STATE_NAME_TO_CODE[key] ?? "";
}

/* The columns each Supabase source needs SELECTed to build a member snapshot.
   ('ghl' snapshots are built server-side by the edge fn, so it is not here.) */
export const SNAPSHOT_SELECT: Record<DbSource, string> = {
  ph_ucc: "id,debtor_name,person_name,phone,email,state,debtor_city",
  lead_records: "id,company,first_name,last_name,phone,email,state,city",
  customers: "id,business_name,first_name,last_name,phone,email,address_city,address_state",
};

function joinName(first: unknown, last: unknown): string | null {
  const s = `${first ?? ""} ${last ?? ""}`.trim();
  return s.length ? s : null;
}

/* Map one Supabase source row → the denormalized snapshot stored on the member. */
export function snapshotFromRow(
  source: DbSource,
  row: Record<string, unknown>,
): MemberSnapshot {
  const str = (v: unknown): string | null => {
    const s = (v ?? "").toString().trim();
    return s.length ? s : null;
  };
  if (source === "ph_ucc") {
    return {
      business: str(row.debtor_name),
      contact: str(row.person_name),
      phone: str(row.phone),
      email: str(row.email),
      state: str(row.state),
      city: str(row.debtor_city),
    };
  }
  if (source === "lead_records") {
    return {
      business: str(row.company),
      contact: joinName(row.first_name, row.last_name),
      phone: str(row.phone),
      email: str(row.email),
      state: str(row.state),
      city: str(row.city),
    };
  }
  // customers
  return {
    business: str(row.business_name),
    contact: joinName(row.first_name, row.last_name),
    phone: str(row.phone),
    email: str(row.email),
    state: str(row.address_state),
    city: str(row.address_city),
  };
}

/* supabase-js returns a FunctionsHttpError on non-2xx with the body in
   error.context (a Response). Pull the {error} message out of it when present.
   (Same helper the UCC Harvester + Lead Machine pages use.) */
export async function fnErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      /* body already consumed or not JSON — fall through */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/* A PostgREST "table/relation not found" error → backend not deployed. */
export function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST205" || err.code === "42P01" || /does not exist|find the table/i.test(err.message || "");
}

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export function fmtRelative(d: string | null): string {
  if (!d) return "never";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "never";
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

/* Pull the current staff member's profiles.id for smart_lists.created_by. */
export async function currentProfileId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* Line-type chip meta for the member table + TCPA panel. */
export const LINE_TYPE_META: Record<string, { label: string; chip: string }> = {
  mobile: { label: "mobile", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  landline: { label: "landline", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  voip: { label: "VoIP", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
};
