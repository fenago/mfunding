// coldEmailStore — the I/O half of the cold-email wiring: settings, the
// verification-verdict adapter, and the bounce writer. One place, so the send side
// and the return side read and write the SAME storage.
//
// WHERE A VERDICT CAN LIVE (worst wins — see worstHealth):
//   1. customers.email_status          — EmailHealth vocabulary, set by
//      recordVerification / bounce detection for anyone already a merchant.
//   2. lead_records verification columns (phase-1 list agent) — the purchased-list
//      row the GHL contact came from. See LEAD_RECORDS_* below.
//   3. instantly_event_log             — a prior email_bounced / unsubscribe event for
//      this address is a SUPPRESSION regardless of what any verdict column says.
//
// A READ THAT FAILED IS NOT A READ THAT FOUND NOTHING (readers-must-distinguish-
// unreadable): every lookup returns `unreadable` reasons, and the enroll side treats
// an unreadable store as "do not enroll", never as "no verdict, go verify".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EmailHealth, VerifyResult } from "./instantly.ts";
import { SETTINGS_KEY, worstHealth } from "./coldEmail.ts";

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

// ── lead_records verification columns (phase-1 list agent) ─────────────────
// Kept as named constants so repointing the adapter is a one-line change. If the
// columns are not there yet the query errors with 42703; that is reported as
// "source absent", which is NOT the same as unreadable (the table simply has no
// verdict to offer) — and is logged so it is visible.
export const LEAD_RECORDS_STATUS_COL = "email_verify_status";
export const LEAD_RECORDS_CHECKED_COL = "email_verified_at";

export interface VerdictRead {
  health: EmailHealth | null;
  sources: string[];          // which stores contributed a verdict
  suppressed: boolean;
  suppressionReason: string | null;
  customerIds: string[];
  unreadable: string[];       // stores we could not read
  notes: string[];
}

export async function readVerdict(db: SupabaseClient, email: string, ghlContactId: string): Promise<VerdictRead> {
  const out: VerdictRead = { health: null, sources: [], suppressed: false, suppressionReason: null, customerIds: [], unreadable: [], notes: [] };
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

  // 2. lead_records (by email, and by the GHL contact the row was pushed as)
  {
    const sel = `id, ${LEAD_RECORDS_STATUS_COL}`;
    const { data, error } = await db.from("lead_records").select(sel).ilike("email", email).limit(20);
    if (error) {
      if ((error as { code?: string }).code === "42703") out.notes.push(`lead_records.${LEAD_RECORDS_STATUS_COL} not present yet — source skipped`);
      else out.unreadable.push(`lead_records: ${error.message}`);
    } else {
      for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const v = r[LEAD_RECORDS_STATUS_COL] as string | null;
        if (v) { verdicts.push(normaliseLeadVerdict(v)); out.sources.push(`lead_records.${LEAD_RECORDS_STATUS_COL}=${v}`); }
      }
    }
  }

  // 3. prior suppression events on the return side
  {
    const { data, error } = await db.from("instantly_event_log")
      .select("action, event_type, received_at")
      .eq("lead_email", email)
      .in("action", ["bounce", "unsubscribe"])
      .limit(1);
    if (error) out.unreadable.push(`instantly_event_log: ${error.message}`);
    else if (data && data.length) {
      out.suppressed = true;
      out.suppressionReason = `prior ${data[0].event_type} event (${data[0].received_at})`;
      if (data[0].action === "bounce") verdicts.push("bounced");
    }
  }

  void ghlContactId; // reserved: lead_records.ghl_contact_id join once phase 1 confirms it is populated
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

/** Store an on-the-fly verdict wherever this address lives. Never downgrades a
 *  proven bounce (recordVerification's rule, enforced here in SQL). */
export async function storeVerdict(db: SupabaseClient, email: string, r: VerifyResult): Promise<string[]> {
  const errors: string[] = [];
  if (r.health === "unknown") return errors; // "we couldn't tell" is not a verdict
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
  {
    const { error } = await db.from("lead_records").update({
      [LEAD_RECORDS_STATUS_COL]: r.health, [LEAD_RECORDS_CHECKED_COL]: now,
    }).ilike("email", email);
    if (error && (error as { code?: string }).code !== "42703") errors.push(`lead_records: ${error.message}`);
  }
  return errors;
}

/** A real send hard-bounced: proof, so it overrides every prediction. */
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
      [LEAD_RECORDS_STATUS_COL]: "bounced", [LEAD_RECORDS_CHECKED_COL]: now,
    }).ilike("email", email).select("id");
    if (error) {
      if ((error as { code?: string }).code === "42703") leadRecords = null; // column not there yet
      else errors.push(`lead_records: ${error.message}`);
    } else leadRecords = (data ?? []).length;
  }
  return { customers, leadRecords, errors };
}
