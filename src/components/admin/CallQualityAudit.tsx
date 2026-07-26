import { useEffect, useRef, useState } from "react";
import {
  PhoneIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";
import { type Campaign } from "@/services/campaignService";
import {
  listCallAuditRuns, getCallAuditRun, getCallAuditCalls, startCallAudit, continueCallAudit,
  CALL_CLASS_LABELS, type CallAuditRun, type CallAuditCall, type CallClass, type SweepProgress,
} from "@/services/callAuditService";
import { dateTimeET } from "@/utils/time";

// ─────────────────────────────────────────────────────────────────────────────
// 📞 Call / Transfer Quality — the phone-call sibling of the email census. Downloads
// each call's recording, transcribes it (Gemini), and classifies the FIRST 60-90s
// against the owner's taxonomy: answered-then-kicked (the headline live-transfer
// failure), missed-to-our-voicemail, mid-call drop, cosmetic teardown, clean. Runs
// weekly by itself (pg_cron) or on the button. Transcripts are stored and viewable
// per row. No browser popups — progress + errors render inline (owner rule).
// ─────────────────────────────────────────────────────────────────────────────

// Failure classes float to the top; benign/no-signal sink. Colors: red = the owner's
// headline failure, orange/amber = other failures, sky = cosmetic, emerald = clean.
const CLASS_CHIP: Record<CallClass, string> = {
  answered_then_kicked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  missed_transfer_voicemail: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  mid_call_drop: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  suspected_instant_drop: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  short_call_unverified: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  transcription_failed: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  no_recording: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  end_teardown_cosmetic: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  clean: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  pending: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
};

const fmtDur = (s: number | null | undefined) => {
  if (s == null || s <= 0) return "0s";
  const m = Math.floor(s / 60), r = s % 60;
  return m > 0 ? `${m}m${String(r).padStart(2, "0")}s` : `${s}s`;
};

// Yesterday / 7-days-ago as YYYY-MM-DD defaults (trailing week, the cron's window).
function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function CallQualityAudit({ campaigns }: { campaigns: Campaign[] }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<CallAuditRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [run, setRun] = useState<CallAuditRun | null>(null);
  const [calls, setCalls] = useState<CallAuditCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Run controls
  const [campaignId, setCampaignId] = useState<string>(""); // "" = all campaigns
  const [allInbound, setAllInbound] = useState(false);
  const [dateFrom, setDateFrom] = useState(isoDay(-7));
  const [dateTo, setDateTo] = useState(isoDay(0));
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);

  async function loadRuns() {
    try {
      const rs = await listCallAuditRuns();
      setRuns(rs);
      // Default to the newest DONE run (or newest of any status) if none picked.
      if (!activeRunId && rs.length) setActiveRunId(rs.find((r) => r.status === "done")?.id ?? rs[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    }
  }

  async function loadActive(runId: string) {
    setLoading(true);
    setError(null);
    try {
      const [r, cs] = await Promise.all([getCallAuditRun(runId), getCallAuditCalls(runId)]);
      setRun(r);
      setCalls(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }

  // Load run list once the section is first opened (lazy — avoids a query on every
  // Campaign Audit visit).
  useEffect(() => { if (open) loadRuns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => { if (activeRunId) loadActive(activeRunId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeRunId]);

  // "Run audit now" — kick off a run, then loop the sweep until it reports done. Each
  // invoke processes a budgeted batch server-side; progress renders inline.
  async function runNow() {
    setRunning(true);
    cancelRef.current = false;
    setRunMsg("Starting…");
    try {
      const first: SweepProgress = await startCallAudit({
        campaignId: campaignId || null,
        dateFrom,
        dateTo,
        allInbound: campaignId ? allInbound : true, // all-campaigns run always sweeps inbound too
      });
      if (first.error) { setRunMsg(`Error: ${first.error}`); setRunning(false); return; }
      const runId = first.runId!;
      setActiveRunId(runId);
      if (first.gemini === false) setRunMsg("Note: no transcription key configured — classifying from call metadata only.");
      let last: SweepProgress = first;
      for (let i = 0; i < 200 && !last.done && !cancelRef.current; i++) {
        setRunMsg(`Auditing… phase ${last.phase ?? "…"}, ${last.enum_remaining ?? 0} contacts to scan, ${last.pending ?? 0} calls to transcribe`);
        last = await continueCallAudit(runId);
        if (last.error) { setRunMsg(`Error: ${last.error}`); break; }
        await loadActive(runId); // stream results into the table as they land
      }
      if (cancelRef.current) setRunMsg("Stopped — partial results shown. The weekly run will complete coverage.");
      else if (last.done) setRunMsg("Done — audit complete.");
      await loadRuns();
      await loadActive(runId);
    } catch (e) {
      setRunMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const t = run?.totals ?? {};
  const campaignName = (id: string | null) =>
    id ? (campaigns.find((c) => c.id === id)?.name ?? "(unknown campaign)") : "All campaigns";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {open ? <ChevronDownIcon className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />}
        <PhoneIcon className="w-5 h-5 text-ocean-blue shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 dark:text-white">📞 Call / Transfer Quality</div>
          <div className="text-[11px] text-gray-400">
            Recordings transcribed + classified — answered-then-kicked, missed-to-voicemail, mid-call drops, cosmetic teardowns, clean. Runs weekly or on demand.
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              Campaign
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100" />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300 pb-2"
              title="Also scan INBOUND calls across the whole location that aren't attached to a campaign contact — catches an answered-then-kicked on a number we never linked to a deal.">
              <input type="checkbox" checked={campaignId ? allInbound : true} disabled={!campaignId}
                onChange={(e) => setAllInbound(e.target.checked)} className="rounded" />
              Sweep unattached inbound {(!campaignId) && <span className="text-gray-400">(always on for all-campaigns)</span>}
            </label>
            <button
              onClick={runNow}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ocean-blue/40 bg-ocean-blue/5 px-3 py-2 text-sm text-ocean-blue hover:bg-ocean-blue/10 disabled:opacity-50"
            >
              <PlayIcon className={`w-4 h-4 ${running ? "animate-pulse" : ""}`} /> {running ? "Auditing…" : "Run audit now"}
            </button>
            {running && (
              <button onClick={() => { cancelRef.current = true; }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Stop
              </button>
            )}
          </div>

          {runMsg && (
            <div className="flex items-start gap-2 rounded-lg bg-ocean-blue/5 border border-ocean-blue/30 px-4 py-2.5 text-[12px] text-ocean-blue">
              <PhoneIcon className={`w-4 h-4 shrink-0 mt-0.5 ${running ? "animate-pulse" : ""}`} />
              <span>{runMsg}</span>
            </div>
          )}

          {/* How to read it — honest about method + coverage. */}
          <div className="flex items-start gap-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-4 py-3 text-[12px] text-sky-800 dark:text-sky-200">
            <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Each call's GHL recording is downloaded and transcribed, then the first ~90 seconds are classified.
              <b> Answered-then-kicked</b> is the headline live-transfer failure (we picked up and were immediately dropped
              from the conference). Calls without a recording or that fail to transcribe are shown honestly, never dropped.
              Transcripts are stored — click a row to read one.
            </span>
          </div>

          {/* Run picker */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[11px] text-gray-500 dark:text-gray-400">Run</label>
            <select
              value={activeRunId ?? ""}
              onChange={(e) => setActiveRunId(e.target.value || null)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 max-w-full"
            >
              {runs.length === 0 && <option value="">No runs yet</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {dateTimeET(r.created_at)} · {campaignName(r.campaign_id)} · {r.date_from}→{r.date_to} · {r.status}
                  {r.status === "done" ? ` · ${r.totals?.calls ?? 0} calls` : ""}
                </option>
              ))}
            </select>
            <button onClick={() => activeRunId && loadActive(activeRunId)} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
            </div>
          )}

          {run && (
            <>
              {/* KPIs */}
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                <Kpi label="Calls audited" value={`${t.calls ?? 0}`} sub={`${t.inbound ?? 0} in · ${t.outbound ?? 0} out`} />
                <Kpi label="With recording" value={t.with_recording_pct != null ? `${t.with_recording_pct}%` : "—"} sub={`${t.with_recording ?? 0} of ${t.calls ?? 0}`} />
                <Kpi label="Answered then kicked" value={`${t.answered_then_kicked ?? 0}`} tone={(t.answered_then_kicked ?? 0) > 0 ? "bad" : "neutral"} sub="headline failure" />
                <Kpi label="Missed → voicemail" value={`${t.missed_transfer_voicemail ?? 0}`} tone={(t.missed_transfer_voicemail ?? 0) > 0 ? "warn" : "neutral"} sub="rang to our machine" />
                <Kpi label="Mid-call drops" value={`${t.mid_call_drop ?? 0}`} tone={(t.mid_call_drop ?? 0) > 0 ? "warn" : "neutral"} sub="dropped after 90s" />
                <Kpi label="Teardown (cosmetic)" value={`${t.end_teardown_cosmetic ?? 0}`} sub="normal hang-up" />
                <Kpi label="Clean" value={`${t.clean ?? 0}`} tone={(t.clean ?? 0) > 0 ? "good" : "neutral"} sub="no drop language" />
                <Kpi label="No recording" value={`${t.no_recording ?? 0}`} sub="nothing to hear" />
                <Kpi label="Transcription failed" value={`${t.transcription_failed ?? 0}`} sub="recording, no text" />
                {run.status !== "done" && <Kpi label="Status" value={run.status} tone="warn" sub="run in progress" />}
              </div>

              {(t.gaps?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-[12px] text-amber-800 dark:text-amber-200">
                  <b>Coverage notes:</b> {t.gaps!.join(" · ")}
                </div>
              )}

              <CallsTable calls={calls} loading={loading} />
            </>
          )}

          {!run && !loading && (
            <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
              No run selected. Pick a date range and press <b>Run audit now</b>, or select a past run above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const cls = tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2">
      <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

function CallsTable({ calls, loading }: { calls: CallAuditCall[]; loading: boolean }) {
  if (loading && calls.length === 0) return <p className="text-sm text-gray-400">Loading calls…</p>;
  if (calls.length === 0) return <p className="text-sm text-gray-400">No calls in this run's window.</p>;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">When (ET)</th>
              <th className="px-3 py-2 font-medium">Business</th>
              <th className="px-3 py-2 font-medium">Dir</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Classification</th>
              <th className="px-3 py-2 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {calls.map((c) => <CallRow key={c.id} c={c} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallRow({ c }: { c: CallAuditCall }) {
  const [open, setOpen] = useState(false);
  const biz = c.meta?.business || (c.direction === "inbound" ? c.from_number : c.to_number) || "—";
  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-200">{c.call_date ? dateTimeET(c.call_date) : "—"}</td>
        <td className="px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{biz}</td>
        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{c.direction === "outbound" ? "→ out" : "← in"}</td>
        <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{fmtDur(c.duration_s)}</td>
        <td className="px-3 py-2">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${CLASS_CHIP[c.classification]}`}>
            {CALL_CLASS_LABELS[c.classification]}
          </span>
          {c.kick_offset_hint && <span className="ml-1 text-[10px] text-gray-400">{c.kick_offset_hint}</span>}
        </td>
        <td className="px-3 py-2 text-[12px] text-gray-500 dark:text-gray-400 max-w-[280px] truncate">
          {c.matched_quote ? <span className="italic">“{c.matched_quote}”</span> : (c.has_recording ? (c.transcript ? "(open to read)" : "—") : "no recording")}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60 dark:bg-gray-900/40">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
                <div><b>Status:</b> {c.call_status ?? "—"}</div>
                <div><b>From:</b> {c.from_number ?? "—"}</div>
                <div><b>To:</b> {c.to_number ?? "—"}</div>
                <div><b>Recording:</b> {c.has_recording ? `yes${c.meta?.rec_bytes ? ` (${Math.round((c.meta.rec_bytes) / 1024)} KB)` : ""}` : "none"}</div>
                {c.meta?.transcription && <div><b>Transcription:</b> {c.meta.transcription}{c.meta.model ? ` · ${c.meta.model}` : ""}</div>}
                {c.matched_quote && <div><b>Matched:</b> <span className="italic">“{c.matched_quote}”</span></div>}
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Transcript</div>
                {c.transcript
                  ? <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 max-h-72 overflow-y-auto">{c.transcript}</pre>
                  : <p className="text-[12px] text-gray-400">{c.has_recording ? "No transcript (transcription unavailable for this call)." : "No recording to transcribe."}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
