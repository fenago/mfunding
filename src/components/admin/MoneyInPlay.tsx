import { useEffect, useMemo, useState } from "react";
import { BanknotesIcon, ArrowPathIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import supabase from "@/supabase";
import { COMMISSION_DEFAULTS } from "@/types/commissions";
import { FUND_ODDS, ADVANCE_CEILING_PCT, STAGE_LABEL, STAGE_ORDER } from "@/config/funnelOdds";

/**
 * Money in play — and what it actually pays.
 *
 * This exists because "pipeline value" is the easiest number in this business to lie
 * to yourself with. Three different numbers all get called "money in play", and they
 * are wildly different:
 *
 *   1. WHAT THEY ASKED FOR — the merchant's aspiration. Vanity. Our own leads ask for
 *      2-3x what their revenue supports ($18k/mo merchants asking $50k). Summing this
 *      column produces a pipeline that cannot exist.
 *   2. WHAT REVENUE SUPPORTS — an MCA is sized off monthly revenue (70-120% is the
 *      industry band; see the Funder Approval Matrix). This is the biggest advance a
 *      funder would plausibly write. It is the real ceiling.
 *   3. WHAT WILL ACTUALLY FUND — (2), weighted by each deal's odds of surviving the
 *      rest of the funnel. This is the forecast. It is the only one worth planning on.
 *
 * All three are shown, because hiding (1) doesn't stop anyone believing it — showing
 * it next to (2) and (3) is what kills it.
 *
 * COMMISSION. 8 points on new money (6 on renewals) is MFunding's gross. The closer's
 * cut is their company-lead split — 30% is the Momentum Standard and every closer is
 * on it today, but we read each closer's ACTUAL split from the closers table rather
 * than hardcoding, so this stays honest the moment someone escalates to 35% or 40%.
 * Unassigned deals fall back to the 30% default.
 */

// The stage ladder, the fund odds, and the revenue-based advance ceiling all live in
// @/config/funnelOdds (imported above) — shared with Revenue & Commission, which
// measures ACTUAL conversion against these same odds. Two copies would let the drift
// report drift away from the forecast it is supposed to be checking.

type Row = {
  id: string;
  status: string;
  amount_requested: number | null;
  assigned_closer_id: string | null;
  customer: { business_name: string | null; monthly_revenue: number | null } | null;
};

const usd = (n: number) =>
  n >= 1000
    ? "$" + Math.round(n).toLocaleString()
    : "$" + n.toFixed(0);

type Basis = "realistic" | "asked";

export default function MoneyInPlay() {
  const [rows, setRows] = useState<Row[]>([]);
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [basis, setBasis] = useState<Basis>("realistic");

  const load = async () => {
    setLoading(true);
    const [{ data: deals }, { data: closers }] = await Promise.all([
      supabase
        .from("deals")
        .select("id, status, amount_requested, assigned_closer_id, customer:customers!customer_id(business_name, monthly_revenue)")
        .in("status", STAGE_ORDER),
      supabase.from("closers").select("user_id, company_lead_split"),
    ]);
    setRows((deals ?? []) as unknown as Row[]);
    const m: Record<string, number> = {};
    for (const c of closers ?? []) {
      const uid = (c as { user_id?: string }).user_id;
      const s = Number((c as { company_lead_split?: unknown }).company_lead_split);
      if (uid && Number.isFinite(s)) m[uid] = s;
    }
    setSplits(m);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const calc = useMemo(() => {
    const perStage = new Map<
      string,
      { n: number; value: number; expected: number; gross: number; closer: number }
    >();
    let tAsked = 0, tValue = 0, tExpected = 0, tGross = 0, tCloser = 0;

    for (const d of rows) {
      const asked = Number(d.amount_requested ?? 0);
      const rev = Number(d.customer?.monthly_revenue ?? 0);
      // What a funder would actually write: capped by revenue, never above the ask.
      const ceiling = rev > 0 ? rev * ADVANCE_CEILING_PCT : asked;
      const realistic = asked > 0 ? Math.min(asked, ceiling) : ceiling;

      const value = basis === "asked" ? asked : realistic;
      const odds = FUND_ODDS[d.status] ?? 0;
      const expected = value * odds;

      const gross = (value * COMMISSION_DEFAULTS.NEW_DEAL_POINTS) / 100;
      const splitPct = (d.assigned_closer_id && splits[d.assigned_closer_id]) ||
        COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT;
      const closerCut = (gross * splitPct) / 100;

      tAsked += asked;
      tValue += value;
      tExpected += expected;
      tGross += gross;
      tCloser += closerCut;

      const cur = perStage.get(d.status) ?? { n: 0, value: 0, expected: 0, gross: 0, closer: 0 };
      cur.n += 1;
      cur.value += value;
      cur.expected += expected;
      cur.gross += gross;
      cur.closer += closerCut;
      perStage.set(d.status, cur);
    }

    const expectedGross = (tExpected * COMMISSION_DEFAULTS.NEW_DEAL_POINTS) / 100;
    const expectedCloser = (expectedGross * COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT) / 100;

    return {
      count: rows.length,
      tAsked, tValue, tExpected, tGross, tCloser,
      tCompany: tGross - tCloser,
      expectedGross,
      expectedCloser,
      expectedCompany: expectedGross - expectedCloser,
      perStage,
      // How much of the ask is pure fantasy — the number that starts the conversation.
      overAsk: tAsked - rows.reduce((s, d) => {
        const asked = Number(d.amount_requested ?? 0);
        const rev = Number(d.customer?.monthly_revenue ?? 0);
        const ceiling = rev > 0 ? rev * ADVANCE_CEILING_PCT : asked;
        return s + (asked > 0 ? Math.min(asked, ceiling) : ceiling);
      }, 0),
    };
  }, [rows, splits, basis]);

  const split = COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <BanknotesIcon className="w-6 h-6 text-mint-green flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Money in play</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {loading ? "Loading…" : `${calc.count} open deal${calc.count === 1 ? "" : "s"}`} · {COMMISSION_DEFAULTS.NEW_DEAL_POINTS} points gross ·{" "}
              {split}% closer split
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-[11px] font-semibold">
            <button
              onClick={() => setBasis("realistic")}
              className={`px-2.5 py-1 ${basis === "realistic" ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300"}`}
            >
              Realistic
            </button>
            <button
              onClick={() => setBasis("asked")}
              className={`px-2.5 py-1 ${basis === "asked" ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300"}`}
            >
              What they asked
            </button>
          </div>
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-gray-400 hover:text-ocean-blue">
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* The three headline numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="In play"
          value={usd(calc.tValue)}
          sub={basis === "realistic" ? "what revenue supports" : "what merchants asked for"}
          tone="text-gray-900 dark:text-white"
        />
        <Stat
          label={`Gross commission (${COMMISSION_DEFAULTS.NEW_DEAL_POINTS} pts)`}
          value={usd(calc.tGross)}
          sub="if every deal funded"
          tone="text-ocean-blue dark:text-mint-green"
        />
        <Stat
          label={`Closer commission (${split}%)`}
          value={usd(calc.tCloser)}
          sub="what we'd owe out"
          tone="text-amber-600 dark:text-amber-400"
        />
        <Stat
          label={`Company keeps (${100 - split}%)`}
          value={usd(calc.tCompany)}
          sub="if every deal funded"
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {/* The forecast — the same money, weighted by the odds of actually funding. */}
      <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Expected to fund
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{usd(calc.tExpected)}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">weighted by stage</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Expected gross
            </div>
            <div className="text-2xl font-bold text-ocean-blue dark:text-mint-green tabular-nums">
              {usd(calc.expectedGross)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Expected closer ({split}%)
            </div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {usd(calc.expectedCloser)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Expected to company
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {usd(calc.expectedCompany)}
            </div>
          </div>
        </div>
        <p className="mt-2 flex items-start gap-1 text-[11px] text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2">
          <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Stage odds are the funnel <b>targets</b> (new ≈ 6% → submitted ≈ 39% → offer accepted ≈ 88%), not measured
            history — there aren't enough funded deals to measure yet. Treat as a forecast, not a fact.
          </span>
        </p>
      </div>

      {/* The gap between the ask and reality — the thing that should drive a
          conversation with the lead vendor, not just a discount on the forecast. */}
      {calc.overAsk > 0 && (
        <div className="mt-3 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Merchants asked for <b>{usd(calc.tAsked)}</b>, but their revenue only supports about{" "}
          <b>{usd(calc.tAsked - calc.overAsk)}</b> — a <b>{usd(calc.overAsk)}</b> gap. An advance is sized off monthly
          revenue, so the difference isn't pipeline, it's an expectation to reset on the phone.{" "}
          <Link to="/admin/funder-matrix" className="underline font-semibold">
            Check who they qualify for →
          </Link>
        </div>
      )}

      {/* Stage-by-stage. */}
      {!loading && calc.count > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-3 font-semibold">Stage</th>
                <th className="py-2 px-3 font-semibold text-right">Deals</th>
                <th className="py-2 px-3 font-semibold text-right">In play</th>
                <th className="py-2 px-3 font-semibold text-right">Gross</th>
                <th className="py-2 px-3 font-semibold text-right">Closer {split}%</th>
                <th className="py-2 pl-3 font-semibold text-right">Expected</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.filter((s) => calc.perStage.has(s)).map((s) => {
                const r = calc.perStage.get(s)!;
                return (
                  <tr key={s} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">
                      {STAGE_LABEL[s]}
                      <span className="ml-1.5 text-[10px] text-gray-400 tabular-nums">
                        {Math.round((FUND_ODDS[s] ?? 0) * 100)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.n}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-900 dark:text-white">{usd(r.value)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-ocean-blue dark:text-mint-green">{usd(r.gross)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{usd(r.closer)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                      {usd(r.expected)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${tone}`}>{value}</div>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</div>
    </div>
  );
}
