// FunderChaseTab — the processor's funder chase surface.
//
// One SECTION PER SUBMITTED DEAL, stacked on a single scrollable tab. Expanding
// a section renders the full FunderWorkspace — the identical panel the Revenue
// Playbook shows on Step 7: funder cards side by side with their ⏳/💰/❌ state,
// the whole message timeline (submitted, each message out, the green "Opened"
// badge, view-email links) and the collapsed "Submit to more funders" picker.
//
// A compressed row-per-submission table was tried first and thrown out: it
// dropped the open-tracking, the message threads and the view-email links,
// which ARE the chase tools. The header is a summary to triage by, never a
// replacement for the panel.
//
// Collapsed by default, because ten expanded panels is not a usable page — and
// because FunderWorkspace mounts FunderPicker, which scores every funder in the
// network. Rendering it only on expand keeps that work lazy instead of firing
// it ten times on page load.
//
// Ordered oldest-silent first: the deal that has gone longest without a funder
// touch sits at the top, and a deal past a funder's OWN quoted turnaround
// (lenders.funding_speed) sorts above everything.
//
// HONESTY: a failed read renders RED with a retry. "Nothing outstanding" from a
// broken query would stop her chasing altogether.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import FunderWorkspace from "@/components/admin/FunderWorkspace";
import { DEAL_STATUS_CONFIG, type DealStatus, type DealWithCustomer } from "@/types/deals";
import {
  CHASE_TONE_CLS,
  chaseTone,
  hoursSince,
  isLive,
  money,
  quotedDecisionHours,
  relTime,
  stateOf,
  type StateKey,
} from "@/lib/funderSubmissions";

/** A submission, flattened just enough to summarise a deal's header. The full
 *  detail is FunderWorkspace's job once the section is expanded. */
interface SubSummary {
  id: string;
  lenderName: string;
  fundingSpeed: string | null;
  status: string;
  submittedAt: string | null;
  responseAt: string | null;
  offerAmount: number | null;
  factorRate: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
}

interface DealGroup {
  dealId: string;
  deal: DealWithCustomer;
  businessName: string;
  dealNumber: string | null;
  status: string | null;
  amountRequested: number | null;
  subs: SubSummary[];
  /** Most recent funder touch on this deal — a send or a reply, whichever is
   *  later. The chase clock runs from here. */
  lastTouchAt: string | null;
  breached: boolean;
  /** The tightest quoted turnaround among the funders sitting silent. */
  breachedLabel: string | null;
}

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; groups: DealGroup[] };

type Filter = "outstanding" | "offers" | "declined" | "all";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "outstanding", label: "Awaiting", hint: "a funder still owes us an answer" },
  { key: "offers", label: "Offers", hint: "terms came back" },
  { key: "declined", label: "All passed", hint: "every funder declined or withdrew" },
  { key: "all", label: "All", hint: "every deal that has gone out" },
];

/** A deal's bucket is its most promising live state: still waiting beats an
 *  offer beats everyone having passed. */
function bucketOfDeal(subs: SubSummary[]): Filter {
  const keys = subs.map((s) => stateOf(s).key);
  if (keys.some((k) => k === "awaiting" || k === "replied")) return "outstanding";
  if (keys.some((k: StateKey) => k === "offer" || k === "accepted")) return "offers";
  return "declined";
}

export default function FunderChaseTab() {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setState({ kind: "loading" });

    // 1) Every submission, with its funder's name + quoted turnaround.
    const { data: subData, error: subErr } = await supabase
      .from("deal_submissions")
      .select(
        "id, deal_id, status, submitted_at, response_at, offer_amount, factor_rate, " +
          "daily_payment, weekly_payment, total_payback, " +
          "lender:lenders!lender_id ( company_name, funding_speed )",
      );
    if (subErr) {
      setState({ kind: "error", message: `Submissions: ${subErr.message}` });
      return;
    }
    if (subData == null) {
      setState({ kind: "error", message: "The submissions read came back empty." });
      return;
    }

    // Group the LIVE ones by deal.
    const byDeal = new Map<string, SubSummary[]>();
    for (const r of subData as unknown as Record<string, unknown>[]) {
      const lender = r.lender as { company_name?: string; funding_speed?: string | null } | null;
      const s: SubSummary = {
        id: r.id as string,
        lenderName: lender?.company_name ?? "Funder",
        fundingSpeed: lender?.funding_speed ?? null,
        status: r.status as string,
        submittedAt: (r.submitted_at as string | null) ?? null,
        responseAt: (r.response_at as string | null) ?? null,
        offerAmount: (r.offer_amount as number | null) ?? null,
        factorRate: (r.factor_rate as number | null) ?? null,
        dailyPayment: (r.daily_payment as number | null) ?? null,
        weeklyPayment: (r.weekly_payment as number | null) ?? null,
        totalPayback: (r.total_payback as number | null) ?? null,
      };
      if (!isLive(s)) continue;
      const key = r.deal_id as string;
      const arr = byDeal.get(key);
      if (arr) arr.push(s);
      else byDeal.set(key, [s]);
    }

    const dealIds = [...byDeal.keys()];
    if (dealIds.length === 0) {
      setState({ kind: "ready", groups: [] });
      return;
    }

    // 2) The REAL deals, with their customers — FunderWorkspace reads deal.id,
    //    customer_id, deal_type, amount_requested, ghl_contact_id and
    //    ai_lender_recommendations, so this has to be the whole row.
    const { data: dealData, error: dealErr } = await supabase
      .from("deals")
      .select("*, customer:customers!customer_id ( * )")
      .in("id", dealIds);
    if (dealErr) {
      setState({ kind: "error", message: `Deals: ${dealErr.message}` });
      return;
    }
    if (dealData == null) {
      setState({ kind: "error", message: "The deals read came back empty." });
      return;
    }

    const groups: DealGroup[] = [];
    for (const d of dealData as unknown as DealWithCustomer[]) {
      const subs = byDeal.get(d.id) ?? [];
      if (subs.length === 0) continue;

      // Last funder touch = the latest send or reply across this deal's funders.
      let lastTouchAt: string | null = null;
      for (const s of subs) {
        for (const t of [s.submittedAt, s.responseAt]) {
          if (t && (!lastTouchAt || new Date(t) > new Date(lastTouchAt))) lastTouchAt = t;
        }
      }

      // Breach is judged per still-silent funder against ITS own promise.
      let breached = false;
      let breachedLabel: string | null = null;
      for (const s of subs) {
        if (stateOf(s).key !== "awaiting") continue;
        const q = quotedDecisionHours(s.fundingSpeed);
        const h = hoursSince(s.submittedAt);
        if (q != null && h != null && h > q) {
          breached = true;
          const promise = q < 1 ? `${Math.round(q * 60)}-min` : `${q}h`;
          breachedLabel = `${s.lenderName} is past its own ${promise} promise`;
        }
      }

      const cust = d.customer as { business_name?: string | null; first_name?: string | null; last_name?: string | null } | undefined;
      groups.push({
        dealId: d.id,
        deal: d,
        businessName:
          cust?.business_name?.trim() ||
          [cust?.first_name, cust?.last_name].filter(Boolean).join(" ").trim() ||
          d.deal_number ||
          "Unnamed merchant",
        dealNumber: d.deal_number ?? null,
        status: (d.status as string | null) ?? null,
        amountRequested: (d.amount_requested as number | null) ?? null,
        subs,
        lastTouchAt,
        breached,
        breachedLabel,
      });
    }

    setState({ kind: "ready", groups });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => (state.kind === "ready" ? state.groups : []), [state]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { outstanding: 0, offers: 0, declined: 0, all: groups.length };
    for (const g of groups) c[bucketOfDeal(g.subs)] += 1;
    return c;
  }, [groups]);

  // Oldest-silent first; a breached deal outranks raw age.
  const visible = useMemo(() => {
    const rows = groups.filter((g) => filter === "all" || bucketOfDeal(g.subs) === filter);
    return [...rows].sort((a, b) => {
      if (a.breached !== b.breached) return a.breached ? -1 : 1;
      const ha = hoursSince(a.lastTouchAt) ?? -1;
      const hb = hoursSince(b.lastTouchAt) ?? -1;
      return hb - ha;
    });
  }, [groups, filter]);

  const allExpanded = visible.length > 0 && visible.every((g) => expanded.has(g.dealId));

  function toggle(dealId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-red-700 dark:text-red-300">
              Couldn&apos;t load the funder queue.
            </div>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              This is <span className="font-bold">not</span> &ldquo;nothing outstanding&rdquo; — it is an unread
              query. Don&apos;t stop chasing on the strength of this screen until it loads.
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-red-700/80 dark:text-red-300/80">{state.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1.5 text-xs font-semibold text-ocean-blue hover:underline"
            >
              Try again →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <PaperAirplaneIcon className="w-4 h-4 text-ocean-blue" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Funder chase</h2>
          <span className="text-[11px] text-gray-400">
            every submitted deal · longest silence first · open one to work its funders
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(visible.map((g) => g.dealId)))
              }
              disabled={visible.length === 0}
              className="text-[11px] font-semibold text-ocean-blue hover:underline disabled:opacity-40"
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              title={f.hint}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.key
                  ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">
                {state.kind === "ready" ? counts[f.key] : "—"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="loading loading-spinner loading-sm" /> Loading the funder queue…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-sm text-gray-500 dark:text-gray-400">
          {filter === "outstanding"
            ? "Nothing outstanding — every funder holding a file has answered."
            : "No deals in this view."}
        </div>
      ) : (
        visible.map((g) => {
          const isOpen = expanded.has(g.dealId);
          const hrs = hoursSince(g.lastTouchAt);
          const tone = g.breached ? "breached" : chaseTone(hrs, null);
          const stageCfg = g.status ? DEAL_STATUS_CONFIG[g.status as DealStatus] : undefined;
          return (
            <div
              key={g.dealId}
              className={`rounded-xl border bg-white dark:bg-gray-800 ${
                g.breached
                  ? "border-red-300 dark:border-red-800"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              {/* ── Header: enough to decide whether to open it ── */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 p-3">
                <button
                  type="button"
                  onClick={() => toggle(g.dealId)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-1.5 text-left min-w-0"
                >
                  <ChevronRightIcon
                    className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                    {g.businessName}
                  </span>
                </button>

                {g.dealNumber && (
                  <Link
                    to={`/admin/deals/${g.dealId}`}
                    className="text-[11px] text-gray-400 hover:text-ocean-blue inline-flex items-center gap-0.5"
                  >
                    {g.dealNumber}
                    <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                  </Link>
                )}

                {stageCfg && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageCfg.bgColor} ${stageCfg.color}`}>
                    {stageCfg.label}
                  </span>
                )}

                {g.amountRequested != null && (
                  <span className="text-[11px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                    {money(g.amountRequested)}
                  </span>
                )}

                {/* Per-funder state chips — the triage signal. */}
                <span className="flex flex-wrap items-center gap-1">
                  {g.subs.map((s) => {
                    const st = stateOf(s);
                    return (
                      <span
                        key={s.id}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}
                        title={`${s.lenderName} — ${st.label}${s.submittedAt ? ` · sent ${relTime(s.submittedAt)}` : ""}`}
                      >
                        {st.emoji} {s.lenderName}
                      </span>
                    );
                  })}
                </span>

                <span className={`ml-auto text-[11px] whitespace-nowrap ${CHASE_TONE_CLS[tone]}`}>
                  {g.lastTouchAt ? `last funder contact ${relTime(g.lastTouchAt)}` : "never stamped"}
                </span>
              </div>

              {g.breached && g.breachedLabel && (
                <div className="px-3 pb-2 -mt-1">
                  <span className="text-[11px] font-bold text-red-700 dark:text-red-300">
                    ⚠ {g.breachedLabel}
                  </span>
                </div>
              )}

              {/* ── The full panel, identical to the Playbook's Step 7 ──
                  Mounted only when open: FunderWorkspace mounts FunderPicker,
                  which scores the whole funder network per deal. */}
              {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700/60">
                  <FunderWorkspace deal={g.deal} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
