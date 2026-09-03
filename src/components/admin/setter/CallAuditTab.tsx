import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";

/**
 * CallAuditTab — the ADMIN-ONLY end-of-day call-quality report (super_admin only;
 * setters never see this tab). One card per setter per day, produced nightly by
 * the setter-daily-audit fn (9:30 PM ET) from WAVV transcripts:
 *   · hard metrics (dials / answered / line-time / human outcomes / None-unset)
 *   · transcript classification (conversations, VMs dropped, VM greetings
 *     listened with NO message left)
 *   · SUSPECTED MISLABELS with accept / decline — accepting rewrites our
 *     mirrored wavv_calls.disposition (original preserved) so the funnel and
 *     scorecards count the truth.
 */

interface SampleItem {
  call_id: string;
  et: string;
  contact: string | null;
  phone: string | null;
  seconds: number | null;
  disposition: string;
  class: string;
  suspected_mislabel: boolean;
  suggested: string | null;
  excerpt: string;
  review?: "accept" | "decline";
  applied_disposition?: string | null;
}
interface AuditRow {
  id: string;
  audit_date: string;
  setter_name: string;
  metrics: Record<string, number | Record<string, number>>;
  sample: SampleItem[];
  summary: string | null;
}

function todayEt(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);
}

export default function CallAuditTab() {
  const [date, setDate] = useState(todayEt());
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busyCall, setBusyCall] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("setter_call_audits")
        .select("id, audit_date, setter_name, metrics, sample, summary")
        .eq("audit_date", date)
        .order("setter_name");
      if (error) throw new Error(error.message);
      setRows((data ?? []) as unknown as AuditRow[]);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : "Failed to load the audit.");
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("setter-daily-audit", { body: { date } });
      if (error) throw new Error(error.message);
      const r = data as { error?: string; setters?: number } | null;
      if (r?.error) throw new Error(r.error);
      await load();
      setFlash(`✓ Audit refreshed for ${date} — ${r?.setters ?? 0} setter(s) analyzed (transcripts re-pulled; your accept/decline verdicts are preserved).`);
      setTimeout(() => setFlash(null), 6000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Audit run failed.");
    } finally {
      setRunning(false);
    }
  };

  const review = async (auditId: string, item: SampleItem, verdict: "accept" | "decline") => {
    setBusyCall(item.call_id);
    setErr(null);
    try {
      const { error } = await supabase.rpc("setter_audit_review", {
        p_audit_id: auditId,
        p_call_id: item.call_id,
        p_verdict: verdict,
        p_new_disposition: verdict === "accept" ? item.suggested : null,
      });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record the review.");
    } finally {
      setBusyCall(null);
    }
  };

  const n = (v: unknown) => Number(v ?? 0) || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-ocean-blue" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Call audit</h2>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            admin only — setters can't see this
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
            title="Re-run the audit for this date now (it also runs automatically at 9:30 PM ET)"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Auditing…" : "Run now"}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
        Nightly at 9:30 PM ET the audit transcribes a sample of each setter's calls (every human-outcome call + the
        longest recorded ones) and flags <b>suspected mislabels</b> — accept a fix and every scorecard recounts.
      </p>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" /> {err}
        </div>
      )}
      {flash && (
        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{flash}</p>
      )}

      {loading && !rows ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-400">
          No audit stored for this date yet — hit <b>Run now</b> (the nightly run covers each day automatically going forward).
        </p>
      ) : (
        (rows ?? []).map((r) => {
          const m = r.metrics as Record<string, number>;
          const mislabels = r.sample.filter((s) => s.suspected_mislabel);
          return (
            <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{r.setter_name}</h3>
                <span className="text-[11px] text-gray-400">{r.audit_date}</span>
              </div>
              {/* Metric chips */}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 tabular-nums">{n(m.dials).toLocaleString()} dials</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 tabular-nums">{Math.round(n(m.talk_seconds) / 60).toLocaleString()}m line-time</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 tabular-nums">{n(m.human_outcomes)} human outcomes</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 tabular-nums">{n(m.positives)} positive</span>
                <span className={`px-2 py-0.5 rounded-full tabular-nums ${n(m.none_unset) > 50 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"}`}>{n(m.none_unset)} None/unset</span>
                <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 tabular-nums">{n(m.conversations)} convs in sample</span>
                <span className={`px-2 py-0.5 rounded-full tabular-nums ${n(m.vm_listened) > 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}>{n(m.vm_listened)} VM greetings listened (no drop)</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 tabular-nums">{n(m.vm_dropped)} VMs dropped</span>
              </div>
              {r.summary && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{r.summary}</p>}

              {/* Script quality — measurable, from the conversation transcripts. */}
              {(() => {
                const sc = (r.metrics as Record<string, unknown>).script as {
                  convs_analyzed: number; identity_opener_pct: number; capture_ask_pct: number;
                  ladder_stepdown_pct: number; convs_with_a_no: number; gave_up_after_first_no: number;
                  avg_rebuttals_after_no: number | null;
                } | null;
                if (!sc || sc.convs_analyzed === 0) return null;
                const pill = (ok: boolean) =>
                  ok
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
                return (
                  <div className="mt-3">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                      Script quality ({sc.convs_analyzed} conversations analyzed)
                    </h4>
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                      <span className={`px-2 py-0.5 rounded-full ${pill(sc.identity_opener_pct >= 80)}`}
                        title='Opens with "this is <name> with Momentum" instead of gatekeeper-bait "I\'m looking for…"'>
                        identity opener {sc.identity_opener_pct}%
                      </span>
                      <span className={`px-2 py-0.5 rounded-full ${pill(sc.convs_with_a_no === 0 || sc.gave_up_after_first_no < sc.convs_with_a_no)}`}
                        title="Conversations where a decline was met with ZERO rebuttal — gave up on the first soft no">
                        gave up after 1st no: {sc.gave_up_after_first_no}/{sc.convs_with_a_no}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full ${pill(sc.capture_ask_pct >= 50)}`}
                        title="Asked for cell / email / OK-to-text (the fixed capture step of the approved script)">
                        capture ask {sc.capture_ask_pct}%
                      </span>
                      <span className={`px-2 py-0.5 rounded-full ${pill(sc.ladder_stepdown_pct >= 50)}`}
                        title="On resistance, offered the next rung (appointment / callback) instead of ending the call">
                        ladder step-down {sc.ladder_stepdown_pct}%
                      </span>
                      {sc.avg_rebuttals_after_no !== null && (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 tabular-nums"
                          title="Average rebuttal attempts after the first decline (target: at least 1 clean step-down)">
                          avg rebuttals {sc.avg_rebuttals_after_no}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Suspected mislabels with accept / decline */}
              {mislabels.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-red-500 mb-1.5">
                    Suspected mislabels ({mislabels.length})
                  </h4>
                  <div className="rounded-lg border border-red-200 dark:border-red-900/60 divide-y divide-red-100 dark:divide-red-900/40">
                    {mislabels.map((s) => (
                      <div key={s.call_id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-gray-900 dark:text-white">{s.et}</span>
                          <span className="text-gray-500 dark:text-gray-400">{s.contact || s.phone || "?"}</span>
                          <span className="text-gray-400">{s.seconds ?? "?"}s</span>
                          <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px] font-bold">
                            labeled: {s.disposition}
                          </span>
                          <span className="text-gray-400">→</span>
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] font-bold">
                            suggest: {s.suggested}
                          </span>
                          <span className="text-[10px] text-gray-400">({s.class.replace("_", " ")})</span>
                          {s.review ? (
                            <span className={`ml-auto text-[10px] font-bold ${s.review === "accept" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>
                              {s.review === "accept" ? `✓ relabeled → ${s.applied_disposition}` : "✗ declined"}
                            </span>
                          ) : (
                            <span className="ml-auto flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyCall === s.call_id}
                                onClick={() => void review(r.id, s, "accept")}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                disabled={busyCall === s.call_id}
                                onClick={() => void review(r.id, s, "decline")}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-red-400 disabled:opacity-50"
                              >
                                Decline
                              </button>
                            </span>
                          )}
                        </div>
                        {s.excerpt && (
                          <p className="mt-1 text-[11px] italic text-gray-500 dark:text-gray-400">"{s.excerpt}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
