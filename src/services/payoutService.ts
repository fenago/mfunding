// Self-service payout writes for contractors (PH-based setters, closers, admins).
//
// SENSITIVE DATA: payout_profiles holds bank/e-wallet details. RLS restricts it
// to the owner (profile_id = auth.uid()) + super_admin. It is DELIBERATELY kept
// out of UserProfileContext / PROFILE_COLS — fetch it only on the My Profile
// page, on demand, for the signed-in (real) user, to limit exposure.
//
// The client upserts directly (no edge function). Writes go through mustWrite so
// RLS denials / zero-row writes surface loudly, consistent with profileService.

import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";

/** Columns a user is allowed to edit on their OWN payout_profiles row. */
export interface EditablePayoutFields {
  account_holder_name?: string | null;
  country?: string | null;
  currency?: string | null;
  preferred_method?: string | null;
  wise_email?: string | null;
  payoneer_email?: string | null;
  zelle_handle?: string | null;
  zelle_name?: string | null;
  gcash_number?: string | null;
  gcash_name?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_swift_bic?: string | null;
  bank_branch?: string | null;
  other_method_name?: string | null;
  other_method_details?: string | null;
  tax_country?: string | null;
  foreign_tax_id?: string | null;
  foreign_status_certified?: boolean | null;
  foreign_status_certified_at?: string | null;
  payout_notes?: string | null;
}

export interface PayoutProfile extends EditablePayoutFields {
  id: string;
  profile_id: string;
  created_at?: string | null;
  updated_at?: string | null;
}

// The single source of truth for what may be written. Anything not in this list
// (id, profile_id, timestamps, …) is dropped before the upsert runs.
const EDITABLE_KEYS: (keyof EditablePayoutFields)[] = [
  "account_holder_name",
  "country",
  "currency",
  "preferred_method",
  "wise_email",
  "payoneer_email",
  "zelle_handle",
  "zelle_name",
  "gcash_number",
  "gcash_name",
  "bank_name",
  "bank_account_name",
  "bank_account_number",
  "bank_swift_bic",
  "bank_branch",
  "other_method_name",
  "other_method_details",
  "tax_country",
  "foreign_tax_id",
  "payout_notes",
];

function nn(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Fetch the signed-in user's payout row. Returns null if never filled in. */
export async function getMyPayout(profileId: string): Promise<PayoutProfile | null> {
  if (!profileId) throw new Error("getMyPayout: missing profileId");
  const { data, error } = await supabase
    .from("payout_profiles")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as PayoutProfile | null) ?? null;
}

/**
 * Upsert the signed-in user's own payout row, keyed by profile_id. Writes only
 * whitelisted columns. When `foreign_status_certified` flips true and no
 * timestamp is stored yet, stamps `foreign_status_certified_at` client-side.
 * Returns the upserted row; throws (DbWriteError) if blocked by RLS.
 */
export async function upsertMyPayout(
  profileId: string,
  fields: EditablePayoutFields,
  existing?: PayoutProfile | null,
): Promise<PayoutProfile> {
  if (!profileId) throw new Error("upsertMyPayout: missing profileId");

  const payload: Record<string, string | boolean | null> = { profile_id: profileId };
  for (const key of EDITABLE_KEYS) {
    if (key in fields) payload[key] = nn(fields[key]);
  }

  // Certification is a boolean checkbox, handled separately from the string
  // whitelist so we can stamp the timestamp on the true-transition.
  if ("foreign_status_certified" in fields) {
    const certified = !!fields.foreign_status_certified;
    payload.foreign_status_certified = certified;
    const alreadyStamped = existing?.foreign_status_certified_at;
    const wasCertified = !!existing?.foreign_status_certified;
    if (certified && !wasCertified && !alreadyStamped) {
      payload.foreign_status_certified_at = new Date().toISOString();
    } else if (!certified) {
      // Un-certifying clears the stamp so it re-stamps on the next opt-in.
      payload.foreign_status_certified_at = null;
    }
  }

  const rows = await mustWrite<PayoutProfile>(
    "save payout details",
    supabase.from("payout_profiles").upsert(payload, { onConflict: "profile_id" }),
  );
  return rows[0];
}
