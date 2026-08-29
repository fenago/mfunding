// SMS bridge health — the single source of truth for "is the JMP.chat line up?".
//
// The line is a JMP.chat number bridged over XMPP by a droplet. When that
// droplet dies there is no error anywhere, just silence — so health is inferred
// from two signals in sms_messages that go stale on their own:
//   · last INBOUND   — nothing arriving for a day on a line that normally hears
//                      from merchants means the RECEIVE path is dead.
//   · stuck OUTBOUND — anything sitting in queued/sending for minutes means the
//                      SEND path is dead. `sent` rows never get stuck.
//
// UNREADABLE ≠ HEALTHY: every read that fails is carried as `value: undefined`
// and turns into an "unknown" verdict — never a zero, never a green tick. This
// lives in a lib so the ops page (/admin/text-messages/admin) and the System
// Health page render the SAME verdict from the SAME thresholds.
import type { SupabaseClient } from "@supabase/supabase-js";
import { JMP_ACCOUNT, type SmsDirection, type SmsStatus } from "@/lib/sms";

export const ALL_STATUSES: SmsStatus[] = ["received", "queued", "sending", "sent", "failed"];
/** Outbound sitting this long without leaving is a stuck queue, not slowness. */
export const STUCK_MINUTES = 5;
/** No inbound for this long on a live consumer line is worth flagging. */
export const QUIET_HOURS = 24;

/** A number we tried to read. `value: undefined` means the read FAILED — which
 *  must never render as 0. */
export interface Reading<T> {
  value: T | undefined;
  error: string | null;
}

export interface Health {
  counts: Record<SmsStatus, Reading<number>>;
  lastInbound: Reading<string | null>;
  lastOutbound: Reading<string | null>;
  oldestPending: Reading<string | null>;
}

export type Tone = "ok" | "warn" | "bad" | "unknown";
export interface Verdict {
  tone: Tone;
  headline: string;
  detail: string;
}

/** Read all the signals the two verdicts need. Every sub-read fails closed to
 *  `value: undefined` — the caller renders those as "couldn't read", not as 0. */
export async function loadSmsHealth(db: SupabaseClient): Promise<Health> {
  const counts = {} as Record<SmsStatus, Reading<number>>;
  await Promise.all(
    ALL_STATUSES.map(async (s) => {
      const { count, error } = await db
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      counts[s] = { value: error ? undefined : (count ?? 0), error: error?.message ?? null };
    }),
  );

  const newest = async (direction: SmsDirection): Promise<Reading<string | null>> => {
    const { data, error } = await db
      .from("sms_messages")
      .select("created_at")
      .eq("direction", direction)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return { value: undefined, error: error.message };
    return { value: data?.[0]?.created_at ?? null, error: null };
  };

  const oldestPending = await (async (): Promise<Reading<string | null>> => {
    const { data, error } = await db
      .from("sms_messages")
      .select("created_at")
      .in("status", ["queued", "sending"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return { value: undefined, error: error.message };
    return { value: data?.[0]?.created_at ?? null, error: null };
  })();

  const [lastInbound, lastOutbound] = await Promise.all([newest("inbound"), newest("outbound")]);
  return { counts, lastInbound, lastOutbound, oldestPending };
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function verdictInbound(h: Health | null): Verdict {
  if (!h) return { tone: "unknown", headline: "Not checked yet", detail: "" };
  if (h.lastInbound.error)
    return {
      tone: "unknown",
      headline: "Couldn't read the inbound log",
      detail: `This is NOT a healthy verdict — the check itself failed. ${h.lastInbound.error}`,
    };
  const last = h.lastInbound.value;
  if (!last)
    return {
      tone: "unknown",
      headline: "No inbound message has ever been recorded",
      detail:
        "Either nobody has texted the line yet, or the bridge has never successfully delivered a message inbound. Send a test text to the number.",
    };
  const hrs = hoursSince(last);
  const when = new Date(last).toLocaleString();
  if (hrs > QUIET_HOURS)
    return {
      tone: "warn",
      headline: `No inbound for ${Math.floor(hrs)}h`,
      detail: `Last received message was ${when}. On a live line that usually means the droplet bridge is down — check ${JMP_ACCOUNT.statusUrl} and the bridge process.`,
    };
  return { tone: "ok", headline: `Last inbound ${Math.round(hrs * 60)} min ago`, detail: when };
}

export function verdictOutbound(h: Health | null): Verdict {
  if (!h) return { tone: "unknown", headline: "Not checked yet", detail: "" };
  if (h.oldestPending.error || h.lastOutbound.error)
    return {
      tone: "unknown",
      headline: "Couldn't read the outbound queue",
      detail: `This is NOT a healthy verdict — the check itself failed. ${h.oldestPending.error ?? h.lastOutbound.error}`,
    };
  const pending = h.oldestPending.value;
  if (pending) {
    const mins = (Date.now() - new Date(pending).getTime()) / 60_000;
    if (mins > STUCK_MINUTES)
      return {
        tone: "bad",
        headline: `Queue stuck — oldest unsent message is ${Math.floor(mins)} min old`,
        detail:
          "Messages are being accepted but never leaving. The send side of the bridge is down; nothing queued has reached a merchant.",
      };
    return {
      tone: "ok",
      headline: "Sending normally",
      detail: `${Math.round(mins)} min in the queue — within the normal window.`,
    };
  }
  const last = h.lastOutbound.value;
  if (!last)
    return {
      tone: "unknown",
      headline: "Nothing has ever been sent from this line",
      detail: "No outbound message on record yet.",
    };
  const failed = h.counts.failed.value ?? 0;
  return {
    tone: failed > 0 ? "warn" : "ok",
    headline: failed > 0 ? `Queue clear, but ${failed} message(s) have failed` : "Queue clear",
    detail: `Last outbound ${new Date(last).toLocaleString()}.${failed > 0 ? " Filter the log by status = failed to see why." : ""}`,
  };
}

/** Worst of the two verdicts, for a single roll-up pill (System Health tile). */
export function worstTone(...tones: Tone[]): Tone {
  const rank: Record<Tone, number> = { bad: 0, warn: 1, unknown: 2, ok: 3 };
  return tones.reduce((acc, t) => (rank[t] < rank[acc] ? t : acc), "ok" as Tone);
}
