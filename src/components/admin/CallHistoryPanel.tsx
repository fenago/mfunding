import { useEffect, useState } from "react";
import { PhoneArrowUpRightIcon, PhoneArrowDownLeftIcon, PhoneIcon, ArrowPathIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
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
 * ONE-TAP DISPOSITIONS: every outbound call gets a chip strip so a human can say
 * what actually happened (spoke / voicemail / wrong # / …). That grade is the
 * campaign audit's ground truth — it overrides the duration heuristic — and a
 * "wrong #" / "never requested" tap becomes vendor evidence. Tapping saves
 * instantly (no confirm); a mis-tap is fixed by tapping a different chip.
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
  disposition: string | null;
  dispositionAt: string | null;
  dispositionBy: string | null;
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
// server-side; here we only label what the server already classified). This is
// the machine guess — the human disposition below it is the truth of record.
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

// ── Dispositions ──────────────────────────────────────────────────────────────
// The one-tap grades. `chip` colors the collapsed label after a tap. The primary
// six sit on the strip; gatekeeper lives behind the "more" overflow to keep the
// row from crowding. Keys must match the CHECK constraint + set_call_disposition.
interface Dispo { key: string; emoji: string; label: string; chip: string; }
const DISPOSITIONS: Dispo[] = [
  { key: "spoke",           emoji: "👤", label: "Spoke",           chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { key: "voicemail",       emoji: "📼", label: "Voicemail",       chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { key: "no_answer",       emoji: "📵", label: "No answer",       chip: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  { key: "wrong_number",    emoji: "❌", label: "Wrong #",         chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  { key: "never_requested", emoji: "🚫", label: "Never requested", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  { key: "callback_set",    emoji: "🕐", label: "Callback set",    chip: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
];
const MORE_DISPOSITIONS: Dispo[] = [
  { key: "gatekeeper",      emoji: "🚪", label: "Gatekeeper",      chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
];
const DISPO_BY_KEY: Record<string, Dispo> = Object.fromEntries(
  [...DISPOSITIONS, ...MORE_DISPOSITIONS].map((d) => [d.key, d]),
);

// One outbound call's grade control: a chip strip until graded, then a small
// colored label (who/when on hover). Tap collapses; tap the label to re-grade.
function DispositionControl({
  call, onSaved,
}: {
  call: CallRecord;
  onSaved: (id: string, disposition: string, at: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = call.disposition ? DISPO_BY_KEY[call.disposition] : null;
  const showChips = editing || !current;

  async function pick(key: string) {
    if (saving) return;
    setSaving(key);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("set_call_disposition", {
      p_message_id: call.id,
      p_disposition: key,
    });
    if (rpcErr) {
      setError("Couldn't save — tap to retry");
      setSaving(null);
      return;
    }
    const at = (Array.isArray(data) ? data[0]?.disposition_at : null) ?? new Date().toISOString();
    onSaved(call.id, key, at);
    setSaving(null);
    setEditing(false);
    setShowMore(false);
  }

  if (!showChips && current) {
    const who = call.dispositionBy ?? "you";
    const when = call.dispositionAt ? fmtWhenEt(call.dispositionAt) : "just now";
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`${who} · ${when}`}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${current.chip} hover:opacity-80`}
      >
        <span>{current.emoji}</span>{current.label.toLowerCase()}
      </button>
    );
  }

  const dispos = showMore ? [...DISPOSITIONS, ...MORE_DISPOSITIONS] : DISPOSITIONS;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {dispos.map((d) => {
        const active = call.disposition === d.key;
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => pick(d.key)}
            disabled={saving != null}
            className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
              active
                ? `${d.chip} border-transparent font-semibold`
                : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            } ${saving === d.key ? "opacity-60" : ""}`}
          >
            <span>{d.emoji}</span>{d.label}
          </button>
        );
      })}
      {!showMore && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          title="More dispositions"
          className="inline-flex items-center rounded border border-gray-200 dark:border-gray-600 px-1 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
        </button>
      )}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

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

  // Optimistically reflect a saved grade (disposition_by is us → "you" on hover
  // until the next reload resolves the stored name).
  function applyDisposition(id: string, disposition: string, at: string | null) {
    setCalls((prev) => prev.map((c) =>
      c.id === id ? { ...c, disposition, dispositionAt: at, dispositionBy: null } : c
    ));
  }

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
        <div className="space-y-2">
          {calls.map((c) => {
            const o = outcome(c);
            const dur = fmtDuration(c.durationSeconds);
            return (
              <div key={c.id} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
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
                {/* Human ground truth — outbound only (inbound calls aren't in the ledger). */}
                {c.direction === "outbound" && (
                  <div className="pl-6 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">Outcome</span>
                    <DispositionControl call={c} onSaved={applyDisposition} />
                  </div>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[10px] text-gray-400 dark:text-gray-500">
            Tap what actually happened — it becomes the campaign audit's ground truth, over the auto-guess.
            Outbound dials audit themselves onto this deal's timeline and call telemetry
            {synced > 0 ? ` — ${synced} new call${synced === 1 ? "" : "s"} just recorded.` : "."}
          </p>
        </div>
      )}
    </div>
  );
}
