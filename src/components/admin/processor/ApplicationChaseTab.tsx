// ApplicationChaseTab — the processor's application chase, as five queues that
// each name the next thing to chase.
//
// THE OWNER'S ASK (2026-09-17): "for the processor, i'd love to have a tab on the
// processor page that shows who has a partial application, completed application
// (but unsigned), signed application, bank statements submitted, go/no go...
// it needs to be clear that for everyone in those buckets she needs to be
// chasing... if it is partial then she needs to be chasing getting the completed
// application... if it is completed then she needs to be chasing the signature...
// we also need the 14 day countdown and basically all of the things that are in
// the 'Hot Realtime Leads' tab so that she can easily see what she needs to do
// and execute on it from right there."
//
// So: the bucket bar shows counts AND the instruction, every row carries the
// 14-day tracker, the dial history and the whole action set inline, and nothing
// on this tab sends her to another screen to do the work.
//
// ── WHY THIS TAB EXISTS AT ALL ──────────────────────────────────────────────
// Measured live 2026-09-17: 63 deals carry an application_sent_at, and of those
// only 16 have a signed application on file. The stage chip alone was telling
// the team those deals had moved when the merchant had not put pen to paper, so
// "Complete but UNSIGNED" is the loudest bucket here, by instruction.
//
// TWO THINGS TURNED OUT NOT TO BE TRUE OF THAT HEADLINE, and both shaped the UI:
//
//  1. Four of the 63 "sends" were never sends. The VibeReach opportunity mirror
//     created the deal already in the Application Sent stage and the stage
//     trigger back-stamped it inside the insert — application_sent_at lands
//     12-15 MILLISECONDS before created_at, with no sending user and no draft.
//     born_at_application_sent flags them. They are kept OUT of the signature
//     bucket (isRealSend), carry a "⚠ no send on record" chip wherever they
//     land, and show no send date, no days-since-sent and no sender — there is
//     no send to describe. MF-2026-0324 is still sitting at status
//     application_sent with nothing ever sent to anybody; without this the
//     processor would be chasing a signature on it.
//
//  2. Absence of a signature briefly could not be trusted at all.
//     ghl_doc_completions was a lazy mirror written only when a human opened a
//     contact's documents — 16 of 339 customers ever. ghl-doc-sweep now reads
//     every completed document in the account in two API calls, hourly, and
//     'unchecked' is normally zero. The unknown branch stays because a crawl can
//     fail, and on that day the honest output is "we don't know", not fifty
//     accusations. There is deliberately NO "check this one merchant" button:
//     the GHL proposals API rejects contactId / contact_id / recipientId, so it
//     would have nothing to call.
//
// ── NOTHING HERE IS FORKED ──────────────────────────────────────────────────
//   · ChaseTracker       — the 14-day tracker, extracted from HotLeadsPanel.
//   · LeadActionsDrawer  — the whole "Work this lead" action set, extracted from
//                          HotLeadsPanel (Quick App, application, send docs, DND,
//                          text, email, book, log the call, notes).
//   · loadCallHistory    — the true multi-dialer call union, extracted likewise.
//   · applicationCompleteness (via chaseVerdict) — the modal's own definition of
//                          partial-vs-complete, not a second one.
//   · ApplicationSignatureBadge — the shared signed/unsigned badge.
//
// ── UNREADABLE IS NEVER ZERO, AND NEVER "NO" ────────────────────────────────
// A failed queue read renders a red "this is not an empty queue" box, never an
// empty tab. A merchant whose e-signed documents have not been read renders
// "Signature unknown" in amber — never the red UNSIGNED badge, which is in
// practice an accusation that the signature was not chased. A failed
// call-history read suppresses the tracker rather than painting fourteen red
// days over a merchant somebody called every morning. And a send we cannot
// account for is never counted, dated, attributed or chased as though it were
// one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PhoneIcon,
  WrenchScrewdriverIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { dateTimeET } from "@/utils/time";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { QUEUE_CLOSED_STATUSES } from "@/services/dealService";
import ChaseTracker from "@/components/admin/shared/ChaseTracker";
import LeadActionsDrawer from "@/components/admin/shared/LeadActionsDrawer";
import ApplicationSignatureBadge from "@/components/admin/ApplicationSignatureBadge";
import { signatureFromQueueRow, type SignatureState } from "@/lib/applicationSignature";
import {
  chaseVerdict,
  chaseInstruction,
  CHASE_BUCKETS,
  CHASE_BUCKET_ORDER,
  type ChaseBucket,
  type ChaseVerdict,
} from "@/lib/applicationChase";
import {
  isAttributionRecorded,
  isAttributionAssumed,
  isRealSend,
  type ApplicationQueueRow,
} from "@/lib/applicationQueueRow";
import {
  loadCallHistory,
  CALL_SOURCE_WORD,
  type CallHistory,
  type HistoryState,
} from "@/lib/callHistory";

// The row type and the completeness adapter are the DATA LAYER's contract
// (src/lib/applicationQueueRow.ts, written alongside the RPC). This tab imports
// them rather than restating the column list — a second copy of a 30-column
// contract is a drift bug waiting to happen.
type ChaseRow = ApplicationQueueRow;

type QueueState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: ChaseRow[] };

/** A row plus everything derived from it, computed once. */
interface ScoredRow {
  r: ChaseRow;
  v: ChaseVerdict;
  signature: SignatureState;
  hist: CallHistory | null;
}

const PARKED = new Set<string>(QUEUE_CLOSED_STATUSES);

function stageChip(status: string | null) {
  const cfg = status ? DEAL_STATUS_CONFIG[status as DealStatus] : undefined;
  return {
    label: cfg?.label ?? status ?? "—",
    cls: cfg
      ? `${cfg.bgColor} ${cfg.color}`
      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  };
}

function prettyPhone(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return "";
  const d = s.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : s;
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const merchantLabel = (r: ChaseRow) =>
  (r.merchant_name ?? "").trim() || r.deal_number || "Unnamed merchant";

const phoneOf = (r: ChaseRow) => prettyPhone(r.app_fields?.customer?.phone);
const rawPhoneOf = (r: ChaseRow) => {
  const p = r.app_fields?.customer?.phone;
  return typeof p === "string" ? p : "";
};

export default function ApplicationChaseTab({
  onOpen,
  onQuickApp,
  onChanged,
}: {
  /** Open the merchant in the Processor cockpit drawer. */
  onOpen: (dealId: string) => void;
  /** Launch the page's Quick App modal for this deal. */
  onQuickApp: (dealId: string) => void;
  /** Something changed — let the page re-read its own counts too. */
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<QueueState>({ kind: "loading" });
  const [history, setHistory] = useState<HistoryState>({ kind: "loading" });
  const [bucket, setBucket] = useState<ChaseBucket | "all">("unsigned");
  const [search, setSearch] = useState("");
  const [includeParked, setIncludeParked] = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Inline two-step confirm — no browser popups (owner's standing rule).
  const [nurtureArmed, setNurtureArmed] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const armTimer = useRef<number | null>(null);
  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setQueue({ kind: "loading" });
    const { data, error } = await supabase.rpc("processor_application_queue");
    if (error) {
      // UNREADABLE ≠ an empty chase list.
      setQueue({ kind: "error", message: error.message });
      setHistory({ kind: "error", message: "the queue itself could not be read" });
      return;
    }
    const rows = (data ?? []) as unknown as ChaseRow[];
    setQueue({ kind: "ready", rows });
    setNow(Date.now());

    setHistory(await loadCallHistory(rows.map((r) => r.deal_id)));
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Ticks the "N ago" clocks.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reload = useCallback(() => {
    void load(false);
    onChanged();
  }, [load, onChanged]);

  const scored = useMemo<ScoredRow[]>(() => {
    const rows = queue.kind === "ready" ? queue.rows : [];
    const byDeal = history.kind === "ready" ? history.byDeal : null;
    return rows.map((r) => {
      const signature = signatureFromQueueRow(r);
      return {
        r,
        signature,
        // null = UNREADABLE, never "no calls" — see loadCallHistory.
        hist: byDeal ? (byDeal[r.deal_id] ?? null) : null,
        v: chaseVerdict(r, signature),
      };
    });
  }, [queue, history]);

  /** Parked deals are noise on a chase board — nothing to chase on a funded or
   *  nurtured merchant — but they are hidden behind a toggle, never dropped
   *  silently. */
  const inScope = useMemo(
    () => (includeParked ? scored : scored.filter((s) => !PARKED.has(s.r.deal_status ?? ""))),
    [scored, includeParked],
  );

  const counts = useMemo(() => {
    const c: Record<ChaseBucket, { total: number; unproven: number }> = {
      partial: { total: 0, unproven: 0 },
      unsigned: { total: 0, unproven: 0 },
      signed: { total: 0, unproven: 0 },
      statements: { total: 0, unproven: 0 },
      decided: { total: 0, unproven: 0 },
    };
    for (const s of inScope) {
      c[s.v.bucket].total += 1;
      if (!s.v.signatureKnown) c[s.v.bucket].unproven += 1;
    }
    return c;
  }, [inScope]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inScope
      .filter((s) => {
        if (bucket !== "all" && s.v.bucket !== bucket) return false;
        if (!q) return true;
        const hay = [
          s.r.merchant_name,
          s.r.deal_number,
          s.r.assigned_closer_name,
          phoneOf(s.r),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      // Longest-rotting first, with one exception that outranks everything: a
      // row whose SEND RECORD is missing sorts to the very top of its bucket.
      // Those are the ones nobody can reason about from the pipeline — a signed
      // application with no send (MF-2026-0113) or a stage stamped by the mirror
      // (MF-2026-0324) — and they stay invisible precisely because their clocks
      // read as normal. Their day count is meaningless, so it can't rank them.
      .sort((a, b) => {
        const anomaly = (s: ScoredRow) => (s.v.realSend ? 0 : 1);
        const days = (s: ScoredRow) => s.r.days_since_app_sent ?? -1;
        const sent = (s: ScoredRow) => {
          const t = s.r.app_sent_at ? Date.parse(s.r.app_sent_at) : NaN;
          return Number.isFinite(t) ? t : 0;
        };
        return anomaly(b) - anomaly(a) || days(b) - days(a) || sent(a) - sent(b);
      });
  }, [inScope, bucket, search]);

  const armOrFireNurture = useCallback(
    (dealId: string) => {
      if (armTimer.current) window.clearTimeout(armTimer.current);
      if (nurtureArmed !== dealId) {
        setNurtureArmed(dealId);
        armTimer.current = window.setTimeout(() => setNurtureArmed(null), 4000);
        return;
      }
      setNurtureArmed(null);
      setRowBusy(dealId);
      setRowErr(null);
      void (async () => {
        try {
          const { error } = await supabase.rpc("processor_move_to_nurture", { p_deal_id: dealId });
          if (error) throw new Error(error.message);
          // Push the park to VibeReach, exactly as the Processor board does —
          // best-effort, but the failure is SHOWN so a half-applied park is never
          // silent. (processor_move_to_nurture writes our deals row only.)
          try {
            const { error: syncErr } = await supabase.functions.invoke("ghl-sync", {
              body: { entity: "deal", id: dealId },
            });
            if (syncErr) {
              setRowErr(
                `Moved to nurture here, but VibeReach did not update — they may still be dialed. (${syncErr.message})`,
              );
            }
          } catch (e) {
            setRowErr(
              `Moved to nurture here, but VibeReach did not update — they may still be dialed. (${e instanceof Error ? e.message : "sync failed"})`,
            );
          }
          reload();
        } catch (e) {
          setRowErr(e instanceof Error ? e.message : "Couldn't move to nurture.");
        } finally {
          setRowBusy(null);
        }
      })();
    },
    [nurtureArmed, reload],
  );

  /** Visible rows whose signature status we cannot vouch for. */
  const unconfirmedVisible = useMemo(
    () => visible.filter((s) => !s.v.signatureKnown).length,
    [visible],
  );

  const loading = queue.kind === "loading";

  return (
    <div className="space-y-4">
      {/* Mission line — the tab in one sentence. */}
      <div className="rounded-xl border border-red-300/70 dark:border-red-800/60 bg-red-50/60 dark:bg-red-950/20 p-4">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">
          Every merchant you are chasing, and what you are chasing them for
        </h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          A <span className="font-bold">sent</span> application is not a{" "}
          <span className="font-bold">signed</span> one.{" "}
          <span className="underline decoration-2 decoration-red-500 font-bold">
            A complete application sitting unsigned is a deal stopped dead
          </span>{" "}
          — that bucket is the loudest one below on purpose. Anything marked{" "}
          <span className="font-bold text-amber-700 dark:text-amber-300">⚠ no send on record</span>{" "}
          sorts to the top of its bucket: the stage says sent but nothing of ours
          ever went out, so it needs sending or closing, not chasing. Pick a
          bucket, work the rows: everything you need is on the row.
        </p>
      </div>

      {/* ── THE BUCKET BAR. Count + dollars of work + the instruction. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {CHASE_BUCKET_ORDER.map((key) => {
          const meta = CHASE_BUCKETS[key];
          const active = bucket === key;
          const c = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setBucket(key)}
              aria-pressed={active}
              className={`text-left rounded-xl border bg-white dark:bg-gray-800 p-3 transition-colors ${
                active
                  ? `${meta.ring} ring-1 ring-current`
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <div
                className={`text-2xl font-bold tabular-nums ${active ? meta.dot : "text-gray-900 dark:text-white"}`}
              >
                {queue.kind === "ready" ? c.total.toLocaleString() : "—"}
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 leading-tight">
                {meta.label}
              </div>
              <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 leading-tight">
                → {meta.chase}
              </div>
              {/* How many of these we CANNOT prove a signature state for. Shown
                  rather than folded into the headline number. */}
              {queue.kind === "ready" && c.unproven > 0 && (
                <div
                  className="mt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 leading-tight"
                  title="For these, the merchant's e-signed documents have never been checked. They are in this bucket because there is still work to do, but nobody has proven they failed to sign."
                >
                  {c.unproven} unconfirmed signature{c.unproven === 1 ? "" : "s"}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, deal #, closer…"
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white w-64"
            />
          </div>
          <button
            type="button"
            onClick={() => setBucket("all")}
            aria-pressed={bucket === "all"}
            className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
              bucket === "all"
                ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue"
            }`}
          >
            Show every bucket
          </button>
          <button
            type="button"
            onClick={() => setIncludeParked((v) => !v)}
            aria-pressed={includeParked}
            className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
              includeParked
                ? "border-gray-500 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-500"
            }`}
            title="Funded, nurtured, declined and dead deals — nothing left to chase, hidden by default but never dropped without saying so."
          >
            {includeParked ? "Hiding nothing" : "Include closed-out deals"}
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {rowErr && (
          <div className="mb-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {rowErr}
          </div>
        )}

        {/* UNCONFIRMED SIGNATURES — say why, and say what fixes it.
            There is NO per-contact signature lookup to offer: the GHL proposals
            API rejects contactId / contact_id / recipientId outright, so a
            "check this one merchant" button would have nothing to call. What
            refreshes this is ghl-doc-sweep, which reads every completed document
            in the account in two API calls and runs hourly. Since it went live
            this count is normally zero — it reappears only when a crawl fails or
            for a merchant outside the sweep's reach, which is exactly when the
            processor needs to be told rather than quietly shown "unsigned". */}
        {queue.kind === "ready" && unconfirmedVisible > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-bold">
                {unconfirmedVisible} of these merchants have no confirmed signature status.
              </div>
              <div className="mt-0.5">
                For these we genuinely <b>cannot say</b> whether the application came back —
                telling you they didn't sign would send you chasing signatures some of them may
                already have given. The hourly signature sweep normally settles this on its own;
                if the number stays up, the sweep is failing and somebody should look.
              </div>
            </div>
          </div>
        )}

        {/* A failed CALL-history read must not silently become "never dialed". */}
        {history.kind === "error" && queue.kind === "ready" && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Couldn't read the call history.</div>
              <div className="mt-0.5">
                The 14-day trackers are hidden rather than drawn from a read that failed — a
                tracker built from this would paint red days over merchants somebody called.
                Don't conclude anyone failed to call.
              </div>
              <div className="mt-0.5 font-mono opacity-80">{history.message}</div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-10">
            <span className="loading loading-spinner loading-sm" /> Reading the application queue…
          </div>
        )}

        {queue.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Couldn't load the application queue.</div>
              <div className="mt-0.5">
                This is <b>not</b> an empty chase list — it's an unreadable one. There may be
                merchants sitting on unsigned applications that this tab cannot see right now.
              </div>
              <div className="mt-0.5 font-mono opacity-80">{queue.message}</div>
              <button
                type="button"
                onClick={() => void load(true)}
                className="mt-1.5 font-semibold text-ocean-blue hover:underline"
              >
                Try again →
              </button>
            </div>
          </div>
        )}

        {queue.kind === "ready" && (
          <>
            <div className="text-[11px] text-gray-400 mb-2">
              Showing {visible.length.toLocaleString()} of {inScope.length.toLocaleString()}{" "}
              {bucket === "all" ? "merchants in the chase" : `in ${CHASE_BUCKETS[bucket].label}`}
              {!includeParked && scored.length > inScope.length && (
                <> · {scored.length - inScope.length} closed-out deal(s) hidden</>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Nothing in this bucket.
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This read succeeded — nothing matches right now. Pick another bucket above.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {visible.map((s) => (
                  <ChaseRowCard
                    key={s.r.deal_id}
                    s={s}
                    now={now}
                    actionsOpen={openActions === s.r.deal_id}
                    onToggleActions={() =>
                      setOpenActions((v) => (v === s.r.deal_id ? null : s.r.deal_id))
                    }
                    onOpen={onOpen}
                    onQuickApp={onQuickApp}
                    onChanged={reload}
                    nurtureArmed={nurtureArmed === s.r.deal_id}
                    onNurture={() => armOrFireNurture(s.r.deal_id)}
                    busy={rowBusy === s.r.deal_id}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * How an app-sent attribution is presented.
 *
 * Owner ruling (via the data layer's ladder in applicationQueueRow.ts): every
 * sent application shows a name, but a name that came from a FALLBACK must never
 * render like a name that came from a RECORD. Only `recorded` is asserted
 * plainly; everything below it is drawn dashed, prefixed "≈", and says in its
 * tooltip exactly what evidence produced it. 36 of the 63 sends on the board are
 * reconstructions, so this is the common case, not the edge case.
 */
function AttributionChip({ r }: { r: ChaseRow }) {
  // No send → nobody to attribute. TWO distinct cases reach here: never stamped
  // at all, and a PHANTOM stamp the VibeReach mirror wrote at deal creation.
  // Before born_at_application_sent existed, MF-2026-0324 rendered "sent by
  // Carlos Marquez (assumed)" — a fabricated name on an event that never
  // happened. The row's own "no send on record" chip says what actually holds.
  if (!isRealSend(r)) return null;
  const who = r.app_sent_by_name?.trim();
  const mode = r.app_sent_attribution;
  const basis = r.app_sent_attribution_basis ? ` (${r.app_sent_attribution_basis})` : "";

  if (isAttributionRecorded(mode)) {
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        title={`Recorded at the moment the application was sent${basis} — a fact we wrote down, not a reconstruction.`}
      >
        sent by {who || "someone"}
      </span>
    );
  }

  // No evidence at all — this is just whoever the deal happens to be assigned to
  // now. It must not read as a claim about who sent anything.
  if (isAttributionAssumed(mode)) {
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-gray-400 text-gray-500 dark:text-gray-400"
        title={
          `Nobody recorded who sent this application and there is no activity-log evidence either${basis}.` +
          (who
            ? ` "${who}" is simply the closer the deal is assigned to right now — not a claim that they sent it.`
            : "")
        }
      >
        ≈ sender not recorded{who ? ` · ${who}'s deal` : ""}
      </span>
    );
  }

  // inferred / inferred_same_day — reconstructed from who was active on the deal.
  const sameDay = mode === "inferred_same_day";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-900/20"
      title={
        `We did NOT record who sent this application. This name was reconstructed after the fact from who was active on the deal ` +
        (sameDay ? "within about a day" : "within about ten minutes") +
        ` of the send${basis} — our best reading of what happened, not a recorded fact. Don't settle an argument with it.`
      }
    >
      ≈ probably {who || "unknown"}
      {sameDay ? " · same-day guess" : " · inferred"}
    </span>
  );
}

function ChaseRowCard({
  s,
  now,
  actionsOpen,
  onToggleActions,
  onOpen,
  onQuickApp,
  onChanged,
  nurtureArmed,
  onNurture,
  busy,
}: {
  s: ScoredRow;
  now: number;
  actionsOpen: boolean;
  onToggleActions: () => void;
  onOpen: (dealId: string) => void;
  onQuickApp: (dealId: string) => void;
  onChanged: () => void;
  nurtureArmed: boolean;
  onNurture: () => void;
  busy: boolean;
}) {
  const { r, v, signature, hist } = s;
  const meta = CHASE_BUCKETS[v.bucket];
  const chip = stageChip(r.deal_status);
  const phone = phoneOf(r);
  const days = r.days_since_app_sent;
  const overdue = days !== null && days >= 14;

  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 px-3 py-2 ${meta.ring.split(" ")[0]} ${meta.rowTone}`}
    >
      {/* Line 1 — who, where, and IS IT SIGNED. */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={() => onOpen(r.deal_id)}
            className="text-sm font-bold text-gray-900 dark:text-white hover:text-ocean-blue truncate max-w-[18rem] text-left"
            title="Open the work cockpit"
          >
            {merchantLabel(r)}
          </button>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${chip.cls}`}>
            {chip.label}
          </span>
          {r.deal_number && <span className="text-[10px] text-gray-400">#{r.deal_number}</span>}
          {/* THE BADGE. Every surface that says "application sent" now says this too. */}
          <ApplicationSignatureBadge signature={signature} sentAt={r.app_sent_at} />
          {/* NO SEND ON RECORD. Four live deals carry an application_sent_at the
              VibeReach mirror stamped during deal creation — 12-15ms BEFORE
              created_at, no sending user, no draft. They are spread across
              buckets (3 partial, 1 statements today), so the chip goes on the
              row rather than being implied by one bucket.
              It means "we have no record of sending it", NOT "the merchant never
              got it": MF-2026-0273 is flagged AND signed, so a send happened
              inside GHL. The wording says which. */}
          {v.phantomSend && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ring-1 ring-inset ring-amber-300 dark:ring-amber-800"
              title={
                (r.app_sent_attribution_basis ??
                  "The Application Sent stage was stamped by the VibeReach opportunity mirror when this deal was created, not by a send we made.") +
                (signature.kind === "signed"
                  ? " The merchant HAS signed, so a send did happen — inside VibeReach, outside our record. Do not re-send."
                  : " No application left our system and no draft exists.")
              }
            >
              ⚠ no send on record
            </span>
          )}
          {/* Signed with no stamp at all — MF-2026-0113 signed 2026-07-22 while
              the deal still sits at 'contacted'. Same class of gap, other way up. */}
          {!v.phantomSend && v.neverSent && signature.kind === "signed" && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ring-1 ring-inset ring-amber-300 dark:ring-amber-800"
              title="The merchant signed the application, but nothing in our system ever recorded sending it — the send happened inside VibeReach. Don't re-send; the record needs fixing."
            >
              ⚠ signed, but no send on record
            </span>
          )}
          {r.do_not_contact && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white"
              title="This merchant asked not to be contacted — do not call, text, or email."
            >
              🚫 DO NOT CONTACT
            </span>
          )}
        </div>
        {/* THE 14-DAY CLOCK, in words — but only where a send actually happened.
            A phantom carries an application_sent_at that is really the moment the
            VibeReach mirror created the deal, so "8d since sent" would be a
            measurement of nothing. */}
        <span
          className={`text-[11px] font-bold shrink-0 tabular-nums ${
            !v.realSend
              ? "text-amber-700 dark:text-amber-300"
              : overdue
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400"
          }`}
          title={
            v.phantomSend
              ? r.app_sent_attribution_basis ??
                "The Application Sent stage was stamped by the VibeReach mirror when this deal was created, not by a send we made."
              : v.realSend && r.app_sent_at
                ? `Application sent ${dateTimeET(r.app_sent_at)}`
                : "No application has been sent to this merchant."
          }
        >
          {!v.realSend
            ? "⚠ no send on record"
            : days === null
              ? "sent"
              : overdue
                ? `${days}d since sent — 14 days up`
                : `${days}d since sent · ${14 - days}d left`}
        </span>
      </div>

      {/* Line 2 — WHAT TO CHASE. The reason this tab exists. */}
      <div className="mt-1 flex items-start gap-1.5 flex-wrap">
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${meta.chipTone}`}
        >
          {meta.chase}
        </span>
        <span className="text-[11px] text-gray-700 dark:text-gray-200">{chaseInstruction(v)}</span>
      </div>

      {/* Line 3 — the working facts. */}
      <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
        {/* attempts_since_sent counts dials at or after application_sent_at — so
            on a PHANTOM it would count from the moment the mirror created the
            deal and then label that "since it was sent". "NOT CHASED SINCE IT
            WAS SENT" is an accusation, and it may not be made about a send that
            never happened. */}
        <span
          className={`font-bold ${
            v.realSend && (r.attempts_since_sent ?? 0) === 0
              ? "text-red-600 dark:text-red-400"
              : "text-gray-700 dark:text-gray-200"
          }`}
          title={
            v.realSend
              ? "Real dials on this merchant since the application went out — WAVV, VibeReach/LeadConnector and anything logged by hand, deduped."
              : "No send to count from, so there is no since-sent figure. Open the merchant to see their full call history."
          }
        >
          📞{" "}
          {!v.realSend
            ? "—"
            : (r.attempts_since_sent ?? 0) === 0
              ? "NOT CHASED SINCE IT WAS SENT"
              : `${r.attempts_since_sent} call${r.attempts_since_sent === 1 ? "" : "s"} since sent`}
        </span>
        {r.last_attempt_at ? (
          <span className="text-gray-600 dark:text-gray-300">
            last called <b className="font-semibold">{dateTimeET(r.last_attempt_at)}</b>{" "}
            <span className="text-gray-400 dark:text-gray-500">({ago(r.last_attempt_at, now)})</span>
            {hist?.last_by ? ` · ${hist.last_by}` : ""}
            {hist?.last_source && CALL_SOURCE_WORD[hist.last_source]
              ? ` · ${CALL_SOURCE_WORD[hist.last_source]}`
              : ""}
          </span>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">no call on record yet</span>
        )}
        {signature.kind === "signed" && r.app_signed_at && (
          <span
            className="font-semibold text-emerald-700 dark:text-emerald-300"
            title={`The merchant signed ${dateTimeET(r.app_signed_at)}. This is their real signature time from the VibeReach e-sign record, not when our copy noticed it.`}
          >
            ✍️ signed {ago(r.app_signed_at, now)}
          </span>
        )}
        {r.last_conversation_at && (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            🗣 spoke {dateTimeET(r.last_conversation_at)}
          </span>
        )}
        {(r.statements_count ?? 0) > 0 && (
          <span
            className="font-semibold text-sky-700 dark:text-sky-300"
            title={
              r.statements_last_at
                ? `Newest bank statement uploaded ${dateTimeET(r.statements_last_at)}`
                : undefined
            }
          >
            🏦 {r.statements_count} bank statement{r.statements_count === 1 ? "" : "s"}
          </span>
        )}
        {r.qa_decision && (
          <span
            className={`font-bold uppercase ${
              r.qa_decision === "go"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
            title={r.qa_decision_reason ?? undefined}
          >
            {r.qa_decision === "go" ? "GO" : "NO-GO"}
            {r.qa_decided_at ? ` · ${dateTimeET(r.qa_decided_at)}` : ""}
          </span>
        )}
        <AttributionChip r={r} />
        {r.assigned_closer_name && (
          <span className="text-gray-400">assigned {r.assigned_closer_name}</span>
        )}
      </div>

      {/* The 14-day chase, per day. Needs BOTH a readable call history and a real
          send to count from — a phantom's stamp is the mirror's clock, not ours. */}
      {hist && v.realSend && r.app_sent_at && (
        <ChaseTracker startAt={r.app_sent_at} calls={hist.calls} label="14-day chase since sent" />
      )}

      {/* ── THE ACTION BAR — she executes from right here. ── */}
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {phone && (
          <a
            href={`tel:${rawPhoneOf(r).replace(/[^0-9+]/g, "")}`}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            title={`Dial ${phone} — then log the outcome under "Work this lead"`}
          >
            <PhoneIcon className="w-3 h-3" />
            {phone}
          </a>
        )}
        <button
          type="button"
          onClick={() => onQuickApp(r.deal_id)}
          title="Quick App — fast mandatory-only application"
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white hover:bg-amber-600"
        >
          <BoltIcon className="w-3 h-3" /> Quick App
        </button>
        <button
          type="button"
          onClick={onToggleActions}
          aria-expanded={actionsOpen}
          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full transition-colors ${
            actionsOpen
              ? "bg-ocean-blue text-white"
              : "bg-ocean-blue/10 text-ocean-blue hover:bg-ocean-blue/20 dark:bg-ocean-blue/20"
          }`}
          title="Application, text, email, send docs, log the call, set a callback or appointment, nurture, DND — without leaving this tab"
        >
          <WrenchScrewdriverIcon className="w-3 h-3" />
          {actionsOpen ? "Hide actions" : "Work this lead"}
          {actionsOpen ? (
            <ChevronDownIcon className="w-3 h-3" />
          ) : (
            <ChevronRightIcon className="w-3 h-3" />
          )}
        </button>
        <Link
          to={`/admin/playbooks?deal=${r.deal_id}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue transition-colors"
          title="Open this merchant's Revenue Playbook"
        >
          Playbook <ArrowTopRightOnSquareIcon className="w-3 h-3" />
        </Link>
        {/* Nurture — inline two-step arm/confirm, no browser popup. */}
        <button
          type="button"
          disabled={busy}
          onClick={onNurture}
          title="Move to long-term nurture"
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
            nurtureArmed
              ? "border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
              : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-300"
          }`}
        >
          <MoonIcon className="w-3 h-3" />
          {nurtureArmed ? "Confirm?" : "Nurture"}
        </button>
      </div>

      {actionsOpen && <LeadActionsDrawer dealId={r.deal_id} onDealChanged={onChanged} />}
    </div>
  );
}
