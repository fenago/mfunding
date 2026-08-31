import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  BuildingStorefrontIcon,
  Squares2X2Icon,
  UserIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import TextMerchantPanel from "@/components/admin/TextMerchantPanel";
import { MCA_PIPELINE, VCF_PIPELINE } from "@/data/pipelines";
import { DEAL_STATUS_CONFIG, type DealStatus, type DealWithCustomer } from "@/types/deals";
import {
  applicationCompleteness,
  SECTION_LABEL,
  type AppSection,
} from "@/lib/applicationCompleteness";
import { dateTimeET } from "@/utils/time";

/**
 * ProcessorBoard — the WHOLE-BOARD hunt list for a PROCESSOR (a closer with the
 * extra capability). It mounts at the bottom of the Setter Operations console and
 * is rendered ONLY when useIsProcessor() is true (gated in SetterOpsTab).
 *
 * WHY IT READS THROUGH RPCs, NOT A DIRECT `deals` SELECT
 * A processor is role=closer, and 20260827_setter_deal_money_wall.sql made a
 * closer's `deals` SELECT own-book + unassigned ONLY (the money wall). A plain
 * whole-board `deals` query therefore returns just their own deals. So the board
 * reads the whole board through two SECURITY DEFINER RPCs gated on is_processor:
 *   • processor_stage_counts()                    → counts by status (whole board)
 *   • processor_deals_in_stage(status,sort,limit) → the deals in one stage
 * Both return NO deal economics/commission and NO merchant PII values — the
 * application object carries a '1' PRESENCE SENTINEL for sensitive fields so the
 * completeness meter is accurate without leaking data.
 *
 * HONESTY (readers-must-distinguish-unreadable): a failed read is a RED error,
 * never an empty list. "Couldn't load" ≠ "nothing there".
 *
 * REUSE, not duplication: the pipeline visual is the shared PipelineFlow; the SMS
 * compose is the shared TextMerchantPanel (same `sms-send` gate as everywhere);
 * the completeness math is the shared applicationCompleteness (the ONE source of
 * truth the application modal uses). This file only orchestrates them.
 */

const LIST_CAP = 200;
type Sort = "recent" | "closer";
type Pipe = "mca" | "vcf";

interface AppObj {
  [key: string]: unknown;
}

interface RowCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  additional_emails: string[] | null;
  phone: string | null;
  additional_phones: string[] | null;
  industry: string | null;
  monthly_revenue: number | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  do_not_contact: boolean | null;
}

interface DealRow {
  id: string;
  deal_number: string | null;
  status: string | null;
  previous_status: string | null;
  lead_source: string | null;
  updated_at: string | null;
  created_at: string | null;
  bank_statements_at: string | null;
  use_of_funds: string | null;
  deal_type: string | null;
  amount_requested: number | null;
  assigned_closer_id: string | null;
  closer: { id: string; first_name: string | null; last_name: string | null } | null;
  customer: RowCustomer | null;
  application: AppObj | null;
}

type CountsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; counts: Record<string, number>; total: number };

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: DealRow[] };

function merchantName(r: DealRow): string {
  const c = r.customer;
  return (
    c?.business_name?.trim() ||
    [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() ||
    r.deal_number ||
    "Unnamed merchant"
  );
}

function closerName(r: DealRow): string {
  if (!r.assigned_closer_id) return "Unassigned";
  const n = [r.closer?.first_name, r.closer?.last_name].filter(Boolean).join(" ").trim();
  return n || "Assigned";
}

function stageLabel(status: string | null): string {
  if (!status) return "—";
  return DEAL_STATUS_CONFIG[status as DealStatus]?.label ?? status;
}

function stageChipCls(status: string | null): string {
  const cfg = DEAL_STATUS_CONFIG[status as DealStatus];
  return cfg
    ? `${cfg.bgColor} ${cfg.color}`
    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
}

function prettyPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

/** Build the narrow DealWithCustomer shape applicationCompleteness actually reads
 *  (customer, lead_qual, amount_requested, use_of_funds). The RPC deliberately
 *  omits lead_qual/amount (economics), so a deal with NO saved application seeds
 *  from the customer only — a safe under-estimate, never a leak. */
function toDealArg(r: DealRow): DealWithCustomer {
  return {
    customer: r.customer ?? undefined,
    lead_qual: null,
    amount_requested: null,
    use_of_funds: r.use_of_funds,
  } as unknown as DealWithCustomer;
}

/** The compact "what's missing" summary for a row. */
function missingSummary(r: DealRow): {
  pct: number;
  left: number;
  sections: string;
  gaps: string[];
} {
  const res = applicationCompleteness(toDealArg(r), r.application ?? null);
  const sections = (Object.keys(res.missingBySection) as AppSection[])
    .filter((s) => res.missingBySection[s] > 0)
    .map((s) => `${SECTION_LABEL[s]} ${res.missingBySection[s]}`)
    .join(" · ");
  const gaps: string[] = [];
  if (!r.customer?.phone) gaps.push("No phone");
  if (!r.customer?.email) gaps.push("No email");
  if (!r.bank_statements_at) gaps.push("No statements");
  if (r.customer?.do_not_contact) gaps.push("DND");
  return { pct: res.pct, left: res.missing.length, sections, gaps };
}

function pctTone(pct: number): string {
  if (pct >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export default function ProcessorBoard({
  onOpen,
}: {
  onOpen: (lookup: { dealId: string }) => void;
}) {
  const [counts, setCounts] = useState<CountsState>({ kind: "loading" });
  const [pipe, setPipe] = useState<Pipe>("mca");
  const [stage, setStage] = useState<DealStatus | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [list, setList] = useState<ListState>({ kind: "idle" });
  // Collapsible — remembered across reloads. It's a big board at the bottom of the
  // console; a processor can fold it away when working the console above.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("processorBoardCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("processorBoardCollapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // ── Whole-board counts ──
  const loadCounts = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // ── The deals in the selected stage ──
  const loadStage = useCallback(async (s: DealStatus, sortBy: Sort) => {
    setList({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("processor_deals_in_stage", {
        p_status: s,
        p_sort: sortBy,
        p_limit: LIST_CAP,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as DealRow[];
      setList({ kind: "ready", rows });
    } catch (e) {
      // UNREADABLE ≠ empty.
      setList({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load that stage.",
      });
    }
  }, []);

  useEffect(() => {
    if (stage) void loadStage(stage, sort);
  }, [stage, sort, loadStage]);

  const countFor = useCallback(
    (k: string) => (counts.kind === "ready" ? counts.counts[k] ?? 0 : 0),
    [counts],
  );

  const listRows = list.kind === "ready" ? list.rows : [];

  // Stages for the currently-selected pipeline (MCA / VCF). processor_stage_counts()
  // returns counts for EVERY status, so the toggle is a pure display filter.
  const stageDefs = (pipe === "mca" ? MCA_PIPELINE : VCF_PIPELINE).stages;
  const maxCount = useMemo(
    () => Math.max(1, ...stageDefs.map((s) => (counts.kind === "ready" ? counts.counts[s.key] ?? 0 : 0))),
    [counts, stageDefs],
  );

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="group flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white text-left"
          aria-expanded={!collapsed}
          title={collapsed ? "Expand the processor board" : "Collapse the processor board"}
        >
          {collapsed ? (
            <ChevronRightIcon className="w-4 h-4 text-gray-400 group-hover:text-ocean-blue" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-ocean-blue" />
          )}
          <Squares2X2Icon className="w-5 h-5 text-ocean-blue" />
          Processor board — whole pipeline
          {counts.kind === "ready" && (
            <span className="text-xs font-normal text-gray-400">
              ({counts.total.toLocaleString()} deals)
            </span>
          )}
        </button>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
              {(["mca", "vcf"] as Pipe[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPipe(p);
                    setStage(null);
                    setList({ kind: "idle" });
                  }}
                  className={`px-2.5 py-1 font-semibold ${
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
              onClick={() => {
                void loadCounts();
                if (stage) void loadStage(stage, sort);
              }}
              disabled={counts.kind === "loading"}
              className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue disabled:opacity-50"
              title="Reload the board"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${counts.kind === "loading" ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        )}
      </div>
    ),
    [counts, stage, sort, loadCounts, loadStage, collapsed, pipe],
  );

  return (
    <div className="rounded-xl border border-ocean-blue/30 dark:border-ocean-blue/40 bg-white dark:bg-gray-800 p-6">
      {header}

      {collapsed ? null : (
      <>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Every deal on the board, across all setters — click a stage to work its merchants:
        text them, open the record, load one into the console above, and see exactly what's
        missing before you chase.
      </p>

      {/* ── Stage histogram — one bar per stage, click to open its leads below ── */}
      <div className="mt-4">
        {counts.kind === "error" ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Couldn't load the board counts.</div>
              <div className="mt-0.5">This is not an empty board — it's an unreadable one.</div>
              <div className="mt-0.5 font-mono opacity-80">{counts.message}</div>
              <button
                type="button"
                onClick={() => void loadCounts()}
                className="mt-1.5 font-semibold text-ocean-blue hover:underline"
              >
                Try again →
              </button>
            </div>
          </div>
        ) : counts.kind === "loading" ? (
          <p className="text-xs text-gray-400 py-6">Loading the board…</p>
        ) : (
          <div className="space-y-1.5">
            {stageDefs.map((s) => {
              const c = countFor(s.key);
              const pct = Math.round((c / maxCount) * 100);
              const active = stage === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStage(active ? null : (s.key as DealStatus))}
                  aria-pressed={active}
                  className={`w-full group flex items-center gap-3 text-left rounded ${
                    active ? "ring-1 ring-ocean-blue/40 bg-ocean-blue/5" : ""
                  }`}
                  title={`${s.label} — ${c} deal${c === 1 ? "" : "s"}`}
                >
                  <span
                    className={`w-36 shrink-0 text-sm truncate ${
                      active ? "font-semibold text-ocean-blue" : "text-gray-700 dark:text-gray-200"
                    }`}
                  >
                    {s.label}
                  </span>
                  <span className="flex-1 h-7 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden relative">
                    <span
                      className={`absolute inset-y-0 left-0 rounded ${
                        active ? "bg-ocean-blue" : "bg-ocean-blue/70 group-hover:bg-ocean-blue"
                      }`}
                      style={{ width: `${Math.max(pct, c > 0 ? 8 : 0)}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {c.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The stage's deals ── */}
      {stage && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-gray-900 dark:text-white">
              {stageLabel(stage)}
              {list.kind === "ready" && (
                <span className="ml-1 text-xs font-normal text-gray-400">
                  ({listRows.length.toLocaleString()}
                  {listRows.length >= LIST_CAP ? "+" : ""})
                </span>
              )}
            </div>
            {/* Sort control */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-400">Sort</span>
              {(
                [
                  { key: "recent", label: "Most recent" },
                  { key: "closer", label: "By closer" },
                ] as const
              ).map((o) => (
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

          {listRows.length >= LIST_CAP && (
            <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
              ⚠ Showing the first {LIST_CAP} — narrow by picking a later stage if this one runs long.
            </div>
          )}

          <div className="mt-2">
            {list.kind === "loading" && (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-6">
                <span className="loading loading-spinner loading-xs" /> Loading {stageLabel(stage)}…
              </div>
            )}

            {list.kind === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Couldn't load this stage.</div>
                  <div className="mt-0.5">This is not an empty stage — it's an unreadable one.</div>
                  <div className="mt-0.5 font-mono opacity-80">{list.message}</div>
                  <button
                    type="button"
                    onClick={() => stage && void loadStage(stage, sort)}
                    className="mt-1.5 font-semibold text-ocean-blue hover:underline"
                  >
                    Try again →
                  </button>
                </div>
              </div>
            )}

            {list.kind === "ready" && listRows.length === 0 && (
              <div className="py-8 text-center">
                <BuildingStorefrontIcon className="w-9 h-9 mx-auto text-gray-300 dark:text-gray-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  No deals in "{stageLabel(stage)}" right now.
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This read succeeded — the stage is genuinely empty. Pick another stage above.
                </p>
              </div>
            )}

            {list.kind === "ready" && listRows.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                {listRows.map((r) => {
                  const m = missingSummary(r);
                  return (
                    <div
                      key={r.id}
                      className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 first:border-t-0 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                              {merchantName(r)}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageChipCls(r.status)}`}
                            >
                              {stageLabel(r.status)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                            {r.amount_requested != null && r.amount_requested > 0 && (
                              <span className="font-semibold text-gray-700 dark:text-gray-200">
                                ${Math.round(r.amount_requested).toLocaleString()} requested
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              {closerName(r)}
                            </span>
                            {r.customer?.phone && <span>{prettyPhone(r.customer.phone)}</span>}
                            {r.updated_at && (
                              <span title={`Last updated ${dateTimeET(r.updated_at)} ET`}>
                                updated {dateTimeET(r.updated_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold tabular-nums ${pctTone(m.pct)}`}>
                            {m.pct}%
                          </div>
                          <div className="text-[10px] text-gray-400">
                            app{m.left > 0 ? ` · ${m.left} left` : " complete"}
                          </div>
                        </div>
                      </div>

                      {/* what's missing — section breakdown + explicit gap flags */}
                      {(m.sections || m.gaps.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {m.sections && (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400">
                              Missing: {m.sections}
                            </span>
                          )}
                          {m.gaps.map((g) => (
                            <span
                              key={g}
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* actions */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpen({ dealId: r.id })}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-ocean-blue text-white hover:bg-deep-sea transition-colors"
                          title="Load this merchant into the console above"
                        >
                          Load into console
                        </button>
                        <TextMerchantPanel
                          merchantPhone={r.customer?.phone}
                          additionalPhones={r.customer?.additional_phones}
                          customerId={r.customer?.id}
                          dealId={r.id}
                          merchantEmail={r.customer?.email}
                          merchantFirstName={r.customer?.first_name}
                          businessName={r.customer?.business_name}
                          buttonLabel="Text"
                          presentation="modal"
                        />
                        <Link
                          to={`/admin/deals/${r.id}`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue transition-colors"
                          title="Open the full deal record"
                        >
                          <ArrowTopRightOnSquareIcon className="w-3 h-3" /> Record
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
