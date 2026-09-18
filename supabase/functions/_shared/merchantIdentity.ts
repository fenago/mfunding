// merchantIdentity — ONE answer to "who is this merchant inside GHL?", used by
// the WRITE side and the READ side alike.
//
// WHY THIS FILE EXISTS (Miami Concierge Network LLC / MF-2026-0385, 2026-09-18)
// The merchant signed two disclosures. The app said "Nothing sent yet" while the
// owner had him on the phone. Nothing had thrown an error anywhere:
//
//   writes resolved the merchant by UPSERTING AN EMAIL       -> whichever contact
//                                                                owns that address
//   reads  resolved the merchant by ONE STORED CONTACT ID    -> the other one
//
// GHL held three contacts for that one company. push-application-to-ghl sends to
// the APPLICATION's email (business_email) and re-points the stored id at its
// contact; send-merchant-email pre-flights against CUSTOMERS.EMAIL and re-points
// it back. Two writers, two email columns, one single-valued pointer — they took
// turns, and whoever moved last decided what the readers could see. Every
// document had landed on the contact nobody was asking about.
//
// So a merchant is a SET of contact ids, never one id, and:
//
//   * reads must union across the whole set,
//   * a read that could not determine the set is UNREADABLE, which is a
//     different answer from "searched and found nothing" (see MerchantIdentity
//     .readable / .unreadableReason — rendering the first as the second is the
//     sentence that burned the owner today), and
//   * a write that resolves a contact outside the set RECORDS it rather than
//     clobbering the primary pointer with it.
//
// Nothing here merges or deletes a GHL contact. Deduplicating a merchant's CRM
// records is the owner's call; our job is to be resilient to the duplication and
// to SAY when it exists.
//
// COST NOTE (ghl-standing-consumers-ledger): the DB half is free. The GHL half
// (discoverGhlContacts) costs one /contacts/search per identifier and is
// therefore opt-in, capped, and re-runs at most once per DISCOVERY_TTL per
// merchant. The document READ path deliberately needs none of it: document
// recipients carry their own email, so matching by email works off the crawl the
// caller already paid for.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type GhlConfig, searchContacts } from "./ghl.ts";

/** Don't re-ask GHL about the same merchant more often than this. */
export const DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000;
/** Hard cap on identifiers we will pay a GHL search for, per merchant. */
const MAX_DISCOVERY_LOOKUPS = 6;

export interface MerchantIdentity {
  customerId: string | null;
  businessName: string | null;
  /** The id our tables point at by default. May be any member of contactIds. */
  primaryContactId: string | null;
  /** EVERY GHL contact id known for this merchant. Reads union across all. */
  contactIds: string[];
  /** Lower-cased: customers.email + additional_emails + the application's emails. */
  emails: string[];
  /** Last-10 digits: customers.phone + additional_phones. */
  phones: string[];
  /** When we last asked GHL for contacts carrying these identifiers (null = never). */
  contactsSyncedAt: string | null;
  /**
   * FALSE means there was NOTHING TO SEARCH — no contact id at all, or the DB
   * read that would have produced the set failed. A caller MUST NOT report
   * "nothing found" on a false: it found nothing to look IN, which is a
   * different sentence and the one that had to be said today.
   */
  readable: boolean;
  unreadableReason: string | null;
  /**
   * TRUE when we are searching a NARROWER set than the merchant's real identity —
   * we have a contact id but could not tie it to exactly one merchant (unknown
   * contact, or a contact shared by two customers). Documents still render;
   * absence just isn't proof, and no readability stamp may be written.
   *
   * Deliberately NOT folded into `readable`: an ambiguous merchant used to render
   * their documents fine, and turning that into an error would hide real
   * signatures to fix a labelling problem.
   */
  partial: boolean;
  /** Human-readable reason for `partial`. */
  scopeNote: string | null;
}

export const EMPTY_IDENTITY: MerchantIdentity = {
  customerId: null, businessName: null, primaryContactId: null,
  contactIds: [], emails: [], phones: [],
  contactsSyncedAt: null, readable: false, unreadableReason: "identity not resolved",
  partial: false, scopeNote: null,
};

/** We hold one contact id and nothing else. Searchable, but narrower than the
 *  merchant — so `partial`, never a silent full-confidence answer. */
function contactOnly(contactId: string, why: string): MerchantIdentity {
  return {
    ...EMPTY_IDENTITY,
    primaryContactId: contactId,
    contactIds: [contactId],
    readable: true,
    unreadableReason: null,
    partial: true,
    scopeNote: why,
  };
}

/** Last 10 digits — the only comparison under which +1 305-298-4193 and
 *  3052984193 are the same number. Mirrors public.phone_last10(). */
export function phoneLast10(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Resolve the merchant behind a customer id, a deal id, or a GHL contact id.
 *
 * DB-only: no GHL calls, so it is free to call on any path. The returned
 * identity is authoritative about what WE know; call discoverGhlContacts() when
 * you also need to know what GHL knows.
 */
export async function loadMerchantIdentity(
  db: SupabaseClient,
  ref: { customerId?: string | null; dealId?: string | null; contactId?: string | null },
): Promise<MerchantIdentity> {
  let customerId = ref.customerId ?? null;

  if (!customerId && ref.dealId) {
    const { data, error } = await db.from("deals").select("customer_id").eq("id", ref.dealId).maybeSingle();
    if (error) {
      return { ...EMPTY_IDENTITY, unreadableReason: `deal lookup failed: ${error.message}` };
    }
    customerId = (data?.customer_id as string | null) ?? null;
  }

  // A bare contact id: it may be a merchant's PRIMARY pointer, or an alias we
  // recorded earlier, or a deal-level pointer that the customer row lost.
  if (!customerId && ref.contactId) {
    const { data, error } = await db.rpc("customer_ids_for_ghl", {
      p_contact_ids: [ref.contactId],
      p_emails: [],
    });
    if (error) {
      return { ...EMPTY_IDENTITY, unreadableReason: `contact lookup failed: ${error.message}` };
    }
    const rows = (data ?? []) as Array<{ customer_id: string }>;
    const distinct = [...new Set(rows.map((r) => r.customer_id))];
    if (distinct.length === 1) customerId = distinct[0];
    else if (distinct.length > 1) {
      // Two merchants on one contact id (one owner, several businesses). Refusing
      // to guess is the point — a guess here attaches a document to the wrong
      // file. We can still search THIS contact, so the documents render; what we
      // must not do is claim the search covered the merchant.
      return contactOnly(
        ref.contactId,
        `GHL contact ${ref.contactId} maps to ${distinct.length} merchants — only that one contact was searched`,
      );
    }
  }

  if (!customerId) {
    if (!ref.contactId) {
      return { ...EMPTY_IDENTITY, unreadableReason: "no customer, deal or contact id given" };
    }
    // A contact GHL knows and we do not. Searchable, but we cannot union across
    // the merchant's other contacts because we don't know who they are.
    return contactOnly(
      ref.contactId,
      `no merchant on file for GHL contact ${ref.contactId} — only that one contact was searched`,
    );
  }

  const { data, error } = await db.rpc("merchant_ghl_identity", { p_customer_id: customerId });
  if (error || !data) {
    return {
      ...EMPTY_IDENTITY,
      customerId,
      unreadableReason: `merchant_ghl_identity failed: ${error?.message ?? "no row"}`,
    };
  }
  const d = data as {
    customer_id: string; business_name: string | null; primary_contact_id: string | null;
    contact_ids: string[]; emails: string[]; phones: string[]; contacts_synced_at: string | null;
  };

  // The caller's own contact id counts as known even if our tables have lost it —
  // otherwise a read triggered from a stale link would search one id fewer.
  const ids = new Set((d.contact_ids ?? []).filter(Boolean));
  if (ref.contactId) ids.add(ref.contactId);

  return {
    customerId: d.customer_id,
    businessName: d.business_name ?? null,
    primaryContactId: d.primary_contact_id ?? ref.contactId ?? null,
    contactIds: [...ids],
    emails: (d.emails ?? []).filter(Boolean).map(lower),
    phones: (d.phones ?? []).filter(Boolean),
    contactsSyncedAt: d.contacts_synced_at ?? null,
    readable: true,
    unreadableReason: null,
    partial: false,
    scopeNote: null,
  };
}

export interface DiscoveredContact {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  /** Which of our identifiers found it. */
  via: string;
}

export interface DiscoveryResult {
  contacts: DiscoveredContact[];
  /** Ids that were NOT already in identity.contactIds. */
  newIds: string[];
  /** GHL calls spent. */
  calls: number;
  /** FALSE when a lookup failed — the set below is a floor, not the whole truth. */
  complete: boolean;
  error: string | null;
  /** True when TTL/caps meant we deliberately did not look. */
  skipped: boolean;
}

/**
 * Ask GHL which contacts carry this merchant's emails/phones. This is what finds
 * the duplicate BEFORE a send lands on it (and what recovers a contact id that a
 * clobbering writer overwrote before the identity set existed).
 *
 * Costs one /contacts/search per identifier, capped at MAX_DISCOVERY_LOOKUPS and
 * rate-limited per merchant by DISCOVERY_TTL_MS — so it scales with NEW merchants,
 * not with the size of the book (ghl-standing-consumers-ledger).
 */
export async function discoverGhlContacts(
  cfg: GhlConfig,
  identity: MerchantIdentity,
  opts: { force?: boolean } = {},
): Promise<DiscoveryResult> {
  const out: DiscoveryResult = { contacts: [], newIds: [], calls: 0, complete: false, error: null, skipped: false };
  if (!identity.readable) {
    out.error = identity.unreadableReason ?? "identity unreadable";
    return out;
  }

  if (!opts.force && identity.contactsSyncedAt) {
    const age = Date.now() - Date.parse(identity.contactsSyncedAt);
    if (Number.isFinite(age) && age < DISCOVERY_TTL_MS) {
      out.skipped = true;
      out.complete = true; // a recent complete pass stands
      return out;
    }
  }

  const terms: Array<{ q: string; via: string }> = [
    ...identity.emails.map((e) => ({ q: e, via: `email:${e}` })),
    ...identity.phones.map((p) => ({ q: p, via: `phone:${p}` })),
  ].slice(0, MAX_DISCOVERY_LOOKUPS);
  if (terms.length === 0) {
    out.complete = true;
    return out;
  }

  const seen = new Map<string, DiscoveredContact>();
  let failed = false;
  for (const t of terms) {
    const res = await searchContacts(cfg, { query: t.q, pageLimit: 20 });
    out.calls++;
    if (!res.ok) {
      // UNREADABLE for this identifier. Keep what the other terms found — a
      // contact we can see is still worth knowing — but the set is not complete,
      // so no caller may treat its absence as proof.
      failed = true;
      out.error = `contact search for ${t.via} failed (${res.status}): ${res.error ?? ""}`;
      continue;
    }
    for (const c of (res.data?.contacts ?? []) as Array<Record<string, unknown>>) {
      const id = String(c.id ?? "");
      if (!id) continue;
      // GHL's `query` is a fuzzy match across several fields, so confirm the hit
      // actually carries one of OUR identifiers before claiming it as this
      // merchant. Without this, a common surname quietly adopts strangers.
      const email = lower(c.email);
      const phone = phoneLast10(c.phone);
      const isOurs =
        (email !== "" && identity.emails.includes(email)) ||
        (phone !== null && identity.phones.includes(phone));
      if (!isOurs) continue;
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          email: email || null,
          phone: phone,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null,
          via: t.via,
        });
      }
    }
  }

  out.contacts = [...seen.values()];
  const known = new Set(identity.contactIds);
  out.newIds = out.contacts.map((c) => c.id).filter((id) => !known.has(id));
  out.complete = !failed;
  return out;
}

/**
 * Persist contact ids a send (or a discovery pass) resolved, WITHOUT touching the
 * primary pointer. Clobbering the primary is how the two pointers diverged in the
 * first place, so this only ever appends.
 *
 * Returns the ids that were genuinely new, so a caller can announce the
 * duplication rather than absorb it silently.
 */
export async function recordMerchantContacts(
  db: SupabaseClient,
  customerId: string | null,
  contactIds: Array<string | null | undefined>,
  opts: { markSynced?: boolean } = {},
): Promise<{ added: string[]; error: string | null }> {
  if (!customerId) return { added: [], error: null };
  const wanted = [...new Set(contactIds.filter((v): v is string => !!v && v.trim() !== ""))];

  const { data: before, error: readErr } = await db
    .from("customers").select("ghl_contact_ids").eq("id", customerId).maybeSingle();
  if (readErr) return { added: [], error: readErr.message };
  const had = new Set(((before?.ghl_contact_ids as string[] | null) ?? []));
  const added = wanted.filter((id) => !had.has(id));

  for (const id of added) {
    const { error } = await db.rpc("customer_add_ghl_contact", {
      p_customer_id: customerId, p_contact_id: id,
    });
    if (error) return { added: [], error: error.message };
  }
  if (opts.markSynced) {
    const { error } = await db
      .from("customers")
      .update({ ghl_contacts_synced_at: new Date().toISOString() })
      .eq("id", customerId);
    if (error) console.warn("[merchantIdentity] sync stamp failed:", error.message);
  }
  return { added, error: null };
}

/**
 * Does this GHL document recipient belong to this merchant?
 *
 * ⚠ THE RECIPIENT'S CONTACT ID IS `recipients[].id` (with entityName ==
 * "contacts"). There is NO `recipients[].contactId` — reading that field gets you
 * `undefined` and a document that matches nobody.
 *
 * Matching on the recipient's EMAIL as well as its id is what makes this work
 * with zero extra GHL calls: the location-wide document crawl the caller already
 * paid for prints each recipient's email, so a document filed against a contact
 * our tables have never heard of is still recognisably this merchant's.
 */
export function recipientMatchesMerchant(
  recipient: { id?: string; entityName?: string; email?: string } | null | undefined,
  identity: MerchantIdentity,
): boolean {
  if (!recipient) return false;
  if (recipient.entityName && recipient.entityName !== "contacts") return false;
  if (recipient.id && identity.contactIds.includes(recipient.id)) return true;
  const email = lower(recipient.email);
  return email !== "" && identity.emails.includes(email);
}

/** How a surface should describe the merchant's GHL contacts to a human. */
export function describeContacts(identity: MerchantIdentity): string | null {
  const n = identity.contactIds.length;
  if (!identity.readable) return null;
  if (n <= 1) return null;
  return `${n} GHL contacts for this merchant — documents may be filed against any of them.`;
}
