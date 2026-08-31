import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BuildingStorefrontIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  StarIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import useIsProcessor from "@/hooks/useIsProcessor";
import TextMerchantPanel from "@/components/admin/TextMerchantPanel";
import StageHistogram, { type CountsState } from "@/components/admin/processor/StageHistogram";
import SchedulePicker from "@/components/admin/processor/SchedulePicker";
import ProcessorDetailDrawer from "@/components/admin/processor/ProcessorDetailDrawer";
import GateTracker from "@/components/admin/processor/GateTracker";
import { MCA_PIPELINE, VCF_PIPELINE } from "@/data/pipelines";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import {
  closerLabel,
  isInterested,
  matchesSegment,
  merchantName,
  nextAction,
  prettyPhone,
  workBucket,
  type CallbackSegment,
  type Pipe,
  type PipelineRow,
  type Sort,
  type WorkBucket,
} from "@/components/admin/processor/types";

const LIST_CAP = 500;

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: PipelineRow[] };

const SORTS: { key: Sort; label: string }[] = [
  { key: "age", label: "Age" },
  { key: "callback", label: "Callback" },
  { key: "stage", label: "Stage" },
  { key: "amount", label: "Amount" },
  { key: "closer", label: "Closer" },
];

const SEGMENTS: { key: CallbackSegment; label: string }[] = [
  { key: "all", label: "All due" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "next7", label: "Next 7 days" },
  { key: "fortnight", label: "This fortnight" },
];

// The workflow buckets — the primary navigation, in the natural order of the job.
type BucketKey = "all" | WorkBucket | "callbacks" | "stale";

const BUCKETS: {
  key: BucketKey;
  label: string;
  hint: string;
  ring: string; // active border + text
  dot: string; // count accent
}[] = [
  {
    key: "all",
    label: "All in play",
    hint: "Every interested lead",
    ring: "border-ocean-blue text-ocean-blue",
    dot: "text-ocean-blue",
  },
  {
    key: "needs_app",
    label: "Needs application",
    hint: "Interested — app not done",
    ring: "border-purple-500 text-purple-700 dark:text-purple-300",
    dot: "text-purple-600 dark:text-purple-400",
  },
  {
    key: "needs_stmts",
    label: "Needs bank statements",
    hint: "App done — no statements",
    ring: "border-sky-500 text-sky-700 dark:text-sky-300",
    dot: "text-sky-600 dark:text-sky-400",
  },
  {
    key: "ready_qa",
    label: "Ready for QA",
    hint: "App + statements in",
    ring: "border-amber-500 text-amber-700 dark:text-amber-300",
    dot: "text-amber-600 dark:text-amber-400",
  },
  {
    key: "ready_submit",
    label: "Ready to submit",
    hint: "QA passed — handed off",
    ring: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
    dot: "text-emerald-600 dark:text-emerald-400",
  },
  {
    key: "callbacks",
    label: "Callbacks due",
    hint: "Next two weeks",
    ring: "border-blue-500 text-blue-700 dark:text-blue-300",
    dot: "text-blue-600 dark:text-blue-400",
  },
  {
    key: "stale",
    label: "Stale ≥14d → Nurture",
    hint: "Two weeks, no traction",
    ring: "border-red-500 text-red-700 dark:text-red-300",
    dot: "text-red-600 dark:text-red-400",
  },
];

function stageChip(status: string | null) {
  const cfg = status ? DEAL_STATUS_CONFIG[status as DealStatus] : undefined;
  const cls = cfg
    ? `${cfg.bgColor} ${cfg.color}`
    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  return { label: cfg?.label ?? status ?? "—", cls };
}

/** Does a callback fall in the "due" window (overdue/today/fortnight), or the
 *  narrowed sub-segment when one is chosen? */
function matchesCallbackBucket(r: PipelineRow, seg: CallbackSegment): boolean {
  if (seg === "all") {
    return (
      matchesSegment(r, "overdue") || matchesSegment(r, "today") || matchesSegment(r, "fortnight")
    );
  }
  return matchesSegment(r, seg);
}

const NEXT_TONE: Record<string, string> = {
  app: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  stmts: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  qa: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function ProcessorPage() {
  const { isSuperAdmin } = useUserProfile();
  const { isProcessor, loading: procLoading, error: procError } = useIsProcessor();
  const authorized = isSuperAdmin || isProcessor;

  const [counts, setCounts] = useState<CountsState>({ kind: "loading" });
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [pipe, setPipe] = useState<Pipe>("mca");
  const [view, setView] = useState<"funnel" | "board">("funnel");
  const [bucket, setBucket] = useState<BucketKey>("all");
  const [stage, setStage] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("age");
  const [segment, setSegment] = useState<CallbackSegment>("all");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Per-row armed nurture (armOrFire) — houses the two-step confirm without a popup.
  const [nurtureArmed, setNurtureArmed] = useState<string | null>(null);
  const armTimer = useRef<number | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    if (!authorized) return;
    setCounts({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("processor_stage_counts");
      if (error) throw new Error(error.message);
      const map = (data ?? {}) as Record<string, number>;
      const total = Object.values(map).reduce((a, b) => a + (b || 0), 0);
      setCounts({ kind: "ready", counts: map, total });
    } catch (e) {
      setCounts({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load the board counts.",
      });
    }
  }, [authorized]);

  const loadRows = useCallback(async () => {
    if (!authorized) return;
    setList({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("processor_pipeline_rows", {
        p_pipe: pipe,
        p_sort: sort,
        p_limit: LIST_CAP,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as PipelineRow[];
      setList({ kind: "ready", rows });
    } catch (e) {
      // UNREADABLE ≠ empty.
      setList({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load the pipeline.",
      });
    }
  }, [authorized, pipe, sort]);

  useEffect(() => {
    if (authorized) void loadCounts();
  }, [authorized, loadCounts]);

  useEffect(() => {
    if (authorized) void loadRows();
  }, [authorized, loadRows]);

  const reloadAll = useCallback(() => {
    void loadCounts();
    void loadRows();
  }, [loadCounts, loadRows]);

  const allRows = useMemo(() => (list.kind === "ready" ? list.rows : []), [list]);

  // The working funnel: interested-but-not-yet-submission-ready.
  const inScopeRows = useMemo(
    () => allRows.filter((r) => isInterested(pipe, r.status)),
    [allRows, pipe],
  );

  // Bucket counts (computed off the in-scope funnel, not the whole board).
  const bucketCounts = useMemo(() => {
    const c: Record<BucketKey, number> = {
      all: inScopeRows.length,
      needs_app: 0,
      needs_stmts: 0,
      ready_qa: 0,
      ready_submit: 0,
      callbacks: 0,
      stale: 0,
    };
    for (const r of inScopeRows) {
      c[workBucket(r)] += 1;
      if (matchesCallbackBucket(r, "all")) c.callbacks += 1;
      if (r.is_stale) c.stale += 1;
    }
    return c;
  }, [inScopeRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = view === "board" ? allRows : inScopeRows;
    return base.filter((r) => {
      if (mineOnly && !r.working_is_mine) return false;
      if (q) {
        const hay = [r.business_name, r.contact_name, r.phone, r.email, r.deal_number]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (view === "board") {
        if (stage && r.status !== stage) return false;
        if (!matchesSegment(r, segment)) return false;
        return true;
      }
      // Funnel view — the bucket is the primary filter.
      switch (bucket) {
        case "all":
          return true;
        case "callbacks":
          return matchesCallbackBucket(r, segment);
        case "stale":
          return !!r.is_stale;
        default:
          return workBucket(r) === bucket;
      }
    });
  }, [allRows, inScopeRows, view, mineOnly, search, stage, segment, bucket]);

  const stageDefs = (pipe === "mca" ? MCA_PIPELINE : VCF_PIPELINE).stages;

  const setRowSchedule = useCallback(
    async (rpc: string, dealId: string, argKey: string, iso: string) => {
      const { error } = await supabase.rpc(rpc, { p_deal_id: dealId, [argKey]: iso });
      if (error) throw new Error(error.message);
      reloadAll();
    },
    [reloadAll],
  );

  const toggleWorking = useCallback(
    async (dealId: string) => {
      setRowBusy(dealId);
      setRowErr(null);
      try {
        const { error } = await supabase.rpc("processor_toggle_working", { p_deal_id: dealId });
        if (error) throw new Error(error.message);
        await loadRows();
      } catch (e) {
        setRowErr(e instanceof Error ? e.message : "Couldn't update the working claim.");
      } finally {
        setRowBusy(null);
      }
    },
    [loadRows],
  );

  const armOrFireNurture = useCallback(
    (dealId: string) => {
      if (armTimer.current) window.clearTimeout(armTimer.current);
      if (nurtureArmed === dealId) {
        setNurtureArmed(null);
        setRowBusy(dealId);
        setRowErr(null);
        void (async () => {
          try {
            const { error } = await supabase.rpc("processor_move_to_nurture", {
              p_deal_id: dealId,
            });
            if (error) throw new Error(error.message);
            reloadAll();
          } catch (e) {
            setRowErr(e instanceof Error ? e.message : "Couldn't move to nurture.");
          } finally {
            setRowBusy(null);
          }
        })();
      } else {
        setNurtureArmed(dealId);
        armTimer.current = window.setTimeout(() => setNurtureArmed(null), 4000);
      }
    },
    [nurtureArmed, reloadAll],
  );

  const selectedRow = useMemo(
    () => allRows.find((r) => r.id === selectedDealId) ?? null,
    [allRows, selectedDealId],
  );

  // ── Gating ──
  if (procLoading && !isSuperAdmin) {
    return (
      <div className="p-8 text-sm text-gray-500 dark:text-gray-400">
        <span className="loading loading-spinner loading-sm" /> Checking access…
      </div>
    );
  }
  if (!authorized) {
    return (
      <div className="max-w-lg mx-auto mt-16 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center">
        <ExclamationTriangleIcon className="w-8 h-8 mx-auto text-amber-500" />
        <h1 className="mt-2 text-lg font-bold text-gray-900 dark:text-white">Not authorized</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          The Processor workspace is available to processors and super-admins only.
          {procError ? " (Your access check did not complete — try reloading.)" : ""}
        </p>
      </div>
    );
  }

  const loading = counts.kind === "loading" || list.kind === "loading";

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Squares2X2Icon className="w-6 h-6 text-ocean-blue" />
          Processor
        </h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
            {(["mca", "vcf"] as Pipe[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPipe(p);
                  setStage(null);
                }}
                className={`px-3 py-1.5 font-semibold ${
                  pipe === p
                    ? "bg-ocean-blue text-white"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reloadAll}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue disabled:opacity-50"
            title="Reload"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* 1. Mission banner — the job, in plain English, plus the 4-gate legend. */}
      <div className="rounded-xl border border-ocean-blue/30 dark:border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your job, in one line</h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          Take every lead where the customer showed interest and drive it to{" "}
          <span className="font-bold text-ocean-blue">submission-ready</span>: complete the{" "}
          <span className="font-semibold">application</span>, collect{" "}
          <span className="font-semibold">bank statements</span>,{" "}
          <span className="font-semibold">QA</span> it, then mark it{" "}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">ready to submit</span>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-gray-600 dark:text-gray-300">
          <span className="uppercase tracking-wide text-gray-400 font-semibold">The 4 gates</span>
          {[
            { n: 1, t: "Interested" },
            { n: 2, t: "Application complete" },
            { n: 3, t: "Bank statements in" },
            { n: 4, t: "QA passed" },
          ].map((gate) => (
            <span key={gate.n} className="inline-flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-100 text-[9px] font-bold">
                {gate.n}
              </span>
              {gate.t}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
            → ✅ READY TO SUBMIT
          </span>
        </div>
      </div>

      {/* 2. Workflow buckets — the primary navigation (funnel view). */}
      {view === "funnel" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4">
          {BUCKETS.map((b) => {
            const active = bucket === b.key;
            const n = bucketCounts[b.key];
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setBucket(b.key)}
                aria-pressed={active}
                className={`text-left rounded-xl border bg-white dark:bg-gray-800 p-3 transition-colors ${
                  active
                    ? `${b.ring} ring-1 ring-current`
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div
                  className={`text-2xl font-bold tabular-nums ${active ? b.dot : "text-gray-900 dark:text-white"}`}
                >
                  {list.kind === "ready" ? n.toLocaleString() : "—"}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 leading-tight">
                  {b.label}
                </div>
                <div className="text-[10px] text-gray-400 leading-tight">{b.hint}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* View switch + "By stage" board */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
          {(
            [
              { key: "funnel", label: "Interested → Ready" },
              { key: "board", label: "Whole board (by stage)" },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                setView(v.key);
                setStage(null);
              }}
              className={`px-3 py-1.5 font-semibold ${
                view === v.key
                  ? "bg-ocean-blue text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === "board" && stage && (
          <button
            type="button"
            onClick={() => setStage(null)}
            className="text-[11px] font-semibold text-ocean-blue hover:underline"
          >
            Clear stage filter ×
          </button>
        )}
      </div>

      {/* Board view — the full all-stages histogram (owner still wants it). */}
      {view === "board" && (
        <div className="rounded-xl border border-ocean-blue/30 dark:border-ocean-blue/40 bg-white dark:bg-gray-800 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">
              Where every lead is right now
              {counts.kind === "ready" && (
                <span className="ml-1 text-xs font-normal text-gray-400">
                  ({counts.total.toLocaleString()} deals)
                </span>
              )}
            </h2>
          </div>
          <StageHistogram
            state={counts}
            stages={stageDefs}
            activeStage={stage}
            onSelect={setStage}
            onRetry={() => void loadCounts()}
          />
        </div>
      )}

      {/* 3. The lead list */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, phone, email…"
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white w-64"
            />
          </div>
          <button
            type="button"
            onClick={() => setMineOnly((v) => !v)}
            aria-pressed={mineOnly}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
              mineOnly
                ? "border-amber-500 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-amber-500"
            }`}
          >
            <StarSolid className="w-3.5 h-3.5" /> My working set
          </button>

          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">Sort</span>
            {SORTS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setSort(o.key)}
                aria-pressed={sort === o.key}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  sort === o.key
                    ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Callback sub-segments — shown for the Callbacks bucket, and in board view. */}
        {(view === "board" || bucket === "callbacks") && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">Callbacks</span>
            {SEGMENTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                aria-pressed={segment === s.key}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  segment === s.key
                    ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {rowErr && (
          <div className="mb-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {rowErr}
          </div>
        )}

        {/* Table */}
        {list.kind === "loading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-10">
            <span className="loading loading-spinner loading-sm" /> Loading the pipeline…
          </div>
        )}

        {list.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Couldn't load the pipeline.</div>
              <div className="mt-0.5">This is not an empty pipeline — it's an unreadable one.</div>
              <div className="mt-0.5 font-mono opacity-80">{list.message}</div>
              <button
                type="button"
                onClick={() => void loadRows()}
                className="mt-1.5 font-semibold text-ocean-blue hover:underline"
              >
                Try again →
              </button>
            </div>
          </div>
        )}

        {list.kind === "ready" && (
          <>
            <div className="text-[11px] text-gray-400 mb-2">
              Showing {filteredRows.length.toLocaleString()} of{" "}
              {(view === "board" ? allRows.length : inScopeRows.length).toLocaleString()}
              {allRows.length >= LIST_CAP ? "+" : ""}{" "}
              {view === "board" ? "deals" : "interested leads"}
              {allRows.length >= LIST_CAP && " (first " + LIST_CAP + " — narrow with filters)"}
            </div>

            {filteredRows.length === 0 ? (
              <div className="py-12 text-center">
                <BuildingStorefrontIcon className="w-9 h-9 mx-auto text-gray-300 dark:text-gray-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Nothing in this bucket.
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This read succeeded — nothing matches right now. Pick another bucket above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="px-2 py-2 text-center w-10">★</th>
                      <th className="px-3 py-2 text-left">Company</th>
                      <th className="px-3 py-2 text-left">Readiness</th>
                      <th className="px-3 py-2 text-left">Next action</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Contact</th>
                      <th className="px-3 py-2 text-right">Age</th>
                      <th className="px-3 py-2 text-left">Callback</th>
                      <th className="px-3 py-2 text-left">Appt</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredRows.map((r) => {
                      const chip = stageChip(r.status);
                      const stale = !!r.is_stale;
                      const na = nextAction(r);
                      return (
                        <tr
                          key={r.id}
                          className={`transition-colors ${
                            stale
                              ? "bg-red-50 dark:bg-red-900/15 hover:bg-red-100/70 dark:hover:bg-red-900/25"
                              : "hover:bg-gray-50 dark:hover:bg-gray-900/40"
                          }`}
                        >
                          {/* Working toggle */}
                          <td className="px-2 py-2 text-center align-top">
                            <button
                              type="button"
                              disabled={rowBusy === r.id}
                              onClick={() => void toggleWorking(r.id)}
                              title={
                                r.working_is_mine
                                  ? "You're working this — click to release"
                                  : r.working_by
                                    ? `Working: ${r.working_by_name || "someone"}`
                                    : "Claim this deal"
                              }
                              className="disabled:opacity-50"
                            >
                              {r.working_is_mine ? (
                                <StarSolid className="w-5 h-5 text-amber-500" />
                              ) : (
                                <StarIcon
                                  className={`w-5 h-5 ${
                                    r.working_by
                                      ? "text-amber-300"
                                      : "text-gray-300 dark:text-gray-600 hover:text-amber-400"
                                  }`}
                                />
                              )}
                            </button>
                            {r.working_by && !r.working_is_mine && (
                              <div className="text-[9px] text-gray-400 mt-0.5 max-w-[3rem] truncate">
                                {r.working_by_name || "held"}
                              </div>
                            )}
                          </td>

                          {/* Company */}
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedDealId(r.id)}
                                className="font-semibold text-gray-900 dark:text-white hover:text-ocean-blue text-left truncate max-w-[15rem]"
                                title="Open the work cockpit"
                              >
                                {merchantName(r)}
                              </button>
                              <Link
                                to={`/admin/deals/${r.id}`}
                                className="shrink-0 text-gray-400 hover:text-ocean-blue"
                                title="Open the full deal record"
                              >
                                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${chip.cls}`}
                              >
                                {chip.label}
                              </span>
                              {r.deal_number && (
                                <span className="text-[10px] text-gray-400">#{r.deal_number}</span>
                              )}
                            </div>
                          </td>

                          {/* Readiness (the 4-gate tracker) */}
                          <td className="px-3 py-2 align-top">
                            <GateTracker row={r} pipe={pipe} compact />
                          </td>

                          {/* Next action */}
                          <td className="px-3 py-2 align-top">
                            <button
                              type="button"
                              onClick={() => setSelectedDealId(r.id)}
                              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${NEXT_TONE[na.tone]} hover:opacity-80`}
                              title="Open the cockpit to do this"
                            >
                              {na.label}
                            </button>
                          </td>

                          {/* Amount */}
                          <td className="px-3 py-2 text-right align-top tabular-nums text-gray-900 dark:text-gray-100">
                            {r.amount_requested != null && r.amount_requested > 0
                              ? `$${Math.round(r.amount_requested).toLocaleString()}`
                              : "—"}
                          </td>

                          {/* Contact */}
                          <td className="px-3 py-2 align-top">
                            <div className="text-xs text-gray-700 dark:text-gray-200">
                              {prettyPhone(r.phone) || "—"}
                              {r.do_not_contact && (
                                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                  DND
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[11rem]">
                              {closerLabel(r)}
                            </div>
                          </td>

                          {/* Age */}
                          <td className="px-3 py-2 text-right align-top tabular-nums">
                            <span
                              className={
                                stale
                                  ? "text-red-600 dark:text-red-400 font-bold"
                                  : "text-gray-600 dark:text-gray-300"
                              }
                            >
                              {r.days_in_pipeline ?? "—"}d
                            </span>
                          </td>

                          {/* Callback */}
                          <td className="px-3 py-2 align-top">
                            <SchedulePicker
                              kind="callback"
                              value={r.callback_at}
                              compact
                              onSave={(iso) =>
                                setRowSchedule("processor_set_callback", r.id, "p_callback_at", iso)
                              }
                            />
                          </td>

                          {/* Appointment */}
                          <td className="px-3 py-2 align-top">
                            <SchedulePicker
                              kind="appointment"
                              value={r.appointment_at}
                              compact
                              onSave={(iso) =>
                                setRowSchedule(
                                  "processor_set_appointment",
                                  r.id,
                                  "p_appointment_at",
                                  iso,
                                )
                              }
                            />
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center justify-end gap-1.5">
                              <TextMerchantPanel
                                merchantPhone={r.phone}
                                customerId={undefined}
                                dealId={r.id}
                                merchantEmail={r.email}
                                merchantFirstName={r.contact_name?.split(" ")[0]}
                                businessName={r.business_name}
                                buttonLabel="Text"
                                presentation="modal"
                              />
                              {stale && (
                                <button
                                  type="button"
                                  disabled={rowBusy === r.id}
                                  onClick={() => armOrFireNurture(r.id)}
                                  title="Two weeks up — move to long-term nurture"
                                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                                    nurtureArmed === r.id
                                      ? "border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
                                      : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-300"
                                  }`}
                                >
                                  <MoonIcon className="w-3 h-3" />
                                  {nurtureArmed === r.id ? "Confirm?" : "Nurture"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Board view keeps a pointer back to the funnel for new processors. */}
      {view === "board" && (
        <button
          type="button"
          onClick={() => setView("funnel")}
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-ocean-blue"
        >
          <ChevronRightIcon className="w-3 h-3" />
          Back to the Interested → Ready funnel
        </button>
      )}

      {/* 4. The cockpit drawer */}
      <ProcessorDetailDrawer
        dealId={selectedDealId}
        row={selectedRow}
        pipe={pipe}
        onClose={() => setSelectedDealId(null)}
        onChanged={reloadAll}
      />
    </div>
  );
}
