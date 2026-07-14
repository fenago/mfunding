import { useEffect, useState } from "react";
import { PhoneArrowUpRightIcon, PhoneArrowDownLeftIcon, PhoneIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

/**
 * Call history through GHL/VibeReach for one merchant — the audited answer to
 * "did anyone actually dial this lead?".
 *
 * Closers dial through GHL's phone system, so those calls never used to touch
 * the app: the deal's call telemetry (first_attempt_at / contact_attempts)
 * populated only when someone tapped the outcome buttons, which made "closer
 * called at 10:05" indistinguishable from "nobody called". This panel asks the
 * ghl-call-history edge function for the contact's real TYPE_CALL records, and
 * that same request self-audits: every outbound dial the function hasn't seen
 * before is written to the deal timeline and stamped into the telemetry
 * (record-once — keyed on GHL's message id, so refreshes never double-log).
 *
 * Self-contained: give it the GHL contact id + the deal id and it does the rest.
 */

interface CallRecord {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  durationSeconds: number | null;
  calledAt: string;
  userName: string | null;
}

function fmtWhenEt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }) + " ET";
  } catch {
    return iso;
  }
}

function fmtDuration(sec: number | null): string | null {
  if (sec == null || sec <= 0) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

// Mirrors the edge function's outcome mapping (30s answered threshold lives
// server-side; here we only label what the server already classified).
function outcome(c: CallRecord): { label: string; tone: "good" | "warn" | "bad" } {
  if (c.status === "completed") {
    return (c.durationSeconds ?? 0) >= 30
      ? { label: "answered", tone: "good" }
      : { label: "connected briefly", tone: "warn" };
  }
  if (c.status === "voicemail") return { label: "voicemail", tone: "warn" };
  if (c.status === "no-answer") return { label: "no answer", tone: "warn" };
  if (c.status === "busy") return { label: "busy", tone: "warn" };
  return { label: c.status || "unknown", tone: "bad" };
}

const TONE_CLASS: Record<"good" | "warn" | "bad", string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-500 dark:text-red-400",
};

export default function CallHistoryPanel({ ghlContactId, dealId }: { ghlContactId: string; dealId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [synced, setSynced] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ghl-call-history", {
        body: { ghl_contact_id: ghlContactId, deal_id: dealId },
      });
      if (data?.error) throw new Error(data.error);
      if (error) throw new Error("Could not reach VibeReach for call history");
      setCalls((data?.calls ?? []) as CallRecord[]);
      setSynced((data?.synced as number) ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load call history");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [ghlContactId, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          <PhoneIcon className="w-4 h-4 text-ocean-blue" /> Calls through VibeReach
        </span>
        <button type="button" onClick={load} className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1">
          {loading ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : "↻"} Refresh
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Checking VibeReach…</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : calls.length === 0 ? (
        <p className="text-xs text-gray-400">No calls through VibeReach yet for this merchant.</p>
      ) : (
        <div className="space-y-1.5">
          {calls.map((c) => {
            const o = outcome(c);
            const dur = fmtDuration(c.durationSeconds);
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                {c.direction === "outbound" ? (
                  <PhoneArrowUpRightIcon className="w-3.5 h-3.5 shrink-0 text-ocean-blue" title="Outbound" />
                ) : (
                  <PhoneArrowDownLeftIcon className="w-3.5 h-3.5 shrink-0 text-gray-400" title="Inbound" />
                )}
                <span className="text-gray-700 dark:text-gray-200 font-medium">
                  {c.direction === "outbound" ? "Outbound" : "Inbound"}
                </span>
                <span className={`font-semibold ${TONE_CLASS[o.tone]}`}>{o.label}</span>
                {dur && <span className="text-gray-500 dark:text-gray-400">{dur}</span>}
                <span className="text-gray-400 dark:text-gray-500 ml-auto whitespace-nowrap">
                  {c.userName ? `${c.userName} · ` : ""}{fmtWhenEt(c.calledAt)}
                </span>
              </div>
            );
          })}
          <p className="pt-1 text-[10px] text-gray-400 dark:text-gray-500">
            Outbound dials audit themselves onto this deal's timeline and call telemetry
            {synced > 0 ? ` — ${synced} new call${synced === 1 ? "" : "s"} just recorded.` : "."}
          </p>
        </div>
      )}
    </div>
  );
}
