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
  // en-CA formats as YYYY-MM-DD directly in the target zone. The previous
  // parse-then-toISOString round-trip re-applied the BROWSER's offset, so on an
  // ET machine after ~8 PM the tab defaulted to TOMORROW (empty day, no audit).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
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

  const review = async (
    auditId: string,
    item: SampleItem,
    verdict: "accept" | "decline",
    newDisposition?: string,
  ) => {
    setBusyCall(item.call_id);
    setErr(null);
    try {
      const { error } = await supabase.rpc("setter_audit_review", {
        p_audit_id: auditId,
        p_call_id: item.call_id,
        p_verdict: verdict,
        p_new_disposition: verdict === "accept" ? (newDisposition ?? item.suggested) : null,
      });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record the review.");
    } finally {
      setBusyCall(null);
    }
  };

  // Manual fix on ANY sampled call — not just the flagged ones.
  const [fixSel, setFixSel] = useState<Record<string, string>>({});
  const DISPO_OPTIONS = [
    "Voice Message", "No Answer", "Bad Number", "Not Interested", "Do Not Contact",
    "Callback", "Appointment Set", "Partial Application", "Full Application", "Full App + Statements",
  ];

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
              {(() => {
                const sc = (r.metrics as Record<string, unknown>).script as {
                  convs_analyzed: number; identity_opener_pct: number; capture_ask_pct: number;
                  ladder_stepdown_pct: number; convs_with_a_no: number; gave_up_after_first_no: number;
                  avg_rebuttals_after_no: number | null;
                } | null;
                // Colors mean ONE thing everywhere: green = good, red = fix this,
                // grey = plain fact (no judgement).
                const GOOD = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
                const BAD = "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
                const FACT = "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200";
                const chip = (label: string, tone: string, help: string) => (
                  <span key={label} title={help} className={`px-2 py-0.5 rounded-full tabular-nums cursor-help ${tone}`}>{label}</span>
                );
                const dials = n(m.dials), humans = n(m.human_outcomes), positives = n(m.positives);
                const noneUnset = n(m.none_unset), vmListened = n(m.vm_listened), vmDropped = n(m.vm_dropped);
                const noneShare = dials > 0 ? Math.round((noneUnset / dials) * 100) : 0;

                // ── Coaching — plain-language recommendations derived from the numbers. ──
                const coach: string[] = [];
                if (noneUnset > 25)
                  coach.push(`${noneUnset} calls (${noneShare}% of the day) ended with no real outcome recorded ("None" or nothing). Rule to coach: no call ends without a real disposition — their own scorecard under-counts them until they click.`);
                if (vmListened > 0)
                  coach.push(`Listened to ${vmListened} voicemail greetings all the way through WITHOUT leaving our message. Coach the one-button fix: when a machine answers, hit the Voicemail button — it drops our recorded message and dials the next lead. Listening wastes ~1 min per call and leaves the merchant nothing.`);
                if (humans > 0 && positives === 0)
                  coach.push(`Talked to ${humans} real people and logged ZERO wins (no Partial Application, Appointment, or Callback). Either the pitch isn't landing or wins aren't being clicked — spot-check two recordings from "All sampled calls" below.`);
                if (sc && sc.convs_with_a_no > 0 && sc.gave_up_after_first_no >= Math.ceil(sc.convs_with_a_no / 2))
                  coach.push(`Folded on the FIRST "no" in ${sc.gave_up_after_first_no} of ${sc.convs_with_a_no} conversations that hit resistance. Coach one clean step-down: acknowledge the no → "if the numbers made sense, would you look?" → offer the appointment.`);
                if (sc && sc.identity_opener_pct < 80)
                  coach.push(`Only ${sc.identity_opener_pct}% of conversations opened with "This is <name> with Momentum Funding." Opening with "I'm looking for…" invites gatekeeping — lead with identity.`);
                if (sc && sc.capture_ask_pct < 50)
                  coach.push(`Almost never asks for the cell / email / OK-to-text (${sc.capture_ask_pct}%). That's the FIRST step of the approved script — without it there's no follow-up channel.`);
                if (sc && sc.ladder_stepdown_pct < 50)
                  coach.push(`Rarely offers the fallback rung (appointment / callback) when the merchant resists (${sc.ladder_stepdown_pct}%). A "no" to the app should become a "yes" to a 10-minute appointment.`);
                if (coach.length === 0)
                  coach.push("Clean day — dispositions honest, voicemails dropped, script followed. Nothing to fix.");

                return (
                  <>
                    {/* THE DAY — plain facts. */}
                    <div className="mt-3">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">The day</h4>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {chip(`${dials.toLocaleString()} dials`, FACT, "Outbound calls placed")}
                        {chip(`${n(m.answered).toLocaleString()} answered`, FACT, "A person OR a machine picked up")}
                        {chip(`${Math.round(n(m.talk_seconds) / 60).toLocaleString()} min on the line`, FACT, "Total connected time across all calls (3 parallel lines can exceed clock time)")}
                      </div>
                    </div>

                    {/* OUTCOMES — did the talking produce anything? */}
                    <div className="mt-2">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Outcomes</h4>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {chip(`${humans} real people reached`, FACT, "Calls they dispositioned with a human outcome (Interested/Not Interested/DNC/etc.)")}
                        {chip(
                          `${positives} wins`,
                          positives > 0 ? GOOD : humans > 0 ? BAD : FACT,
                          "Positive outcomes: Partial/Full Application, Appointment Set, Callback. Red = talked to people, won none.",
                        )}
                      </div>
                    </div>

                    {/* HYGIENE — can we trust their logging + voicemail habits? */}
                    <div className="mt-2">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Work hygiene</h4>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {chip(
                          `${noneUnset} calls with NO outcome recorded (${noneShare}%)`,
                          noneUnset > 25 ? BAD : noneUnset > 0 ? FACT : GOOD,
                          "Dispositioned 'None' or nothing at all — we don't know what happened on these calls. Target: 0.",
                        )}
                        {chip(
                          `${vmListened} voicemails wasted`,
                          vmListened > 0 ? BAD : GOOD,
                          "Voicemail greetings they listened to all the way through WITHOUT leaving our message. The Voicemail button drops our recording in one press. Target: 0.",
                        )}
                        {chip(
                          `${vmDropped} voicemails left`,
                          vmDropped > 0 ? GOOD : FACT,
                          "Voicemails where OUR recorded message was actually dropped for the merchant.",
                        )}
                        {chip(
                          `${n(m.suspected_mislabels)} suspected mislabels`,
                          n(m.suspected_mislabels) > 0 ? BAD : GOOD,
                          "Sampled calls whose transcript contradicts the label they clicked — e.g. a real conversation logged as 'Voice Message'. Review them below.",
                        )}
                      </div>
                    </div>

                    {/* SCRIPT — how they actually sell, from the transcripts. */}
                    {sc && sc.convs_analyzed > 0 && (
                      <div className="mt-2">
                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                          Script ({sc.convs_analyzed} conversations read)
                        </h4>
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                          {chip(
                            `opens with identity ${sc.identity_opener_pct}%`,
                            sc.identity_opener_pct >= 80 ? GOOD : BAD,
                            'Good opener: "This is NAME with Momentum Funding." Bad: "I\'m looking for…" (invites gatekeeping). Target: 80%+.',
                          )}
                          {chip(
                            `gave up on first no: ${sc.gave_up_after_first_no} of ${sc.convs_with_a_no}`,
                            sc.convs_with_a_no === 0 ? FACT : sc.gave_up_after_first_no === 0 ? GOOD : BAD,
                            "Conversations where the merchant declined once and the setter made ZERO comeback. Target: 0 — every no gets one clean step-down.",
                          )}
                          {chip(
                            `asks for cell/email ${sc.capture_ask_pct}%`,
                            sc.capture_ask_pct >= 50 ? GOOD : BAD,
                            "Asked for the cell, email, or OK-to-text — the script's required capture step. Target: 50%+ of conversations.",
                          )}
                          {chip(
                            `offers appointment fallback ${sc.ladder_stepdown_pct}%`,
                            sc.ladder_stepdown_pct >= 50 ? GOOD : BAD,
                            "When the merchant resisted, offered the next rung (appointment / callback) instead of hanging up. Target: 50%+.",
                          )}
                        </div>
                      </div>
                    )}

                    {/* COACHING — what to actually say to them tomorrow morning. */}
                    <div className="mt-3 rounded-lg border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ocean-blue mb-1">💡 Coaching for tomorrow</h4>
                      <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-200 list-disc pl-4">
                        {coach.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  </>
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

              {/* Every sampled call — fix ANY disposition, not just the flagged ones. */}
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-ocean-blue">
                  All sampled calls ({r.sample.length}) — click to review / fix any disposition
                </summary>
                <div className="mt-1.5 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                  {r.sample.map((s) => (
                    <div key={s.call_id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-gray-900 dark:text-white">{s.et}</span>
                        <span className="text-gray-500 dark:text-gray-400">{s.contact || s.phone || "?"}</span>
                        <span className="text-gray-400">{s.seconds ?? "?"}s</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold">
                          {s.applied_disposition ?? s.disposition}
                        </span>
                        <span className="text-[10px] text-gray-400">({s.class.replace(/_/g, " ")})</span>
                        {s.review === "accept" ? (
                          <span className="ml-auto text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            ✓ relabeled → {s.applied_disposition}
                          </span>
                        ) : (
                          <span className="ml-auto flex items-center gap-1.5">
                            <select
                              value={fixSel[s.call_id] ?? ""}
                              onChange={(e) => setFixSel((m) => ({ ...m, [s.call_id]: e.target.value }))}
                              className="text-[10px] px-1.5 py-0.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                            >
                              <option value="">fix to…</option>
                              {DISPO_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <button
                              type="button"
                              disabled={!fixSel[s.call_id] || busyCall === s.call_id}
                              onClick={() => void review(r.id, s, "accept", fixSel[s.call_id])}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-40"
                            >
                              {busyCall === s.call_id ? "…" : "Apply"}
                            </button>
                          </span>
                        )}
                      </div>
                      {s.excerpt && (
                        <p className="mt-1 text-[11px] italic text-gray-500 dark:text-gray-400 line-clamp-2">"{s.excerpt}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          );
        })
      )}
    </div>
  );
}
