// Self-service profile writes for staff (closers, setters, admins).
//
// RLS lets a user UPDATE their own profiles row ("Users can update own
// profile", auth.uid() = id). A BEFORE UPDATE trigger blocks changing your own
// role, and the auth identity (email) must never be edited here — so this
// service writes ONLY a fixed whitelist of self-editable columns and never
// touches `role` or `email`.

import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";

/** Columns a user is allowed to edit on their OWN profile. */
export interface EditableProfileFields {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone_number?: string | null;
  date_of_birth?: string | null;
  bio?: string | null;
  timezone?: string | null;
  preferred_language?: string | null;
  avatar_url?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  location?: string | null;
  company_name?: string | null;
  business_address?: string | null;
  company_phone?: string | null;
  ein?: string | null;
}

// The single source of truth for what may be written. Anything not in this list
// (role, email, id, timestamps, …) is dropped before the update runs.
const EDITABLE_KEYS: (keyof EditableProfileFields)[] = [
  "first_name",
  "last_name",
  "display_name",
  "phone_number",
  "date_of_birth",
  "bio",
  "timezone",
  "preferred_language",
  "avatar_url",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "location",
  "company_name",
  "business_address",
  "company_phone",
  "ein",
];

function nn(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Update the signed-in user's own profile. Writes only whitelisted columns;
 * never `role` or `email`. Sets `profile_completed = true` once first name,
 * last name and personal phone are all present. Returns the updated row; throws
 * (DbWriteError) if the write is blocked or matches no row.
 */
export async function updateMyProfile(
  userId: string,
  fields: EditableProfileFields,
): Promise<Record<string, unknown>> {
  if (!userId) throw new Error("updateMyProfile: missing userId");

  // Build a clean payload from the whitelist only. Empty strings normalize to
  // null so we don't store blank text.
  const payload: Record<string, string | boolean | null> = {};
  for (const key of EDITABLE_KEYS) {
    if (key in fields) payload[key] = nn(fields[key]);
  }

  // Derive profile_completed from the required trio. Only ever set it true here
  // (never flip a previously-complete profile back to false on a partial save).
  const done =
    !!payload.first_name && !!payload.last_name && !!payload.phone_number;
  if (done) payload.profile_completed = true;

  const rows = await mustWrite(
    "update my profile",
    supabase.from("profiles").update(payload).eq("id", userId),
  );
  return rows[0] as Record<string, unknown>;
}
