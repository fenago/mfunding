import { useMemo, useState } from "react";
import {
  CalculatorIcon,
  ArrowPathIcon,
  SparklesIcon,
  ScaleIcon,
  PhoneArrowUpRightIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

// ============================================================================
// Lead-Buying Budget Calculator
// "If I put $X into Synergy Direct Solution's products, where should it go?"
//
// Channels + default cost/unit are seeded from Synergy's rate card (the PDF the
// owner shared). Close rates are conservative MCA-funnel estimates and are fully
// editable — they are the single biggest lever, so the tool is built for the
// owner to flex them and stress-test the plan.
// ============================================================================

type ChannelKey =
  | "live_transfer"
  | "realtime"
  | "aged_transfer"
  | "telemarketing"
  | "ucc"
  | "aged_leads";

interface Channel {
  key: ChannelKey;
  name: string;
  blurb: string;
  unitLabel: string; // transfers | leads | appointments | records
  costPerUnit: number; // $ per unit (from Synergy, volume-aware)
  closeRate: number; // % of units purchased that become a FUNDED deal
  alloc: number; // $ allocated to this channel
}

// Recommended $5,000 launch plan (live-transfer–led, with small learning tests).
const RECOMMENDED: Record<ChannelKey, number> = {
  live_transfer: 3000,
  realtime: 1000,
  aged_transfer: 400,
  telemarketing: 300,
  ucc: 200,
  aged_leads: 100,
};

const BASE_CHANNELS: Omit<Channel, "alloc">[] = [
  {
    key: "live_transfer",
    name: "Live Transfers",
    blurb: "Merchant qualified live and the call is transferred to your closer in real time. Highest intent. Needs a closer on the phones.",
    unitLabel: "transfers",
    costPerUnit: 30, // 50+ tier; drops to $25 at 100+, $20 at 200+
    closeRate: 7,
  },
  {
    key: "realtime",
    name: "Real-Time / Appointment Leads",
    blurb: "Pre-qualified merchant's info delivered the moment they submit (or with a booked callback). You call them — speed-to-lead matters.",
    unitLabel: "leads",
    costPerUnit: 15, // 50 tier; $10 at 100+
    closeRate: 4,
  },
  {
    key: "aged_transfer",
    name: "Aged Live Transfers",
    blurb: "Full qualification details from prior live-transfer campaigns, 30–120 days old, without the live call. Cheaper, colder.",
    unitLabel: "leads",
    costPerUnit: 4, // 60–89d tier
    closeRate: 1.5,
  },
  {
    key: "telemarketing",
    name: "Telemarketing Agent",
    blurb: "$12/hr × 25 hr/wk (~$300/wk). Agent dials your data and books appointments. Cost shown per appointment booked — adjust to your agent's output.",
    unitLabel: "appointments",
    costPerUnit: 50, // ~$300/wk ÷ ~6 appointments/wk
    closeRate: 5,
  },
  {
    key: "ucc",
    name: "UCC Leads (data)",
    blurb: "Owners who already took a loan/advance. Raw records you must dial. Very cheap, but funded-rate is tiny and labor-dependent (pair with an agent).",
    unitLabel: "records",
    costPerUnit: 0.05,
    closeRate: 0.05,
  },
  {
    key: "aged_leads",
    name: "Aged Leads (data)",
    blurb: "Cold aged records for dialing/SMS/email. Cheapest volume, lowest intent. Only works if you have the labor to dial it.",
    unitLabel: "records",
    costPerUnit: 0.05,
    closeRate: 0.03,
  },
];

const fmtMoney = (n: number) =>
  !Number.isFinite(n)
    ? "—"
    : `$${Math.round(n).toLocaleString()}`;

const fmtUnits = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 });

export default function LeadBudgetCalculatorPage() {
  const [budget, setBudget] = useState(5000);
  const [avgDeal, setAvgDeal] = useState(50000);
  const [commissionPct, setCommissionPct] = useState(8);
  const [channels, setChannels] = useState<Channel[]>(
    BASE_CHANNELS.map((c) => ({ ...c, alloc: RECOMMENDED[c.key] })),
  );

  const revPerFunded = Math.round(avgDeal * (commissionPct / 100));

  const update = (i: number, field: "alloc" | "costPerUnit" | "closeRate", value: number) =>
    setChannels((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: Math.max(0, value) } : c)));

  const loadRecommended = () =>
    setChannels((prev) => prev.map((c) => ({ ...c, alloc: RECOMMENDED[c.key] })));
  const evenSplit = () => {
    const each = Math.round(budget / channels.length);
    setChannels((prev) => prev.map((c) => ({ ...c, alloc: each })));
  };
  const allIn = (key: ChannelKey) =>
    setChannels((prev) => prev.map((c) => ({ ...c, alloc: c.key === key ? budget : 0 })));
  const normalize = () => {
    const total = channels.reduce((s, c) => s + c.alloc, 0);
    if (total <= 0) return;
    setChannels((prev) => prev.map((c) => ({ ...c, alloc: Math.round((c.alloc / total) * budget) })));
  };

  const rows = channels.map((c) => {
    const units = c.costPerUnit > 0 ? c.alloc / c.costPerUnit : 0;
    const funded = units * (c.closeRate / 100);
    const revenue = funded * revPerFunded;
    const profit = revenue - c.alloc;
    const cpf = funded > 0 ? c.alloc / funded : Infinity;
    const roi = c.alloc > 0 ? revenue / c.alloc : 0;
    return { c, units, funded, revenue, profit, cpf, roi };
  });

  const totals = useMemo(() => {
    const alloc = rows.reduce((s, r) => s + r.c.alloc, 0);
    const funded = rows.reduce((s, r) => s + r.funded, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    return {
      alloc,
      funded,
      revenue,
      profit: revenue - alloc,
      cpf: funded > 0 ? alloc / funded : Infinity,
      roi: alloc > 0 ? revenue / alloc : 0,
      remaining: budget - alloc,
    };
  }, [rows, budget]);

  const bestRoi = Math.max(...rows.map((r) => r.roi), 0);
  const over = totals.remaining < -0.5;
  const under = totals.remaining > 0.5;

  const numCls =
    "w-full px-2 py-1 text-sm text-right rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-800 focus:border-ocean-blue outline-none tabular-nums";

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <CalculatorIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lead-Buying Budget Calculator</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Plan where to put a lead budget across Synergy Direct Solution's products. Edit any number — the
            close rates are estimates and are the biggest lever, so flex them to stress-test the plan.
          </p>
        </div>
      </div>

      {/* How to read */}
      <div className="bg-ocean-blue/5 dark:bg-ocean-blue/10 border border-ocean-blue/20 rounded-xl p-4 mb-6 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white mb-1">
          <InformationCircleIcon className="w-5 h-5 text-ocean-blue" /> How to read this
        </div>
        <ul className="list-disc ml-6 space-y-0.5">
          <li><b>Allocation</b> = how much of the budget you put into each channel (the bars must add up to your total budget).</li>
          <li><b>Units</b> = how many transfers/leads/records that buys. <b>Close %</b> = how many of those become a <i>funded</i> deal.</li>
          <li><b>Cost/funded</b> is the number that matters most — keep it under <b>$1,500</b> (the "golden ratio") and you're profitable.</li>
          <li>Raw data (UCC / Aged) is cheap but needs an agent to dial it — that's why the <b>Telemarketing Agent</b> line pairs with it.</li>
        </ul>
      </div>

      {/* Global controls */}
      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total budget</span>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xl font-bold text-mint-green">$</span>
            <input type="number" min={0} step={500} value={budget}
              onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
              className="w-full text-xl font-bold text-mint-green bg-transparent outline-none" />
          </div>
        </label>
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Avg funded deal</span>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xl font-bold text-gray-900 dark:text-white">$</span>
            <input type="number" min={0} step={5000} value={avgDeal}
              onChange={(e) => setAvgDeal(Math.max(0, Number(e.target.value)))}
              className="w-full text-xl font-bold text-gray-900 dark:text-white bg-transparent outline-none" />
          </div>
        </label>
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Commission — ${revPerFunded.toLocaleString()} / funded deal
          </span>
          <div className="flex items-center gap-1 mt-1">
            <input type="number" min={0} step={0.5} value={commissionPct}
              onChange={(e) => setCommissionPct(Math.max(0, Number(e.target.value)))}
              className="w-full text-xl font-bold text-gray-900 dark:text-white bg-transparent outline-none" />
            <span className="text-xl font-bold text-gray-900 dark:text-white">%</span>
          </div>
        </label>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={loadRecommended}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-midnight-blue text-sm font-semibold hover:opacity-90">
          <SparklesIcon className="w-4 h-4" /> Load recommended $5K plan
        </button>
        <button onClick={() => allIn("live_transfer")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-ocean-blue">
          <PhoneArrowUpRightIcon className="w-4 h-4" /> All-in live transfers
        </button>
        <button onClick={evenSplit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-ocean-blue">
          <ScaleIcon className="w-4 h-4" /> Even split
        </button>
        <button onClick={normalize}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-ocean-blue">
          <ArrowPathIcon className="w-4 h-4" /> Fit allocations to budget
        </button>
        <span className={`ml-auto text-sm font-semibold ${over ? "text-red-500" : under ? "text-amber-500" : "text-mint-green"}`}>
          Allocated {fmtMoney(totals.alloc)} of {fmtMoney(budget)}
          {over && ` — over by ${fmtMoney(-totals.remaining)}`}
          {under && ` — ${fmtMoney(totals.remaining)} unallocated`}
        </span>
      </div>

      {/* Channel table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-3 px-4 font-semibold">Channel</th>
              <th className="py-3 px-2 font-semibold text-right">Allocation</th>
              <th className="py-3 px-2 font-semibold text-right">Cost / unit</th>
              <th className="py-3 px-2 font-semibold text-right">Units</th>
              <th className="py-3 px-2 font-semibold text-right">Close %</th>
              <th className="py-3 px-2 font-semibold text-right">Funded</th>
              <th className="py-3 px-2 font-semibold text-right">Revenue</th>
              <th className="py-3 px-2 font-semibold text-right">Cost / funded</th>
              <th className="py-3 px-4 font-semibold text-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, units, funded, revenue, cpf, roi }, i) => (
              <tr key={c.key}
                className={`border-b border-gray-100 dark:border-gray-700/50 ${roi === bestRoi && roi > 0 ? "bg-mint-green/5" : ""}`}>
                <td className="py-3 px-4 align-top">
                  <p className="font-semibold text-gray-900 dark:text-white">{c.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-[260px] mt-0.5">{c.blurb}</p>
                </td>
                <td className="py-3 px-2 align-top">
                  <div className="flex items-center gap-1 justify-end">
                    <span className="text-gray-400">$</span>
                    <input type="number" min={0} step={50} value={c.alloc}
                      onChange={(e) => update(i, "alloc", Number(e.target.value))}
                      className={`${numCls} w-24`} />
                  </div>
                  <input type="range" min={0} max={budget} step={50} value={Math.min(c.alloc, budget)}
                    onChange={(e) => update(i, "alloc", Number(e.target.value))}
                    className="w-28 mt-1 accent-mint-green cursor-pointer" />
                  <span className="block text-[10px] text-gray-400 text-right">
                    {totals.alloc > 0 ? Math.round((c.alloc / totals.alloc) * 100) : 0}% of plan
                  </span>
                </td>
                <td className="py-3 px-2 align-top text-right">
                  <input type="number" min={0} step={c.costPerUnit < 5 ? 0.01 : 1} value={c.costPerUnit}
                    onChange={(e) => update(i, "costPerUnit", Number(e.target.value))}
                    className={`${numCls} w-20`} />
                  <span className="block text-[10px] text-gray-400">/{c.unitLabel.replace(/s$/, "")}</span>
                </td>
                <td className="py-3 px-2 align-top text-right tabular-nums text-gray-600 dark:text-gray-300">
                  {fmtUnits(units)}
                  <span className="block text-[10px] text-gray-400">{c.unitLabel}</span>
                </td>
                <td className="py-3 px-2 align-top text-right">
                  <input type="number" min={0} step={0.05} value={c.closeRate}
                    onChange={(e) => update(i, "closeRate", Number(e.target.value))}
                    className={`${numCls} w-16`} />
                </td>
                <td className="py-3 px-2 align-top text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                  {funded.toFixed(1)}
                </td>
                <td className="py-3 px-2 align-top text-right tabular-nums font-semibold text-ocean-blue">
                  {fmtMoney(revenue)}
                </td>
                <td className={`py-3 px-2 align-top text-right tabular-nums font-medium ${
                  Number.isFinite(cpf) ? (cpf <= 1500 ? "text-mint-green" : "text-amber-500") : "text-gray-400"
                }`}>
                  {Number.isFinite(cpf) ? fmtMoney(cpf) : "—"}
                </td>
                <td className={`py-3 px-4 align-top text-right tabular-nums font-bold ${roi >= 1 ? "text-mint-green" : "text-red-500"}`}>
                  {roi > 0 ? `${roi.toFixed(1)}×` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold text-gray-900 dark:text-white">
              <td className="py-3 px-4">Totals</td>
              <td className="py-3 px-2 text-right tabular-nums">{fmtMoney(totals.alloc)}</td>
              <td></td>
              <td></td>
              <td></td>
              <td className="py-3 px-2 text-right tabular-nums">{totals.funded.toFixed(1)}</td>
              <td className="py-3 px-2 text-right tabular-nums text-ocean-blue">{fmtMoney(totals.revenue)}</td>
              <td className={`py-3 px-2 text-right tabular-nums ${totals.cpf <= 1500 ? "text-mint-green" : "text-amber-500"}`}>
                {fmtMoney(totals.cpf)}
              </td>
              <td className="py-3 px-4 text-right tabular-nums text-mint-green">
                {totals.roi > 0 ? `${totals.roi.toFixed(1)}×` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Result summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: "Funded deals", value: totals.funded.toFixed(1), sub: "estimated" },
          { label: "Revenue (commission)", value: fmtMoney(totals.revenue), sub: `@ ${fmtMoney(revPerFunded)}/deal` },
          { label: "Net profit", value: fmtMoney(totals.profit), sub: `on ${fmtMoney(totals.alloc)} spend`, good: totals.profit >= 0 },
          { label: "Cost / funded deal", value: fmtMoney(totals.cpf), sub: "target < $1,500", good: totals.cpf <= 1500 },
          { label: "Return on spend", value: totals.roi > 0 ? `${totals.roi.toFixed(1)}×` : "—", sub: "revenue ÷ spend", good: totals.roi >= 1 },
        ].map((card) => (
          <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className={`text-2xl font-extrabold mt-1 ${
              card.good === undefined ? "text-gray-900 dark:text-white" : card.good ? "text-mint-green" : "text-red-500"
            }`}>{card.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Caveat */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200">
        <b>Reality check:</b> these outputs are only as good as the close rates you enter. Live-transfer funded
        rates of 5–10% are realistic <i>if a closer answers fast</i>; raw UCC/Aged data converts far lower and only
        if you actually dial it (that's the Telemarketing line). Treat the first 2–3 weeks as a measurement run:
        track your real transfer→funded rate, then come back and re-run this with your own numbers before scaling.
        MCA is funding / a purchase of future receivables — never a "loan."
      </div>
    </div>
  );
}
