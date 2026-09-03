// Shared GHL call → deal mirror, extracted for the PUSH path (ghl-event-hook).
//
// ── READ THIS BEFORE EDITING ────────────────────────────────────────────────
// This is a FAITHFUL COPY of the two internal helpers inside
// `supabase/functions/ghl-call-history/index.ts` (fetchContactCalls +
// syncCallsForDeal). Editing this file does NOT change the running sweep, and
// editing the sweep does NOT change this. They were duplicated on purpose: the
// event hook had to ship without touching a cron that runs every 5 minutes
// against a live dial floor. The follow-up is to point ghl-call-history at this
// module and delete its private copies — until then, ANY change to the write
// shape must be made in BOTH files or the two paths will drift.
//
// What must never drift, because it is the anti-duplication contract:
//   • ghl_call_log, PK = GHL message id, upsert(ignoreDuplicates) — the
//     record-once ledger. A call already logged by the sweep can never be
//     logged again by the hook, and vice versa.
//   • one activity_log row per NEWLY-seen outbound call, same subject string.
//   • ghl_apply_call_telemetry() for the batch (monotonic: least/greatest/
//     coalesce), so a partial batch can never move a timestamp backwards or
//     double-count an attempt.
//
// The ONE intentional difference: the activity_log content JSON carries an
// extra `via` key naming the path that wrote it ("ghl-event-hook" vs the
// sweep's absent key). `source` stays "ghl-call-history" so anything reading
// the timeline sees identical rows; `via` exists only so we can prove push
// events are doing the work before the sweep cadence is cut.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ghlFetch, type GhlConfig } from "./ghl.ts";

interface GhlMessage {
  id: string;
  direction?: string;
  status?: string;
  dateAdded?: string;
  userId?: string;
  from?: string;
  to?: string;
  messageType?: string;
  meta?: { call?: { duration?: number | null; status?: string | null } };
}

export interface CallRecord {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  durationSeconds: number | null;
  calledAt: string;
  userId: string | null;
  userName: string | null;
  from: string | null;
  to: string | null;
}

// Kept in lockstep with ghl-call-history and the comment on
// ghl_apply_call_telemetry() in 20260714_ghl_call_log.sql.
const CONTACT_MIN_SECONDS = 30;
const SPOKE_MIN_SECONDS = 120;
const answered = (c: CallRecord) =>
  c.status === "completed" && (c.durationSeconds ?? 0) >= CONTACT_MIN_SECONDS;
const spokeCall = (c: CallRecord) =>
  c.status === "completed" && (c.durationSeconds ?? 0) >= SPOKE_MIN_SECONDS;

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return "0s";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

function outcomeLabel(c: CallRecord): string {
  if (c.status === "completed") return answered(c) ? "answered" : "connected briefly";
  if (c.status === "voicemail") return "voicemail";
  if (c.status === "no-answer") return "no answer";
  if (c.status === "busy") return "busy";
  return c.status || "unknown";
}

export interface FetchCallsOptions {
  /** Conversation ids the caller already resolved (saves a search call). */
  conversationIds: string[];
  /** Messages pulled per conversation. The hook fires per-event, so the newest
   * handful is always enough — the sweep's 100 exists to backfill a cold start. */
  messagesPerConversation?: number;
  /** Distinct GHL users we will resolve names for. A single contact's recent
   * calls realistically involve one or two reps; the cap stops a pathological
   * thread from turning one webhook into dozens of /users calls. */
  maxUserLookups?: number;
  /** Ignore calls older than this (ms). Null = no window. */
  sinceMs?: number | null;
}

/** Calls on the given conversations, newest first. Mirrors the sweep's parse
 * exactly (TYPE_CALL messages, meta.call for status/duration). `ghlCalls`
 * counts the GHL requests actually spent so the caller can log real cost. */
export async function fetchContactCalls(
  cfg: GhlConfig,
  opts: FetchCallsOptions,
): Promise<{ calls: CallRecord[]; ghlCalls: number }> {
  const msgLimit = opts.messagesPerConversation ?? 20;
  const maxUsers = opts.maxUserLookups ?? 3;
  let ghlCalls = 0;

  const calls: CallRecord[] = [];
  const userIds = new Set<string>();
  for (const convId of opts.conversationIds) {
    const msgRes = await ghlFetch<{ messages?: { messages?: GhlMessage[] } }>(
      cfg, "GET", `/conversations/${convId}/messages?limit=${msgLimit}`,
    );
    ghlCalls++;
    if (!msgRes.ok) continue; // one bad thread must not blank the event
    for (const m of msgRes.data?.messages?.messages ?? []) {
      if (m.messageType !== "TYPE_CALL" || !m.id || !m.dateAdded) continue;
      if (opts.sinceMs != null && Date.parse(m.dateAdded) < opts.sinceMs) continue;
      const call = m.meta?.call ?? {};
      const rec: CallRecord = {
        id: m.id,
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        status: String(call.status ?? m.status ?? "unknown"),
        durationSeconds: typeof call.duration === "number" ? call.duration : null,
        calledAt: m.dateAdded,
        userId: m.userId ?? null,
        userName: null,
        from: m.from ?? null,
        to: m.to ?? null,
      };
      calls.push(rec);
      if (rec.userId) userIds.add(rec.userId);
    }
  }

  const names = new Map<string, string>();
  for (const uid of [...userIds].slice(0, maxUsers)) {
    try {
      const u = await ghlFetch<{ name?: string; firstName?: string; lastName?: string }>(
        cfg, "GET", `/users/${uid}`,
      );
      ghlCalls++;
      const n = u.data?.name ?? [u.data?.firstName, u.data?.lastName].filter(Boolean).join(" ");
      if (u.ok && n) names.set(uid, n);
    } catch { /* name stays null — the record still logs */ }
  }
  for (const c of calls) if (c.userId) c.userName = names.get(c.userId) ?? null;

  calls.sort((a, b) => b.calledAt.localeCompare(a.calledAt));
  return { calls, ghlCalls };
}

export interface CallSyncResult {
  /** Newly-seen OUTBOUND calls that got a ledger row + timeline note. */
  synced: number;
  /** Known calls whose status/duration GHL finalized after we first saw them. */
  refreshed: number;
  /** Inbound calls mirrored record-only (no telemetry, no timeline note). */
  inboundRecorded: number;
  syncError: string | null;
}

/**
 * Reflect a contact's calls into its deal. Byte-for-byte the same writes as
 * ghl-call-history's syncCallsForDeal, so an event-driven mirror and a swept
 * mirror produce identical rows and the ledger PK makes them mutually exclusive.
 *
 * `via` is stamped into the activity_log content JSON only (see file header).
 */
export async function syncCallsForDeal(
  db: SupabaseClient,
  dealId: string,
  contactId: string,
  calls: CallRecord[],
  via: string,
): Promise<CallSyncResult> {
  const out: CallSyncResult = { synced: 0, refreshed: 0, inboundRecorded: 0, syncError: null };
  try {
    const outbound = calls.filter((c) => c.direction === "outbound");
    const fresh: CallRecord[] = [];
    for (const c of outbound) {
      const { data: ins, error: insErr } = await db.from("ghl_call_log").upsert({
        ghl_message_id: c.id,
        deal_id: dealId,
        ghl_contact_id: contactId,
        direction: c.direction,
        call_status: c.status,
        duration_seconds: c.durationSeconds,
        ghl_user_id: c.userId,
        ghl_user_name: c.userName,
        from_number: c.from,
        to_number: c.to,
        called_at: c.calledAt,
      }, { onConflict: "ghl_message_id", ignoreDuplicates: true }).select("ghl_message_id");
      if (insErr) { out.syncError = `ledger upsert failed: ${insErr.message}`; continue; }
      if (ins && ins.length > 0) { fresh.push(c); continue; }

      // LATE FINALIZATION. GHL writes the record at ring time
      // ({status:"ringing", duration:null}) and settles it after hangup. The
      // record-once ledger would otherwise freeze that first look forever, so a
      // known call whose status or duration has since changed is updated in
      // place — and if the finalized call crosses a bar, the deal is stamped
      // (only-if-null; an earlier real conversation always wins).
      const { data: known } = await db.from("ghl_call_log")
        .select("ghl_message_id, duration_seconds, call_status")
        .eq("ghl_message_id", c.id).maybeSingle();
      if (known && (
        (c.durationSeconds != null && known.duration_seconds == null) ||
        (c.status && c.status !== known.call_status)
      )) {
        const { error: updErr } = await db.from("ghl_call_log")
          .update({ duration_seconds: c.durationSeconds ?? known.duration_seconds, call_status: c.status })
          .eq("ghl_message_id", c.id);
        if (updErr) { out.syncError = `ledger refresh failed: ${updErr.message}`; continue; }
        out.refreshed++;
        if (answered(c)) {
          await db.from("deals").update({ contacted_at: c.calledAt })
            .eq("id", dealId).is("contacted_at", null);
        }
        if (spokeCall(c)) {
          await db.from("deals").update({ spoke_at: c.calledAt })
            .eq("id", dealId).is("spoke_at", null);
        }
      }
    }

    if (fresh.length > 0) {
      for (const c of fresh) {
        const { error: logErr } = await db.from("activity_log").insert({
          entity_type: "deal",
          entity_id: dealId,
          interaction_type: "call",
          subject: `GHL call: outbound, ${fmtDuration(c.durationSeconds)}, ${outcomeLabel(c)}${c.userName ? ` — by ${c.userName}` : ""}`,
          content: JSON.stringify({
            source: "ghl-call-history", via, ghl_message_id: c.id, status: c.status,
            duration_seconds: c.durationSeconds, called_at: c.calledAt,
            user: c.userName, from: c.from, to: c.to,
          }),
        });
        // activity_log has CHECK constraints on entity_type/interaction_type and a
        // failed insert is otherwise silent — never let a timeline note vanish quietly.
        if (logErr) console.error("[ghlCallSync] activity_log insert failed:", logErr.message);
      }
      const times = fresh.map((c) => c.calledAt).sort();
      const contactedTs = fresh.filter(answered).map((c) => c.calledAt).sort()[0] ?? null;
      const spokeTs = fresh.filter(spokeCall).map((c) => c.calledAt).sort()[0] ?? null;
      const { error: rpcErr } = await db.rpc("ghl_apply_call_telemetry", {
        p_deal_id: dealId,
        p_first_at: times[0],
        p_last_at: times[times.length - 1],
        p_new_attempts: fresh.length,
        p_contacted_at: contactedTs,
        p_spoke_at: spokeTs,
      });
      if (rpcErr) out.syncError = `telemetry stamp failed: ${rpcErr.message}`;
      out.synced = fresh.length;
    }

    // INBOUND: ledger row + — when ANSWERED — the same contact/spoke stamps and a
    // timeline note. An answered inbound call IS a conversation (a taken live
    // transfer once sat here for 16 minutes while the deal read "Never spoken
    // to · Handoff MISSED" because this branch was record-only). What inbound
    // still never does is count as a dial ATTEMPT — telemetry attempts stay
    // outbound-only.
    const inbound = calls.filter((c) => c.direction === "inbound");
    if (inbound.length > 0) {
      const freshIn: CallRecord[] = [];
      for (const c of inbound) {
        const { data: ins, error: inErr } = await db.from("ghl_call_log").upsert({
          ghl_message_id: c.id,
          deal_id: dealId,
          ghl_contact_id: contactId,
          direction: c.direction,
          call_status: c.status,
          duration_seconds: c.durationSeconds,
          ghl_user_id: c.userId,
          ghl_user_name: c.userName,
          from_number: c.from,
          to_number: c.to,
          called_at: c.calledAt,
        }, { onConflict: "ghl_message_id", ignoreDuplicates: true }).select("ghl_message_id");
        if (inErr) { out.syncError = `inbound ledger upsert failed: ${inErr.message}`; continue; }
        if (ins && ins.length > 0) { freshIn.push(c); continue; }
        // Late finalization, same as outbound: GHL writes the record at ring time
        // and settles status/duration after hangup — a frozen "ringing" inbound
        // row would never stamp the conversation it turned out to be.
        const { data: known } = await db.from("ghl_call_log")
          .select("ghl_message_id, duration_seconds, call_status")
          .eq("ghl_message_id", c.id).maybeSingle();
        if (known && (
          (c.durationSeconds != null && known.duration_seconds == null) ||
          (c.status && c.status !== known.call_status)
        )) {
          await db.from("ghl_call_log")
            .update({ duration_seconds: c.durationSeconds ?? known.duration_seconds, call_status: c.status })
            .eq("ghl_message_id", c.id);
          if (answered(c)) {
            await db.from("deals").update({ contacted_at: c.calledAt })
              .eq("id", dealId).is("contacted_at", null);
          }
          if (spokeCall(c)) {
            await db.from("deals").update({ spoke_at: c.calledAt })
              .eq("id", dealId).is("spoke_at", null);
          }
        }
      }
      out.inboundRecorded = freshIn.length;
      for (const c of freshIn) {
        if (answered(c)) {
          await db.from("deals").update({ contacted_at: c.calledAt })
            .eq("id", dealId).is("contacted_at", null);
          const { error: logErr } = await db.from("activity_log").insert({
            entity_type: "deal",
            entity_id: dealId,
            interaction_type: "call",
            subject: `GHL call: inbound, ${fmtDuration(c.durationSeconds)}, answered${c.userName ? ` — taken by ${c.userName}` : ""}`,
            content: JSON.stringify({
              source: "ghl-call-history", via, ghl_message_id: c.id, status: c.status,
              duration_seconds: c.durationSeconds, called_at: c.calledAt,
              user: c.userName, from: c.from, to: c.to,
            }),
          });
          if (logErr) console.error("[ghlCallSync] inbound activity_log insert failed:", logErr.message);
        }
        if (spokeCall(c)) {
          await db.from("deals").update({ spoke_at: c.calledAt })
            .eq("id", dealId).is("spoke_at", null);
        }
      }
    }
  } catch (e) {
    out.syncError = e instanceof Error ? e.message : String(e);
  }
  return out;
}
