import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MagnifyingGlassIcon,
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import supabase from "@/supabase";
import { money } from "@/data/lenderPrograms";

/**
 * "Who does this merchant actually qualify for?" — answered in one screen.
 *
 * The problem this exists to kill: leads come in at $18–23k/mo asking for $50k.
 * An MCA is sized off MONTHLY REVENUE, not off what the merchant wants, so $50k on
 * $20k/mo is 2.5x revenue — above the ceiling of every funder in the book but one.
 * Submitting it anyway collects declines and burns funder relationships.
 *
 * So this does two things at once:
 *   1. Sizes the deal honestly   → "revenue supports $12.6k–$21.6k, they asked $50k"
 *   2. Ranks the funder network  → likely / stretch / blocked, each with the REASON
 *
 * SIZING RULE. Funders that publish a multiple in `lender_programs` are used verbatim
 * (approval_pct_min/max — e.g. Uplyft 76%, Funderial 100–250%). Everyone else falls
 * back to DEFAULT_PCT, which is Greenbox's stated "70–120% of monthly sales" — the
 * industry-standard band. That's an ESTIMATE, and the UI says so; the funder's
 * underwriter is the only one who can actually price it.
 *
 * Inputs are free-entry (type anything) OR loaded from a live merchant in the
 * pipeline, so a closer can pressure-test a real deal before submitting it.
 */

// Industry-standard advance band, used when a funder hasn't published its own
// multiple. Anchored to Greenbox Capital's published "70-120% of monthly sales".
const DEFAULT_PCT_LO = 70;
const DEFAULT_PCT_HI = 120;

type Verdict = "likely" | "stretch" | "blocked" | "unknown";

interface Program {
  id: string;
  approval_min: number | null;
  approval_max: number | null;
  approval_pct_min: number | null;
  approval_pct_max: number | null;
  monthly_revenue_required: number | null;
  annual_revenue_required: number | null;
  time_in_business_months: number | null;
  min_credit_score: number | null;
  cost_of_capital: string | null;
  time_to_approve: string | null;
  points_max: number | null;
  lender: {
    id: string;
    company_name: string;
    status: string;
    stacking_policy: string | null;
  } | null;
}

export interface QualifierInputs {
  revenue: number | null;
  tib: number | null; // months
  fico: number | null;
  requested: number | null;
  positions: number | null;
}

interface Assessment {
  program: Program;
  verdict: Verdict;
  blockers: string[];
  warnings: string[];
  notes: string[];
  offerLo: number | null;
  offerHi: number | null;
}

const EMPTY: QualifierInputs = { revenue: null, tib: null, fico: null, requested: null, positions: null };

/** credit_score_range is free text ("600-650", "650+"). Take the first number. */
function ficoFromRange(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/\d{3}/);
  return m ? Number(m[0]) : null;
}

function evaluate(p: Program, i: QualifierInputs): Assessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const rev = i.revenue ?? 0;

  // A funder can state its floor monthly OR annually — normalize to monthly.
  const monthlyReq =
    p.monthly_revenue_required ??
    (p.annual_revenue_required != null ? Number(p.annual_revenue_required) / 12 : null);

  // ── Hard gates ────────────────────────────────────────────────────────────
  if (monthlyReq != null && rev > 0 && rev < Number(monthlyReq)) {
    blockers.push(`Floor is ${money(Math.round(Number(monthlyReq)))}/mo — they do ${money(rev)}`);
  }
  if (p.time_in_business_months != null && i.tib != null && i.tib < p.time_in_business_months) {
    blockers.push(`Needs ${p.time_in_business_months} mo in business — they have ${i.tib}`);
  }
  if (p.min_credit_score != null) {
    if (i.fico == null) warnings.push(`FICO unknown — this funder needs ${p.min_credit_score}+`);
    else if (i.fico < p.min_credit_score) {
      blockers.push(`Needs ${p.min_credit_score}+ FICO — they have ${i.fico}`);
    }
  }

  // ── Sizing: what does the REVENUE support, not what did they ask for? ─────
  const pctLo = p.approval_pct_min != null ? Number(p.approval_pct_min) : DEFAULT_PCT_LO;
  const pctHi = p.approval_pct_max != null ? Number(p.approval_pct_max) : DEFAULT_PCT_HI;
  const publishedPct = p.approval_pct_min != null || p.approval_pct_max != null;

  let offerLo: number | null = null;
  let offerHi: number | null = null;

  if (rev > 0) {
    const rawLo = (rev * pctLo) / 100;
    const rawHi = (rev * pctHi) / 100;

    // The subtle one: a funder with a $25k minimum advance is unreachable for a
    // merchant whose revenue only supports ~$21k — even if they ASK for $25k.
    // Gate on what the revenue supports, never on the aspiration.
    if (p.approval_min != null && rawHi < Number(p.approval_min)) {
      blockers.push(
        `Minimum advance is ${money(Number(p.approval_min))} — their revenue only supports about ${money(Math.round(rawHi))}`,
      );
    }

    offerLo = Math.round(rawLo);
    offerHi = Math.round(rawHi);
    if (p.approval_max != null) {
      offerLo = Math.min(offerLo, Number(p.approval_max));
      offerHi = Math.min(offerHi, Number(p.approval_max));
      if (i.requested != null && i.requested > Number(p.approval_max)) {
        notes.push(`Caps at ${money(Number(p.approval_max))}`);
      }
    }
    if (p.approval_min != null && offerHi >= Number(p.approval_min)) {
      offerLo = Math.max(offerLo, Number(p.approval_min));
    }
    if (publishedPct) {
      notes.push(`Sizes at ${pctLo === pctHi ? `${pctLo}%` : `${pctLo}–${pctHi}%`} of monthly revenue`);
    }
  }

  // ── Positions / stacking ─────────────────────────────────────────────────
  if (i.positions != null && i.positions > 0) {
    if (p.lender?.stacking_policy) notes.push(`Stacking: ${p.lender.stacking_policy.trim()}`);
    else warnings.push(`${i.positions} open position${i.positions === 1 ? "" : "s"} — stacking policy not on file`);
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const hasAnyCriteria =
    monthlyReq != null ||
    p.time_in_business_months != null ||
    p.min_credit_score != null ||
    p.approval_min != null ||
    p.approval_max != null;

  let verdict: Verdict;
  if (blockers.length > 0) verdict = "blocked";
  else if (!hasAnyCriteria) verdict = "unknown";
  else if (i.requested != null && offerHi != null && i.requested > offerHi) verdict = "stretch";
  else verdict = "likely";

  return { program: p, verdict, blockers, warnings, notes, offerLo, offerHi };
}

const VERDICT_META: Record<Verdict, { label: string; Icon: typeof CheckCircleIcon; chip: string; dot: string; order: number }> = {
  likely: {
    label: "Likely",
    Icon: CheckCircleIcon,
    chip: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800",
    dot: "bg-emerald-500",
    order: 0,
  },
  stretch: {
    label: "Stretch",
    Icon: ExclamationTriangleIcon,
    chip: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
    order: 1,
  },
  unknown: {
    label: "Can't tell",
    Icon: QuestionMarkCircleIcon,
    chip: "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600",
    dot: "bg-gray-400",
    order: 2,
  },
  blocked: {
    label: "Blocked",
    Icon: NoSymbolIcon,
    chip: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
    dot: "bg-red-500",
    order: 3,
  },
};

type MerchantHit = {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  monthly_revenue: number | null;
  time_in_business: number | null;
  credit_score_range: string | null;
  amount_requested: number | null;
  deals: { deal_number: string | null; status: string | null; amount_requested: number | null }[] | null;
};

export default function FunderQualifier() {
  const [inputs, setInputs] = useState<QualifierInputs>(EMPTY);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeUncontracted, setIncludeUncontracted] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // Merchant search
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MerchantHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lender_programs")
        .select(
          "id, approval_min, approval_max, approval_pct_min, approval_pct_max, monthly_revenue_required, annual_revenue_required, time_in_business_months, min_credit_score, cost_of_capital, time_to_approve, points_max, lender:lenders!inner(id, company_name, status, stacking_policy)",
        )
        .eq("product_type", "mca")
        .eq("is_active", true);
      setPrograms(((data ?? []) as unknown as Program[]).filter((p) => p.lender));
      setLoading(false);
    })();
  }, []);

  // Debounced merchant lookup across business name and contact name.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const term = `%${q.trim()}%`;
      const { data } = await supabase
        .from("customers")
        .select(
          "id, business_name, first_name, last_name, monthly_revenue, time_in_business, credit_score_range, amount_requested, deals(deal_number, status, amount_requested)",
        )
        .or(`business_name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`)
        .limit(8);
      setHits((data ?? []) as unknown as MerchantHit[]);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchOpen]);

  const loadMerchant = useCallback((m: MerchantHit) => {
    const deal = m.deals?.[0];
    setInputs({
      revenue: m.monthly_revenue != null ? Number(m.monthly_revenue) : null,
      tib: m.time_in_business ?? null,
      fico: ficoFromRange(m.credit_score_range),
      requested:
        deal?.amount_requested != null
          ? Number(deal.amount_requested)
          : m.amount_requested != null
            ? Number(m.amount_requested)
            : null,
      positions: null,
    });
    const name = m.business_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || "merchant";
    setLoadedFrom(deal?.deal_number ? `${name} · ${deal.deal_number}` : name);
    setQ("");
    setSearchOpen(false);
  }, []);

  const assessments = useMemo(() => {
    const pool = includeUncontracted
      ? programs
      : programs.filter((p) => p.lender?.status === "live_vendor");
    return pool
      .map((p) => evaluate(p, inputs))
      .sort((a, b) => {
        const d = VERDICT_META[a.verdict].order - VERDICT_META[b.verdict].order;
        if (d !== 0) return d;
        return (b.offerHi ?? 0) - (a.offerHi ?? 0);
      });
  }, [programs, inputs, includeUncontracted]);

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { likely: 0, stretch: 0, blocked: 0, unknown: 0 };
    assessments.forEach((a) => c[a.verdict]++);
    return c;
  }, [assessments]);

  const hasRevenue = (inputs.revenue ?? 0) > 0;
  const rev = inputs.revenue ?? 0;
  const realisticLo = Math.round((rev * DEFAULT_PCT_LO) / 100);
  const realisticHi = Math.round((rev * DEFAULT_PCT_HI) / 100);
  const multiple = hasRevenue && inputs.requested ? inputs.requested / rev : null;

  const multipleTone =
    multiple == null
      ? ""
      : multiple <= 1.2
        ? "text-emerald-600 dark:text-emerald-400"
        : multiple <= 1.5
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  const set = (k: keyof QualifierInputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputs((prev) => ({ ...prev, [k]: v === "" ? null : Number(v) }));
    setLoadedFrom(null);
  };

  const fieldCls =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm tabular-nums text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <BoltIcon className="w-5 h-5 text-mint-green flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Who do they qualify for?</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Type a merchant's numbers, or pull a live deal from the pipeline. An advance is sized off{" "}
              <b>monthly revenue</b> — not off what they asked for.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 flex-shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={includeUncontracted}
            onChange={(e) => setIncludeUncontracted(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue"
          />
          Include funders we haven't signed
        </label>
      </div>

      {/* ── Merchant search: pull a real deal in ───────────────────────────── */}
      <div ref={searchRef} className="relative mb-4">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Find a live merchant in the pipeline (business or contact name)…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue"
          />
        </div>
        {searchOpen && hits.length > 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
            {hits.map((m) => {
              const deal = m.deals?.[0];
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => loadMerchant(m)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {m.business_name || [m.first_name, m.last_name].filter(Boolean).join(" ")}
                    </span>
                    {deal?.deal_number && (
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{deal.deal_number}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {m.monthly_revenue ? `${money(Number(m.monthly_revenue))}/mo` : "revenue unknown"}
                    {deal?.amount_requested ? ` · asking ${money(Number(deal.amount_requested))}` : ""}
                    {m.time_in_business ? ` · ${m.time_in_business} mo in business` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The five inputs ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
            Monthly revenue
          </label>
          <input type="number" value={inputs.revenue ?? ""} onChange={set("revenue")} placeholder="20000" className={fieldCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
            Time in business <span className="font-normal">(mo)</span>
          </label>
          <input type="number" value={inputs.tib ?? ""} onChange={set("tib")} placeholder="24" className={fieldCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
            FICO <span className="font-normal">(blank = unknown)</span>
          </label>
          <input type="number" value={inputs.fico ?? ""} onChange={set("fico")} placeholder="580" className={fieldCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
            They're asking for
          </label>
          <input type="number" value={inputs.requested ?? ""} onChange={set("requested")} placeholder="50000" className={fieldCls} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
            Open positions
          </label>
          <input type="number" value={inputs.positions ?? ""} onChange={set("positions")} placeholder="0" className={fieldCls} />
        </div>
      </div>

      {loadedFrom && (
        <div className="mt-3 inline-flex items-center gap-2 text-xs bg-ocean-blue/10 text-ocean-blue dark:text-mint-green px-2.5 py-1 rounded-full">
          Loaded from <b>{loadedFrom}</b>
          <button type="button" onClick={() => { setInputs(EMPTY); setLoadedFrom(null); }} title="Clear">
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── The God's-eye verdict ──────────────────────────────────────────── */}
      {hasRevenue && (
        <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Realistic advance
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                {money(realisticLo)} – {money(realisticHi)}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {DEFAULT_PCT_LO}–{DEFAULT_PCT_HI}% of {money(rev)}/mo
              </div>
            </div>

            {multiple != null && (
              <div>
                <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  They asked for
                </div>
                <div className={`text-xl font-bold tabular-nums ${multipleTone}`}>
                  {money(inputs.requested!)}
                </div>
                <div className={`text-[11px] font-medium ${multipleTone}`}>
                  {multiple.toFixed(1)}× monthly revenue
                  {multiple > 1.5 ? " — reset the expectation" : multiple > 1.2 ? " — a stretch" : " — in range"}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {(["likely", "stretch", "unknown", "blocked"] as Verdict[]).map((v) => (
                <span
                  key={v}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${VERDICT_META[v].chip}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${VERDICT_META[v].dot}`} />
                  {counts[v]} {VERDICT_META[v].label}
                </span>
              ))}
            </div>
          </div>

          {multiple != null && multiple > 1.5 && (
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700 pt-3">
              <b>On the phone:</b> don't submit this at {money(inputs.requested!)} — you'll collect declines. Size it
              at about one month of revenue, get them funded around {money(realisticHi)} now, then renew them up at
              40–50% paydown. Two commissions instead of zero.
            </p>
          )}
        </div>
      )}

      {/* ── Funder-by-funder ───────────────────────────────────────────────── */}
      {!hasRevenue ? (
        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          Enter a monthly revenue (or load a merchant) to see who they qualify for.
        </p>
      ) : loading ? (
        <p className="mt-5 text-sm text-gray-500 text-center py-6">Loading funder criteria…</p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {assessments.map((a) => {
            const meta = VERDICT_META[a.verdict];
            const lender = a.program.lender!;
            return (
              <div
                key={a.program.id}
                className={`rounded-xl border p-3 ${
                  a.verdict === "blocked"
                    ? "border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 opacity-75"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/lenders/${lender.id}`}
                      className="font-semibold text-sm text-ocean-blue hover:underline"
                    >
                      {lender.company_name}
                    </Link>
                    {lender.status !== "live_vendor" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-semibold">
                        not signed
                      </span>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border flex-shrink-0 ${meta.chip}`}
                  >
                    <meta.Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                </div>

                {a.verdict !== "blocked" && a.offerLo != null && (
                  <div className="mt-1.5 text-sm text-gray-900 dark:text-white tabular-nums font-medium">
                    {money(a.offerLo)} – {money(a.offerHi!)}
                    <span className="text-[11px] font-normal text-gray-400 ml-1.5">likely advance</span>
                  </div>
                )}

                {a.blockers.map((b, n) => (
                  <p key={n} className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                    ⛔ {b}
                  </p>
                ))}
                {a.warnings.map((w, n) => (
                  <p key={n} className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    ⚠ {w}
                  </p>
                ))}
                {a.verdict === "unknown" && (
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    No criteria on file — fill in this funder's box to judge it.
                  </p>
                )}
                {a.verdict !== "blocked" &&
                  a.notes.map((nt, n) => (
                    <p key={n} className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {nt}
                    </p>
                  ))}

                {a.verdict !== "blocked" && (a.program.cost_of_capital || a.program.time_to_approve) && (
                  <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500 line-clamp-1">
                    {[a.program.time_to_approve, a.program.cost_of_capital].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
