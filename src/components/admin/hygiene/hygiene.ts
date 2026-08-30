// Data Hygiene — shared types + helpers for the smart-list feature.
//
// Backend contract (migration 20260830_data_hygiene_smart_lists.sql):
//   • smart_lists         — a saved audience: name + criteria (the filter) + source store(s).
//   • smart_list_members  — materialized membership; polymorphic (source, source_id) into
//                           ph_ucc_leads / lead_records / customers, a denormalized snapshot,
//                           and the phone-validation write-back columns.
// Compliance: internal surface, but still never "loan" — MCA positions are advances/funding.

import supabase from "@/supabase";

/* A smart list draws from exactly one store in v1 ('mixed' is deferred). */
export type SmartListSource = "ph_ucc" | "lead_records" | "customers" | "mixed";

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
  { label: string; table: string; blurb: string; chip: string }
> = {
  ph_ucc: {
    label: "UCC leads",
    table: "ph_ucc_leads",
    blurb: "Merchants with an existing advance on file (the UCC Harvester book).",
    chip: "bg-ocean-blue/10 text-ocean-blue",
  },
  lead_records: {
    label: "Purchased lists",
    table: "lead_records",
    blurb: "Uploaded aged / UCC / trigger lists (the Lead Machine book).",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  customers: {
    label: "Customers (CRM)",
    table: "customers",
    blurb: "The CRM pipeline — leads through funded merchants.",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

/* The columns each source needs SELECTed to build a member snapshot. */
export const SNAPSHOT_SELECT: Record<Exclude<SmartListSource, "mixed">, string> = {
  ph_ucc: "id,debtor_name,person_name,phone,email,state,debtor_city",
  lead_records: "id,company,first_name,last_name,phone,email,state,city",
  customers: "id,business_name,first_name,last_name,phone,email",
};

function joinName(first: unknown, last: unknown): string | null {
  const s = `${first ?? ""} ${last ?? ""}`.trim();
  return s.length ? s : null;
}

/* Map one source row → the denormalized snapshot stored on the member. */
export function snapshotFromRow(
  source: Exclude<SmartListSource, "mixed">,
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
    state: null,
    city: null,
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
