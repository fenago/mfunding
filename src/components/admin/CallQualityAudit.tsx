import { useEffect, useRef, useState } from "react";
import {
  PhoneIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlayIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { type Campaign } from "@/services/campaignService";
import {
  listCallAuditRuns, getCallAuditRun, getCallAuditCalls, startCallAudit, continueCallAudit,
  CALL_CLASS_LABELS, type CallAuditRun, type CallAuditCall, type CallClass, type SweepProgress,
  type ReconResult, type EligibleRow, type ReconSummary,
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
  // Closer-flagged human truth — the most prominent chip (solid red + ring).
  disconnected_at_handoff: "bg-red-600 text-white dark:bg-red-600 dark:text-white ring-1 ring-red-300 dark:ring-red-400",
  answered_then_kicked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  missed_transfer_voicemail: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  mid_call_drop: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  suspected_instant_drop: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  short_call_unverified: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  transcription_failed: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  no_recording: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  end_teardown_cosmetic: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  clean: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  // Team-phone calls — muted, explicitly "not a merchant drop".
  internal_test: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 line-through",
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
      if (first.gemini === false) setRunMsg("Transcription is OFF — no valid Gemini key. Add a valid key as TRANSCRIPTION_API_KEY (Edge secret) to transcribe; for now, classifying from call metadata only.");
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

          {/* Week-over-week trend — did the phone fixes bend the curve? */}
          <TrendStrip runs={runs} />

          {run && t.transcription_available === false && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-200">
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>Transcription was OFF for this run</b> — no valid Gemini key in the project. Calls are classified from
                metadata only (duration/status), so <b>answered-then-kicked</b> and <b>missed-to-voicemail</b> can't be
                confirmed from audio; short completed calls show as “suspected instant drop.” Add a valid Gemini key as the
                Edge secret <code className="font-mono">TRANSCRIPTION_API_KEY</code> and re-run to get full transcripts + drop detection.
              </span>
            </div>
          )}

          {run && (
            <>
              {/* HEADLINE — transfer-centric, what we can measure right now. Leads with the
                  number the owner reads off the board (missed handoff), not a wall of
                  transcript-dependent zeros. */}
              {t.reconciliation?.summary
                ? <TransferHeadline s={t.reconciliation.summary} transcriptionAvailable={t.transcription_available !== false} inProgress={run.status !== "done"} />
                : (
                  <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4 text-[12px] text-gray-500">
                    This run's window has no Synergy transfers to reconcile{run.status !== "done" ? " yet (run still in progress)" : ""} — see the call-level breakdown below.
                  </div>
                )}

              {(t.gaps?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-[12px] text-amber-800 dark:text-amber-200">
                  <b>Coverage notes:</b> {t.gaps!.join(" · ")}
                </div>
              )}

              {t.reconciliation && <ReconciliationSection recon={t.reconciliation} />}

              <CallBreakdown t={t} />

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

// The top-line the owner reads: live-transfer handoff outcomes, led by MISSED HANDOFF
// (the same definition the My Day board uses, so board + audit agree). Transcript-only
// classes render "needs key" rather than a misleading 0 while transcription is off.
function TransferHeadline({ s, transcriptionAvailable, inProgress }: { s: ReconSummary; transcriptionAvailable: boolean; inProgress: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-0.5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Live-transfer handoff — the numbers that matter</h3>
        {inProgress && <span className="text-[10px] text-amber-600 dark:text-amber-400">run in progress — numbers still filling in</span>}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        {s.live_transfer} live transfers this window (+ {s.realtime} real-time email leads, which are called back — no inbound
        expected). <b>Missed handoff</b> uses the same rule as the My Day board: a live transfer where no closer opened it and
        no conversation was captured within 15 minutes.
      </p>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Transfers received" value={`${s.transfers}`} sub={`${s.live_transfer} live · ${s.realtime} real-time`} />
        <Kpi label="Handoff captured" value={`${s.handoff_captured}`} tone={s.handoff_captured > 0 ? "good" : "neutral"} sub={`of ${s.live_transfer} live — closer connected`} />
        <Kpi label="⚠ Missed handoff" value={`${s.missed_handoff}`} tone={s.missed_handoff > 0 ? "bad" : "neutral"} sub={`board definition · ${s.missed_no_call} had no call at all`} />
        <Kpi label="⚡ Dropped at handoff" value={`${s.disconnected_at_handoff}`} tone={s.disconnected_at_handoff > 0 ? "bad" : "neutral"} sub="closer-flagged (human truth)" />
        <Kpi label="Suspect short drops" value={`${s.suspect_drop}`} tone={s.suspect_drop > 0 ? "warn" : "neutral"} sub="metadata proxy · review + flag" />
        <Kpi label="Replacement-eligible" value={`${s.replacement_eligible}`} tone={s.replacement_eligible > 0 ? "bad" : "neutral"} sub="defensible → demand replacement" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">Audio-confirmed (needs transcription):</span>
        <NeedsKeyTile label="Answered-then-kicked" value={s.answered_then_kicked} available={transcriptionAvailable} />
        <NeedsKeyTile label="Missed → voicemail" value={s.voicemail} available={transcriptionAvailable} />
      </div>
    </div>
  );
}

// A transcript-dependent metric: shows the real count when transcription is on, else an
// honest "needs key" chip instead of a 0 that reads as "we checked and found none".
function NeedsKeyTile({ label, value, available }: { label: string; value: number; available: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1">
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      {available
        ? <span className={`text-sm font-bold ${value > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>{value}</span>
        : <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">— needs transcription key</span>}
    </span>
  );
}

// The old call-level grid, demoted to a collapsible secondary breakdown. Transcript-only
// tiles use the "needs key" treatment so they never read as a misleading 0.
function CallBreakdown({ t }: { t: CallAuditRun["totals"] }) {
  const [open, setOpen] = useState(false);
  const available = t.transcription_available !== false;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40">
        {open ? <ChevronDownIcon className="w-4 h-4 text-gray-400" /> : <ChevronRightIcon className="w-4 h-4 text-gray-400" />}
        <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">Call-level breakdown</span>
        <span className="text-[11px] text-gray-400">{t.calls ?? 0} calls audited · {t.inbound ?? 0} in / {t.outbound ?? 0} out{t.closer_flagged_applied ? ` · ${t.closer_flagged_applied} closer overrides applied` : ""}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Calls audited" value={`${t.calls ?? 0}`} sub={`${t.inbound ?? 0} in · ${t.outbound ?? 0} out`} />
          <Kpi label="With recording" value={t.with_recording_pct != null ? `${t.with_recording_pct}%` : "—"} sub={`${t.with_recording ?? 0} of ${t.calls ?? 0}`} />
          <Kpi label="Mid-call drops" value={available ? `${t.mid_call_drop ?? 0}` : "—"} tone={(t.mid_call_drop ?? 0) > 0 ? "warn" : "neutral"} sub={available ? "dropped after 90s" : "needs transcription key"} />
          <Kpi label="Teardown (cosmetic)" value={available ? `${t.end_teardown_cosmetic ?? 0}` : "—"} sub={available ? "normal hang-up" : "needs transcription key"} />
          <Kpi label="Clean" value={available ? `${t.clean ?? 0}` : "—"} tone={(t.clean ?? 0) > 0 ? "good" : "neutral"} sub={available ? "no drop language" : "needs transcription key"} />
          <Kpi label="Internal (team) tests" value={`${t.internal_test ?? 0}`} sub="our own phones — excluded from drops" />
        </div>
      )}
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
          {c.meta?.closer_flagged && (
            <span className="ml-1 text-[10px] font-semibold text-red-600 dark:text-red-400" title="A closer flagged this call — human ground truth, overrides the audio guess">
              closer-flagged
            </span>
          )}
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

// ── Week-over-week trend — one mini bar series per failure class across runs ──────
// Answers the owner's question: did the Jul-24 phone fixes bend the curve? Uses the
// persisted run history (each run's totals), oldest → newest, last 12 runs.
const TREND_SERIES: { key: string; label: string; color: string; get: (t: CallAuditRun["totals"]) => number }[] = [
  { key: "dah", label: "Disconnected at handoff", color: "bg-red-600", get: (t) => t.disconnected_at_handoff ?? t.by_class?.disconnected_at_handoff ?? 0 },
  { key: "atk", label: "Answered-then-kicked", color: "bg-red-500", get: (t) => t.answered_then_kicked ?? 0 },
  { key: "vm", label: "Missed → voicemail", color: "bg-orange-500", get: (t) => t.missed_transfer_voicemail ?? 0 },
  { key: "mcd", label: "Mid-call drop", color: "bg-amber-500", get: (t) => t.mid_call_drop ?? 0 },
  { key: "sid", label: "Suspected instant drop*", color: "bg-amber-400", get: (t) => t.by_class?.suspected_instant_drop ?? 0 },
];

function TrendStrip({ runs }: { runs: CallAuditRun[] }) {
  // Completed runs only, chronological, most-recent 12.
  const series = runs.filter((r) => r.status === "done").slice(0, 12).reverse();
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
        Trend across runs — is the drop problem shrinking?
      </h4>
      {series.length < 2 ? (
        <p className="text-[12px] text-gray-400">
          Need at least 2 completed runs to show a trend. Run the audit on a few date ranges (or let the weekly
          cron accumulate them) and the week-over-week bars appear here.
        </p>
      ) : (
        <>
          <div className="space-y-2.5 mt-2">
            {TREND_SERIES.map((s) => {
              const vals = series.map((r) => s.get(r.totals));
              const max = Math.max(1, ...vals);
              const latest = vals[vals.length - 1];
              const prev = vals.length > 1 ? vals[vals.length - 2] : null;
              const delta = prev == null ? null : latest - prev;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-44 shrink-0 text-[11px] text-gray-600 dark:text-gray-300">{s.label}</div>
                  <div className="flex-1 flex items-end gap-1 h-10">
                    {series.map((r, i) => (
                      <div key={r.id} className="flex-1 flex items-end justify-center" title={`${new Date(r.created_at).toLocaleDateString()}: ${vals[i]}`}>
                        <div className={`w-full rounded-t ${s.color}`} style={{ height: `${vals[i] === 0 ? 2 : Math.max(6, Math.round((vals[i] / max) * 40))}px`, opacity: vals[i] === 0 ? 0.25 : 1 }} />
                      </div>
                    ))}
                  </div>
                  <div className="w-24 shrink-0 text-right text-[11px] text-gray-600 dark:text-gray-300">
                    <span className="font-semibold text-gray-900 dark:text-white">{latest}</span>
                    {delta != null && delta !== 0 && (
                      <span className={delta < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}> {delta < 0 ? "▼" : "▲"}{Math.abs(delta)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Oldest → newest ({series.length} runs). *Suspected instant drop is the metadata stand-in for answered-then-kicked
            while transcription is off — it's the bar to watch until a Gemini key is added.
          </p>
        </>
      )}
    </div>
  );
}

// ── Transfer reconciliation — paid Synergy transfers vs the inbound call that landed ─
const BUCKET_META: Record<string, { label: string; chip: string }> = {
  disconnected_at_handoff: { label: "Disconnected at handoff", chip: "bg-red-600 text-white dark:bg-red-600 dark:text-white ring-1 ring-red-300 dark:ring-red-400" },
  no_call: { label: "No call at all", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  answered_then_kicked: { label: "Answered then kicked", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  voicemail: { label: "Our voicemail", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  suspect_drop: { label: "Suspect drop", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  connected: { label: "Connected", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

function ReconciliationSection({ recon }: { recon: ReconResult }) {
  const [open, setOpen] = useState(false);
  const s = recon.summary;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h4 className="font-semibold text-gray-900 dark:text-white">Transfer reconciliation — did the paid transfers connect?</h4>
        <p className="text-[11px] text-gray-400">
          Each Synergy intake email matched to the inbound call that landed (by merchant phone, else timestamp ±10 min).
          {s.transfers > 0 && <> {s.matched_by_phone} matched by phone, {s.matched_by_time} by time.</>}
        </p>
      </div>
      <div className="p-4 space-y-3">
        {/* Match provenance — of the missed handoffs, how many had no inbound call vs a call
            that never became a conversation. The headline tiles above carry the counts. */}
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Of {s.missed_handoff} missed handoffs, <b>{s.missed_no_call}</b> had no inbound call at all and the rest had a call
          that never became a captured conversation. {s.disconnected_at_handoff} were closer-flagged as dropped at handoff.
        </p>

        {/* Replacement-eligible — the list the owner sends Synergy to demand replacements. */}
        <ReplacementEligible eligible={recon.eligible ?? []} suspects={recon.suspects?.length ?? 0} win={recon.window} />

        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-[12px] text-ocean-blue hover:underline">
          {open ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
          {open ? "Hide" : "Show"} per-transfer detail ({recon.rows.length})
        </button>

        {open && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">Transfer (ET)</th>
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">Call class</th>
                    <th className="px-3 py-2 font-medium">Gap</th>
                    <th className="px-3 py-2 font-medium">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {recon.rows.map((r, i) => {
                    const bm = BUCKET_META[r.bucket] ?? { label: r.bucket, chip: "bg-gray-100 text-gray-600" };
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-200">{dateTimeET(r.received_at)}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[180px] truncate">{r.merchant}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{r.kind === "live_transfer" ? "live" : r.kind === "realtime_appt" ? "real-time" : r.kind}</td>
                        <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${bm.chip}`}>{bm.label}</span></td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{r.call_class ? CALL_CLASS_LABELS[r.call_class] : "—"}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{r.gap_s == null ? "—" : `${r.gap_s > 0 ? "+" : ""}${r.gap_s}s`}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{r.call_class == null ? "—" : r.phone_match ? "phone" : "time"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Replacement-eligible transfers — what the owner sends Synergy ────────────────
// Defensible failures only (closer-flagged handoff drop, no call received, answered-
// then-kicked, voicemail). Metadata-only suspects are held back (Carlos flags them
// on the call to promote). "Copy for vendor email" yields a clean paste-able list.
const EVIDENCE_LABEL: Record<EligibleRow["bucket"], string> = {
  disconnected_at_handoff: "closer-flagged: disconnected at handoff",
  no_call: "no call received (missed handoff)",
  answered_then_kicked: "answered then kicked from conference",
  voicemail: "rang to our voicemail",
};

// Compact ET date-time for the paste-able list (no "ET" suffix — the header says it).
function dateTimeETPlain(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

function buildVendorEmailText(eligible: EligibleRow[], win: { from: string; to: string }): string {
  const header =
    `Replacement requests — ${eligible.length} live transfer${eligible.length === 1 ? "" : "s"} that failed at handoff ` +
    `(${win.from} to ${win.to}, times ET). Requesting replacement transfers, not refunds:`;
  const lines = eligible.map((r) =>
    `${dateTimeETPlain(r.received_at)} · ${r.merchant} · ${r.phone ?? "no phone"} · ${r.evidence ?? EVIDENCE_LABEL[r.bucket]}`
  );
  return [header, "", ...lines].join("\n");
}

function ReplacementEligible({ eligible, suspects, win }: { eligible: EligibleRow[]; suspects: number; win: { from: string; to: string } }) {
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  async function copyForVendor() {
    setCopyErr(null);
    try {
      await navigator.clipboard.writeText(buildVendorEmailText(eligible, win));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopyErr(e instanceof Error ? e.message : "Clipboard copy failed");
    }
  }

  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/15 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="font-semibold text-red-800 dark:text-red-300">
            Replacement-eligible ({eligible.length})
          </h5>
          <p className="text-[11px] text-red-700/80 dark:text-red-300/70">
            <b>Live transfers only</b> — closer-flagged handoff drops, no-call misses, answered-then-kicked, voicemail.
            (Real-time appointments are a callback model — no inbound call is expected — so they're never counted here.)
            Send these to the vendor to demand <b>replacement transfers</b> (not refunds).
            {suspects > 0 && <> {suspects} metadata suspect{suspects === 1 ? "" : "s"} are held back below — have Carlos flag any real ones on the call.</>}
          </p>
        </div>
        <button
          onClick={copyForVendor}
          disabled={eligible.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-[12px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40"
        >
          {copied ? <><CheckIcon className="w-4 h-4 text-emerald-500" /> Copied ✓</> : <><ClipboardDocumentIcon className="w-4 h-4" /> Copy for vendor email</>}
        </button>
      </div>
      {copyErr && <p className="text-[11px] text-red-600 dark:text-red-400">{copyErr}</p>}
      {eligible.length === 0 ? (
        <p className="text-[12px] text-gray-500 dark:text-gray-400">No replacement-eligible transfers in this window — every paid transfer connected or is only a metadata suspect.</p>
      ) : (
        <div className="rounded-lg border border-red-200 dark:border-red-800 overflow-hidden bg-white dark:bg-gray-800">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-red-50 dark:bg-red-900/25 text-red-700/80 dark:text-red-300/80 uppercase text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Transfer (ET)</th>
                  <th className="px-3 py-2 font-medium">Merchant</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100 dark:divide-red-900/40">
                {eligible.map((r, i) => (
                  <tr key={i} className="hover:bg-red-50/50 dark:hover:bg-red-900/20">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-200">{dateTimeET(r.received_at)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[180px] truncate">{r.merchant}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-[11px] font-medium text-red-700 dark:text-red-300">{r.evidence ?? EVIDENCE_LABEL[r.bucket]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
