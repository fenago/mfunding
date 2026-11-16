// coldEmailStore — the I/O half of the cold-email wiring: settings, the
// verification-verdict adapter, and the bounce writer. One place, so the send side
// and the return side read and write the SAME storage.
//
// WHERE A VERDICT CAN LIVE (worst wins — see worstHealth):
//   1. customers.email_status          — EmailHealth vocabulary, set by
//      recordVerification / bounce detection for anyone already a merchant.
//   2. lead_records verification columns (phase-1 list agent) — the purchased-list
//      row the GHL contact came from (email_status / email_verify_error — phase-1
//      contract, see below).
//   3. instantly_event_log             — SUPPRESSION, regardless of any verdict column
//      (compliance ruling 2026-11-16, any campaign, re-checked at enroll time):
//        * this ADDRESS replied in any way / was labelled / unsubscribed / bounced
//          (suppressesAddress: everything except sent/opened/clicked/completed);
//        * this COMPANY triggered stop-for-company — a reply-class event or an
//          unsubscribe by anyone at the same business domain (consumer mail
//          providers excluded) or the same normalised company name.
//   GHL email DND is the fourth suppression; it costs a GHL call so the enroll
//   function checks it itself (see instantly-enroll).
//
// A READ THAT FAILED IS NOT A READ THAT FOUND NOTHING (readers-must-distinguish-
// unreadable): every lookup returns `unreadable` reasons, and the enroll side treats
// an unreadable store as "do not enroll", never as "no verdict, go verify".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EmailHealth, VerifyResult } from "./instantly.ts";
import { SETTINGS_KEY, companyDomain, normCompany, suppressesAddress, suppressesCompany, worstHealth } from "./coldEmail.ts";

export interface ColdEmailSettings {
  micro_bitty_campaign_id: string | null;
  enroll_test_campaign_id: string | null;
  campaign_record_id: string | null;
  reply_task_assignee_ghl_user_id: string | null;
  reply_first_call_sla_minutes: number;
}

export async function loadSettings(db: SupabaseClient): Promise<{ settings: ColdEmailSettings | null; error: string | null }> {
  const { data, error } = await db.from("platform_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  if (error) return { settings: null, error: `platform_settings read failed: ${error.message}` };
  if (!data) return { settings: null, error: `platform_settings.${SETTINGS_KEY} missing` };
  const v = (data.value ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  return {
    settings: {
      micro_bitty_campaign_id: s("micro_bitty_campaign_id"),
      enroll_test_campaign_id: s("enroll_test_campaign_id"),
      campaign_record_id: s("campaign_record_id"),
      reply_task_assignee_ghl_user_id: s("reply_task_assignee_ghl_user_id"),
      reply_first_call_sla_minutes: typeof v.reply_first_call_sla_minutes === "number" ? v.reply_first_call_sla_minutes : 5,
    },
    error: null,
  };
}

// ── lead_records verification storage (phase-1 contract, migration
// 20261116a_micro_bitty_segment): email_status (EmailHealth vocabulary) +
// email_verified_at + email_verify_error. NULL status = never verified.
// email_verify_error NOT NULL = the lookup failed → NOT a verdict → refuse.
// Verdicts are WRITTEN only through public.lead_record_record_verification().

/** "That column does not exist". A SELECT surfaces Postgres' 42703; an UPDATE is
 *  refused by PostgREST's schema cache as PGRST204. */
export function isMissingColumn(error: { code?: string } | null): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204");
}

/** The segment the pilot campaign enrolls from. */
export const PILOT_SEGMENT_SLUG = "micro-bitty";

export interface SegmentMember {
  id: string;
  lead_record_id: string;
  email: string;
  ghl_contact_id: string | null;
  industry_merge: string | null;
  enrolled_at: string | null;
  instantly_campaign_id: string | null;
}

/** Find the segment member this GHL contact / email is. Email first (the verdict
 *  is about an address), then the GHL contact id. */
export async function findSegmentMember(
  db: SupabaseClient, slug: string, email: string, contactId: string,
): Promise<{ member: SegmentMember | null; error: string | null }> {
  const cols = "id, lead_record_id, email, ghl_contact_id, industry_merge, enrolled_at, instantly_campaign_id";
  if (email) {
    const { data, error } = await db.from("campaign_segment_members").select(cols)
      .eq("campaign_slug", slug).eq("email", email.toLowerCase()).limit(1);
    if (error) return { member: null, error: `campaign_segment_members: ${error.message}` };
    if (data && data.length) return { member: data[0] as SegmentMember, error: null };
  }
  if (contactId) {
    const { data, error } = await db.from("campaign_segment_members").select(cols)
      .eq("campaign_slug", slug).eq("ghl_contact_id", contactId).limit(2);
    if (error) return { member: null, error: `campaign_segment_members: ${error.message}` };
    if (data && data.length === 1) return { member: data[0] as SegmentMember, error: null };
    if (data && data.length > 1) return { member: null, error: `GHL contact ${contactId} matches ${data.length} segment members — refusing to guess` };
  }
  return { member: null, error: null };
}

export async function stampEnrolled(db: SupabaseClient, memberId: string, campaignId: string): Promise<string | null> {
  const { error } = await db.from("campaign_segment_members")
    .update({ enrolled_at: new Date().toISOString(), instantly_campaign_id: campaignId })
    .eq("id", memberId);
  return error ? error.message : null;
}

export interface VerdictRead {
  health: EmailHealth | null;
  sources: string[];          // which stores contributed a verdict
  suppressed: boolean;
  suppressionReason: string | null;
  customerIds: string[];
  leadRecordIds: string[];    // lead_records rows for this address (verified or not)
  unreadable: string[];       // stores we could not read
  notes: string[];
}

export async function readVerdict(
  db: SupabaseClient, email: string, ghlContactId: string, companyName = "",
  opts: { leadRecordId?: string | null } = {},
): Promise<VerdictRead> {
  const out: VerdictRead = { health: null, sources: [], suppressed: false, suppressionReason: null, customerIds: [], leadRecordIds: [], unreadable: [], notes: [] };
  const verdicts: Array<string | null> = [];

  // 1. customers
  {
    const { data, error } = await db.from("customers")
      .select("id, email_status, do_not_contact")
      .ilike("email", email);
    if (error) out.unreadable.push(`customers: ${error.message}`);
    else {
      for (const c of data ?? []) {
        out.customerIds.push(c.id as string);
        if (c.email_status) { verdicts.push(c.email_status as string); out.sources.push(`customers.email_status=${c.email_status}`); }
        if (c.do_not_contact) { out.suppressed = true; out.suppressionReason = `customer ${c.id} is do_not_contact`; }
      }
    }
  }

  // 2. lead_records — by lower(email), plus the pinned segment row when given.
  {
    type LR = { id: string; email: string | null; email_status: string | null; email_verify_error: string | null };
    const cols = "id, email, email_status, email_verify_error";
    const byEmail = await db.from("lead_records").select(cols).ilike("email", email).limit(20);
    let rows: LR[] = (byEmail.data ?? []) as LR[];
    let error = byEmail.error;
    // Two queries rather than a PostgREST .or(): an address can contain characters
    // (",", "()") that would break the or-filter grammar.
    if (!error && opts.leadRecordId && !rows.some((r) => r.id === opts.leadRecordId)) {
      const pinned = await db.from("lead_records").select(cols).eq("id", opts.leadRecordId).limit(1);
      error = pinned.error;
      rows = rows.concat((pinned.data ?? []) as LR[]);
    }
    if (error) out.unreadable.push(`lead_records: ${error.message}`);
    else {
      for (const r of rows) {
        // A verdict is about ONE address: the pinned row must still carry it.
        if (opts.leadRecordId && r.id === opts.leadRecordId && String(r.email ?? "").toLowerCase() !== email) {
          out.unreadable.push(`lead_records ${r.id} email changed since the segment was built — its verdict is not about ${email}`);
          continue;
        }
        if (r.email_verify_error) {
          out.unreadable.push(`lead_records ${r.id}: last lookup failed (${r.email_verify_error}) — not a verdict`);
          continue;
        }
        if (r.email_status) {
          verdicts.push(r.email_status);
          out.sources.push(`lead_records.email_status=${r.email_status}`);
          out.leadRecordIds.push(r.id);
        } else out.leadRecordIds.push(r.id); // known row, never verified
      }
    }
  }

  // 3. engagement / stop-for-company history on the return side
  {
    type Ev = { event_type: string | null; received_at: string; lead_email: string | null };
    const take = (rows: Ev[] | null, rule: (t: string | null) => boolean) => (rows ?? []).filter((r) => rule(r.event_type));
    const cols = "event_type, received_at, lead_email";

    const own = await db.from("instantly_event_log").select(cols).eq("lead_email", email).order("received_at", { ascending: false }).limit(50);
    if (own.error) out.unreadable.push(`instantly_event_log(address): ${own.error.message}`);
    else {
      const hits = take(own.data as Ev[], suppressesAddress);
      if (hits.some((h) => h.event_type === "email_bounced")) verdicts.push("bounced");
      if (hits.length) {
        out.suppressed = true;
        out.suppressionReason = `address had ${hits[0].event_type} (${hits[0].received_at})`;
      }
    }

    const domain = companyDomain(email);
    if (!out.suppressed && domain) {
      const r = await db.from("instantly_event_log").select(cols).eq("lead_domain", domain).neq("lead_email", email).limit(50);
      if (r.error) out.unreadable.push(`instantly_event_log(domain): ${r.error.message}`);
      else {
        const hits = take(r.data as Ev[], suppressesCompany);
        if (hits.length) {
          out.suppressed = true;
          out.suppressionReason = `stop-for-company: ${hits[0].lead_email} at ${domain} had ${hits[0].event_type} (${hits[0].received_at})`;
        }
      }
    }

    const company = normCompany(companyName);
    if (!out.suppressed && company) {
      const r = await db.from("instantly_event_log").select(cols).eq("company_norm", company).neq("lead_email", email).limit(50);
      if (r.error) out.unreadable.push(`instantly_event_log(company): ${r.error.message}`);
      else {
        const hits = take(r.data as Ev[], suppressesCompany);
        if (hits.length) {
          out.suppressed = true;
          out.suppressionReason = `stop-for-company: "${companyName}" — ${hits[0].lead_email} had ${hits[0].event_type} (${hits[0].received_at})`;
        }
      }
    }
  }

  void ghlContactId; // membership (and its ghl_contact_id) is resolved by findSegmentMember
  out.health = worstHealth(verdicts);
  return out;
}

/** Map whatever vocabulary lead_records uses onto EmailHealth. Instantly's raw
 *  words ("valid", "accept_all") are folded in so either convention works. */
export function normaliseLeadVerdict(v: string): EmailHealth {
  const s = v.trim().toLowerCase();
  if (s === "valid" || s === "verified" || s === "deliverable") return "verified";
  if (s === "invalid" || s === "undeliverable") return "invalid";
  if (s === "bounced" || s === "hard_bounce") return "bounced";
  if (s === "catch_all" || s === "accept_all" || s === "catchall") return "catch_all";
  if (s === "risky") return "risky";
  return "unknown";
}

/** Store an on-the-fly verdict wherever this address lives. Refusals (no
 *  credits / rate limit) and unresolved lookups are NOT verdicts and are never
 *  written — overwriting a real verdict with "unknown" would erase evidence.
 *  lead_records goes ONLY through lead_record_record_verification (phase-1
 *  contract), which itself never downgrades a proven bounce. */
export async function storeVerdict(db: SupabaseClient, email: string, r: VerifyResult, leadRecordIds: string[]): Promise<string[]> {
  const errors: string[] = [];
  if (r.rateLimited || r.unavailable || r.health === "unknown") return errors;
  const now = new Date().toISOString();
  {
    const { error } = await db.from("customers").update({
      email_status: r.health,
      email_verified_at: now,
      email_checked_at: now,
      email_bounce_reason: r.health === "invalid" ? `Instantly: the mailbox does not exist (${r.raw ?? "invalid"})` : null,
    }).ilike("email", email).or("email_status.is.null,email_status.neq.bounced");
    if (error) errors.push(`customers: ${error.message}`);
  }
  for (const id of [...new Set(leadRecordIds)]) {
    const { data, error } = await db.rpc("lead_record_record_verification", {
      p_lead_record_id: id, p_email: email, p_health: r.health, p_raw: r.raw, p_catch_all: r.catchAll, p_error: null,
    });
    if (error) errors.push(`lead_record_record_verification(${id}): ${error.message}`);
    else if (data !== "written" && data !== "kept_bounce") errors.push(`lead_record_record_verification(${id}) → ${data}`);
  }
  return errors;
}

/** A real send hard-bounced: proof, so it overrides every prediction.
 *  lead_record_record_verification deliberately rejects "bounced" (it records
 *  VERIFICATIONS); a bounce is delivery evidence, so it is written directly —
 *  the same way customers.email_status gets it. */
export async function markBounced(db: SupabaseClient, email: string, reason: string): Promise<{ customers: number; leadRecords: number | null; errors: string[] }> {
  const errors: string[] = [];
  const now = new Date().toISOString();
  let customers = 0;
  let leadRecords: number | null = 0;
  {
    const { data, error } = await db.from("customers").update({
      email_status: "bounced", email_checked_at: now, email_bounce_reason: reason,
    }).ilike("email", email).select("id");
    if (error) errors.push(`customers: ${error.message}`); else customers = (data ?? []).length;
  }
  {
    const { data, error } = await db.from("lead_records").update({
      email_status: "bounced", email_checked_at: now, email_bounce_reason: reason, email_verify_error: null,
    }).ilike("email", email).select("id");
    if (error) {
      if (isMissingColumn(error as { code?: string })) leadRecords = null;
      else errors.push(`lead_records: ${error.message}`);
    } else leadRecords = (data ?? []).length;
  }
  return { customers, leadRecords, errors };
}
