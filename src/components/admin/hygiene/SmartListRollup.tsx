// SmartListRollup — the "results & take action" block for a saved smart list.
//
// Three things, all driven by the smart-list-action edge fn:
//   1) RESULTS ROLLUP card — reachable / dead / DNC / litigator / no-contact /
//      dialable (+ excluded / unvalidated), from { action:'rollup' }. Refreshed
//      after any enrich/validate/suppress. Honest on a read failure (shows the
//      error, never zeros that would read as "all clean").
//   2) SUPPRESS dead & DNC — inline two-step confirm (no popups) → { action:'suppress' }
//      flags dead OR dnc OR litigator members excluded so they're NEVER dialed.
//      Reversible via an Undo link ({ action:'unsuppress' }).
//   3) PUSH TO SETTERS — a dial-tag input + a headroom PREVIEW (spends nothing) then
//      a two-step push that tags the DIALABLE, in-GHL members with the tag (additive).
//      Surfaces needs_ghl_push (members not in GHL yet → push from the Lead Machine)
//      and capped/parked (GHL daily-budget) messaging.
//
// Mounted by SmartListActions. Compliance: internal surface, MCA positions are
// advances/funding — never "loan".

import { useCallback, useEffect, useState } from "react";
import {
  ChartBarIcon, ArrowPathIcon, ExclamationTriangleIcon, NoSymbolIcon,
  CheckCircleIcon, MegaphoneIcon, ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { fnErrorMessage, slugifyTag, type SmartList, type SmartListRollupCounts } from "./hygiene";

async function callAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("smart-list-action", { body });
  if (error) throw new Error(await fnErrorMessage(error));
  const r = (data as Record<string, unknown>) ?? {};
  if (r.ok === false) throw new Error(String(r.error || "action failed"));
  return r as T;
}

/* Auto-disarming two-step confirm (house armOrFire; no browser popups). */
function useArm(): [boolean, () => void, () => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, () => setArmed(true), () => setArmed(false)];
}

export default function SmartListRollup({ list, onChanged }: { list: SmartList; onChanged: () => void }) {
  const [rollup, setRollup] = useState<SmartListRollupCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [rollupErr, setRollupErr] = useState<string | null>(null);

  const loadRollup = useCallback(async () => {
    setLoading(true);
    setRollupErr(null);
    try {
      const r = await callAction<SmartListRollupCounts & { ok: boolean }>({ action: "rollup", smart_list_id: list.id });
      setRollup({
        total: Number(r.total ?? 0), reachable: Number(r.reachable ?? 0), dead: Number(r.dead ?? 0),
        dnc: Number(r.dnc ?? 0), litigator: Number(r.litigator ?? 0), no_contact: Number(r.no_contact ?? 0),
        unvalidated: Number(r.unvalidated ?? 0), excluded: Number(r.excluded ?? 0),
        suppressible: Number(r.suppressible ?? 0), dialable: Number(r.dialable ?? 0),
      });
    } catch (e) {
      setRollup(null);
      setRollupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [list.id]);

  useEffect(() => { loadRollup(); }, [loadRollup]);

  // After a suppress/unsuppress: refresh both the rollup AND the parent (member chips).
  const refreshAll = useCallback(() => {
    loadRollup();
    onChanged();
  }, [loadRollup, onChanged]);

  return (
    <div className="space-y-3">
      {/* ── Results rollup card ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ChartBarIcon className="w-5 h-5 text-ocean-blue" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Results rollup</h3>
          </div>
          <button onClick={loadRollup} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-ocean-blue hover:underline disabled:opacity-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {rollupErr ? (
          <div className="text-xs rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900/40 flex gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Couldn't read the rollup (showing nothing rather than a false all-clear): {rollupErr}</span>
          </div>
        ) : loading && !rollup ? (
          <p className="text-sm text-gray-400">Reading results…</p>
        ) : rollup ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="Reachable" value={rollup.reachable} tone="ok" />
              <Stat label="Dead line" value={rollup.dead} tone="bad" />
              <Stat label="DNC" value={rollup.dnc} tone="warn" />
              <Stat label="TCPA litigator" value={rollup.litigator} tone="bad" />
              <Stat label="No contact" value={rollup.no_contact} tone="neutral" />
              <Stat label="Dialable" value={rollup.dialable} tone="ok" big />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
              <span>{rollup.total.toLocaleString()} members</span>
              <span>{rollup.unvalidated.toLocaleString()} not validated</span>
              <span>{rollup.excluded.toLocaleString()} excluded</span>
            </div>
          </>
        ) : null}
      </div>

      {/* ── Take action: suppress + push ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SuppressPanel list={list} rollup={rollup} onDone={refreshAll} />
        <PushToSettersPanel list={list} onDone={refreshAll} />
      </div>
    </div>
  );
}

/* ── Suppress dead & DNC (reversible) ── */
function SuppressPanel({ list, rollup, onDone }: { list: SmartList; rollup: SmartListRollupCounts | null; onDone: () => void }) {
  const [armed, arm, disarm] = useArm();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  // Target = UNIQUE not-yet-excluded members that are dead OR dnc OR litigator.
  // (The per-flag counts overlap — one member can be dead AND a litigator — so
  // summing them over-counts; the RPC's `suppressible` is the honest number.)
  const target = rollup ? rollup.suppressible : null;

  const run = async () => {
    disarm();
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const r = await callAction<{ suppressed: number; dead?: number; disconnected?: number; dnc: number; litigator: number }>({
        action: "suppress", smart_list_id: list.id,
      });
      const dead = Number(r.disconnected ?? r.dead ?? 0);
      setResult(`${Number(r.suppressed ?? 0).toLocaleString()} removed from dialable (${dead} dead, ${Number(r.dnc ?? 0)} DNC, ${Number(r.litigator ?? 0)} litigator)`);
      setCanUndo(Number(r.suppressed ?? 0) > 0);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const undo = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await callAction<{ cleared: number }>({ action: "unsuppress", smart_list_id: list.id });
      setResult(`Restored ${Number(r.cleared ?? 0).toLocaleString()} member(s) to the dialable set.`);
      setCanUndo(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <NoSymbolIcon className="w-4 h-4 text-red-500" />
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Suppress dead &amp; DNC</h3>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Flags dead-line, DNC and TCPA-litigator members so they're never dialed. Reversible.
      </p>

      {!running && (
        <button
          onClick={() => (armed ? run() : arm())}
          disabled={target === 0}
          className={`btn-sm w-full inline-flex items-center justify-center gap-1.5 ${armed ? "btn-primary ring-2 ring-offset-1 ring-rose-400" : "btn-primary"} disabled:opacity-50`}
        >
          <CheckCircleIcon className="w-4 h-4" />
          {target === 0
            ? "Nothing to suppress"
            : armed
              ? `Confirm — suppress${target != null ? ` ${target.toLocaleString()}` : ""}`
              : `Suppress dead & DNC${target != null ? ` (${target.toLocaleString()})` : ""}`}
        </button>
      )}
      {running && <p className="text-xs text-gray-500">Working…</p>}
      {result && (
        <div className="text-sm text-emerald-700 dark:text-emerald-300 space-y-1">
          <p>{result}</p>
          {canUndo && (
            <button onClick={undo} disabled={running} className="inline-flex items-center gap-1 text-xs text-ocean-blue hover:underline">
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Undo (restore to dialable)
            </button>
          )}
        </div>
      )}
      {err && <p className="text-sm text-rose-600 dark:text-rose-400">Failed: {err}</p>}
    </div>
  );
}

/* ── Push to Setters (preview → cap-aware push) ── */
interface PushPreview { dialable_count: number; ghl_calls_needed: number; needs_ghl_push: number; daily_remaining: number | null; dial_tag: string }
interface PushResult { tagged: number; needs_ghl_push: number; parked: number; capped: boolean; errored?: number; dial_tag: string }

function PushToSettersPanel({ list, onDone }: { list: SmartList; onDone: () => void }) {
  const [dialTag, setDialTag] = useState<string>(list.dial_tag || `smartlist-${slugifyTag(list.name)}`);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [armed, arm, disarm] = useArm();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doPreview = async () => {
    setPreviewing(true);
    setErr(null);
    setResult(null);
    disarm();
    setPreview(null);
    try {
      const r = await callAction<PushPreview>({ action: "push_to_setters", sub_mode: "preview", smart_list_id: list.id, dial_tag: dialTag.trim() || undefined });
      setPreview({
        dialable_count: Number(r.dialable_count ?? 0), ghl_calls_needed: Number(r.ghl_calls_needed ?? 0),
        needs_ghl_push: Number(r.needs_ghl_push ?? 0), daily_remaining: r.daily_remaining == null ? null : Number(r.daily_remaining),
        dial_tag: String(r.dial_tag ?? dialTag),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const run = async () => {
    disarm();
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const r = await callAction<PushResult>({ action: "push_to_setters", smart_list_id: list.id, dial_tag: dialTag.trim() || undefined });
      setResult({
        tagged: Number(r.tagged ?? 0), needs_ghl_push: Number(r.needs_ghl_push ?? 0), parked: Number(r.parked ?? 0),
        capped: r.capped === true, errored: Number(r.errored ?? 0), dial_tag: String(r.dial_tag ?? dialTag),
      });
      setPreview(null); // stale after a push
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const canPush = !!preview && preview.ghl_calls_needed > 0 && !running;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MegaphoneIcon className="w-4 h-4 text-mint-green" />
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Push to setters</h3>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Tags the clean, dialable members in VibeReach so the floor can dial them. Point a VibeReach campaign at the tag.
      </p>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Dial tag</label>
        <input
          value={dialTag}
          onChange={(e) => { setDialTag(e.target.value); setPreview(null); disarm(); }}
          className="input input-sm w-full font-mono text-xs"
          placeholder={`smartlist-${slugifyTag(list.name)}`}
        />
      </div>

      <button onClick={doPreview} disabled={previewing || running} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
        <ArrowPathIcon className={`w-4 h-4 ${previewing ? "animate-spin" : ""}`} /> {previewing ? "Checking…" : "Preview headroom"}
      </button>

      {preview && (
        <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
          <p>
            Will tag <strong className="text-gray-900 dark:text-white">{preview.ghl_calls_needed.toLocaleString()}</strong> contacts ·
            ~{preview.ghl_calls_needed.toLocaleString()} VibeReach calls ·{" "}
            {preview.daily_remaining == null ? "budget unknown" : `${preview.daily_remaining.toLocaleString()} left in today's budget`}
          </p>
          {preview.needs_ghl_push > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <ExclamationTriangleIcon className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
              {preview.needs_ghl_push.toLocaleString()} dialable member(s) aren't in VibeReach yet — push them from the Lead Machine first.
            </p>
          )}
          {preview.ghl_calls_needed === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">No in-VibeReach dialable members to tag.</p>
          )}
        </div>
      )}

      {canPush && !running && (
        <button
          onClick={() => (armed ? run() : arm())}
          className={`btn-sm w-full inline-flex items-center justify-center gap-1.5 ${armed ? "btn-primary ring-2 ring-offset-1 ring-rose-400" : "btn-primary"}`}
        >
          <CheckCircleIcon className="w-4 h-4" />
          {armed ? `Confirm — tag ${preview!.ghl_calls_needed.toLocaleString()} as ${preview!.dial_tag}` : `Push ${preview!.ghl_calls_needed.toLocaleString()} to setters`}
        </button>
      )}
      {running && <p className="text-xs text-gray-500">Tagging in VibeReach…</p>}

      {result && (
        <div className="text-sm space-y-1">
          <p className="text-emerald-700 dark:text-emerald-300">
            Tagged {result.tagged.toLocaleString()} contacts as <span className="font-mono">{result.dial_tag}</span> — point a VibeReach campaign at that tag.
          </p>
          {result.parked > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {result.parked.toLocaleString()} parked ({result.capped ? "hit the per-run cap" : "VibeReach daily budget"}) — run Push again to continue{result.capped ? "" : " after the daily reset"}.
            </p>
          )}
          {result.needs_ghl_push > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {result.needs_ghl_push.toLocaleString()} dialable member(s) aren't in VibeReach yet — push them from the Lead Machine first.
            </p>
          )}
          {!!result.errored && result.errored > 0 && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{result.errored.toLocaleString()} errored (e.g. contact removed in VibeReach).</p>
          )}
        </div>
      )}
      {err && <p className="text-sm text-rose-600 dark:text-rose-400">Failed: {err}</p>}
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  neutral: "text-gray-700 dark:text-gray-200",
};

function Stat({ label, value, tone = "neutral", big = false }: { label: string; value: number; tone?: string; big?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${big ? "border-mint-green/40 bg-mint-green/5" : "border-gray-100 dark:border-gray-700"}`}>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${TONE[tone] ?? TONE.neutral}`}>{value.toLocaleString()}</p>
    </div>
  );
}
