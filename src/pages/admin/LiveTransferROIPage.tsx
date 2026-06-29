import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PhoneArrowUpRightIcon,
  CurrencyDollarIcon,
  CalculatorIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon,
  XCircleIcon,
  BanknotesIcon,
  UserGroupIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import PageGuide from '../../components/admin/PageGuide';

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(v) ? v : 0);

const fmtNum = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '—';

// ----------------------------------------------------------------------------
// Slider
// ----------------------------------------------------------------------------
function Slider({
  value,
  onChange,
  min,
  max,
  step,
  label,
  suffix = '',
  color = '#00A896',
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix?: string;
  color?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = suffix === '$' ? fmt(value) : `${value}${suffix}`;
  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <motion.span
          key={value}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-lg font-bold"
          style={{ color }}
        >
          {display}
        </motion.span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)`,
        }}
      />
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{suffix === '$' ? fmt(min) : `${min}${suffix}`}</span>
        <span>{suffix === '$' ? fmt(max) : `${max}${suffix}`}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Metric card
// ----------------------------------------------------------------------------
function MetricCard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
  highlight,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  color: string;
  highlight?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`p-5 rounded-2xl border shadow-sm ${
        highlight
          ? 'bg-gradient-to-br from-mint-green/10 to-teal/10 border-mint-green/30'
          : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" style={{ color }} />
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="text-2xl font-bold"
          style={{ color }}
        >
          {value}
        </motion.p>
      </AnimatePresence>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------
export default function LiveTransferROIPage() {
  const [budget, setBudget] = useState(3000);
  const [costPerTransfer, setCostPerTransfer] = useState(75);
  const [qualifyRate, setQualifyRate] = useState(60); // % of transfers that become a real qualified conversation
  const [closeRate, setCloseRate] = useState(8); // % of transfers that fund
  const [commissionPerDeal, setCommissionPerDeal] = useState(4000);
  const [closerSplit, setCloserSplit] = useState(0); // % paid to closer

  const c = useMemo(() => {
    const transfers = costPerTransfer > 0 ? budget / costPerTransfer : 0;
    const qualified = transfers * (qualifyRate / 100);
    const funded = transfers * (closeRate / 100);
    const grossRevenue = funded * commissionPerDeal;
    const closerPay = grossRevenue * (closerSplit / 100);
    const netRevenue = grossRevenue - closerPay; // your net after closer split
    const profit = netRevenue - budget;
    const costPerFundedDeal = funded > 0 ? budget / funded : Infinity;
    const roi = budget > 0 ? grossRevenue / budget : 0;

    // Break-even transfers: how many transfers must you buy before net revenue
    // covers their cost. Net revenue per transfer = closeRate * commission * (1 - split).
    const netRevPerTransfer = (closeRate / 100) * commissionPerDeal * (1 - closerSplit / 100);
    const breakEvenTransfers =
      netRevPerTransfer > costPerTransfer && netRevPerTransfer > 0
        ? costPerTransfer / netRevPerTransfer // transfers needed so 1 unit of net rev >= cost is trivial; use ratio form below
        : Infinity;
    // More intuitive: transfers needed for cumulative net revenue to equal spend.
    // spend = n * costPerTransfer ; netRev = n * netRevPerTransfer.
    // They cross only if netRevPerTransfer >= costPerTransfer (per-unit profitable).
    // Report the number of transfers at which net revenue first covers a *funded deal's* worth of spend:
    const breakEvenTransfersToFundOne = closeRate > 0 ? 100 / closeRate : Infinity;

    return {
      transfers,
      qualified,
      funded,
      grossRevenue,
      closerPay,
      netRevenue,
      profit,
      costPerFundedDeal,
      roi,
      netRevPerTransfer,
      breakEvenTransfers,
      breakEvenTransfersToFundOne,
    };
  }, [budget, costPerTransfer, qualifyRate, closeRate, commissionPerDeal, closerSplit]);

  // Scenario table across close rates
  const scenarios = useMemo(() => {
    const transfers = costPerTransfer > 0 ? budget / costPerTransfer : 0;
    return [3, 5, 8, 12].map((rate) => {
      const funded = transfers * (rate / 100);
      const grossRevenue = funded * commissionPerDeal;
      const netRevenue = grossRevenue * (1 - closerSplit / 100);
      const profit = netRevenue - budget;
      const cpfd = funded > 0 ? budget / funded : Infinity;
      return { rate, funded, grossRevenue, netRevenue, profit, cpfd };
    });
  }, [budget, costPerTransfer, commissionPerDeal, closerSplit]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <PhoneArrowUpRightIcon className="w-7 h-7 text-mint-green" />
              Live Phone Transfer ROI
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Model the unit economics of buying live MCA phone transfers
            </p>
          </div>
          <div className="text-right bg-mint-green/10 dark:bg-mint-green/20 rounded-lg px-4 py-2">
            <p className="text-xs text-mint-green font-medium uppercase tracking-wide">Target</p>
            <p className="font-semibold text-gray-700 dark:text-gray-200">Cost / funded deal &lt; $1,500</p>
          </div>
        </div>
      </div>

      <div className="p-8">
        <PageGuide
          title="Live Transfer ROI"
          storageKey="lt-roi"
          what="A focused calculator for MCA live-transfer unit economics."
          value="Model whether a vendor/price is profitable before you spend."
          howToUse={[
            "Enter budget, cost/transfer, close rate, and commission.",
            "Compare the 3/5/8/12% scenarios.",
          ]}
          howToRead="Underwrite to a ~3% close floor; watch cost-per-funded-deal."
        />

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Inputs */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold text-midnight-blue flex items-center gap-2">
              <CalculatorIcon className="w-5 h-5 text-mint-green" /> Assumptions
            </h2>
            <Slider value={budget} onChange={setBudget} min={500} max={25000} step={500} label="Monthly Budget" suffix="$" color="#00D49D" />
            <Slider value={costPerTransfer} onChange={setCostPerTransfer} min={25} max={200} step={5} label="Cost / Live Transfer" suffix="$" color="#007EA7" />
            <Slider value={qualifyRate} onChange={setQualifyRate} min={20} max={100} step={5} label="Contact / Qualify Rate" suffix="%" color="#00A896" />
            <Slider value={closeRate} onChange={setCloseRate} min={1} max={20} step={0.5} label="Close Rate (transfers that fund)" suffix="%" color="#9333EA" />
            <Slider value={commissionPerDeal} onChange={setCommissionPerDeal} min={1000} max={12000} step={250} label="Commission / Funded Deal" suffix="$" color="#F59E0B" />
            <Slider value={closerSplit} onChange={setCloserSplit} min={0} max={70} step={5} label="Closer Split (0 = you close)" suffix="%" color="#E11D48" />

            <div className="text-xs text-gray-500 bg-amber-50 rounded-xl p-4 border border-amber-100 flex items-start gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p>
                Underwrite to a <strong>~3% close-rate floor</strong> — if the math only works above 8%, a
                slow month wipes out profit. Keep <strong>cost per funded deal under $1,500</strong> against
                a ~$4,000 average commission (the Golden Ratio).
              </p>
            </div>
          </div>

          {/* Outputs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Funnel metrics */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Transfers Bought"
                value={fmtNum(c.transfers, 0)}
                subValue={`${fmt(budget)} ÷ ${fmt(costPerTransfer)}`}
                icon={PhoneArrowUpRightIcon}
                color="#007EA7"
              />
              <MetricCard
                label="Qualified Convos"
                value={fmtNum(c.qualified, 0)}
                subValue={`${qualifyRate}% of transfers`}
                icon={UserGroupIcon}
                color="#00A896"
              />
              <MetricCard
                label="Funded Deals"
                value={fmtNum(c.funded, 1)}
                subValue={`${closeRate}% close rate`}
                icon={CheckCircleIcon}
                color="#9333EA"
              />
            </div>

            {/* Money metrics */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Gross Revenue"
                value={fmt(c.grossRevenue)}
                subValue={`${fmtNum(c.funded, 1)} × ${fmt(commissionPerDeal)}`}
                icon={BanknotesIcon}
                color="#00D49D"
              />
              <MetricCard
                label="Your Net"
                value={fmt(c.netRevenue)}
                subValue={closerSplit > 0 ? `after ${closerSplit}% closer split (${fmt(c.closerPay)})` : 'you close — no split'}
                icon={ArrowTrendingUpIcon}
                color="#007EA7"
              />
              <MetricCard
                label="Profit"
                value={fmt(c.profit)}
                subValue={`net − ${fmt(budget)} budget`}
                icon={CurrencyDollarIcon}
                color={c.profit >= 0 ? '#00D49D' : '#DC2626'}
                highlight={c.profit >= 0}
              />
            </div>

            {/* Efficiency metrics */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Cost / Funded Deal"
                value={Number.isFinite(c.costPerFundedDeal) ? fmt(c.costPerFundedDeal) : '—'}
                subValue={c.costPerFundedDeal <= 1500 ? 'Under $1,500 target ✓' : 'Above $1,500 target'}
                icon={ChartBarIcon}
                color={c.costPerFundedDeal <= 1500 ? '#00D49D' : '#DC2626'}
                highlight={Number.isFinite(c.costPerFundedDeal) && c.costPerFundedDeal <= 1500}
              />
              <MetricCard
                label="ROI"
                value={`${fmtNum(c.roi, 1)}×`}
                subValue="gross revenue ÷ budget"
                icon={ArrowTrendingUpIcon}
                color={c.roi >= 1 ? '#00D49D' : '#DC2626'}
              />
              <MetricCard
                label="Break-even Transfers"
                value={Number.isFinite(c.breakEvenTransfersToFundOne) ? fmtNum(c.breakEvenTransfersToFundOne, 0) : '—'}
                subValue="transfers to fund 1 deal"
                icon={PhoneArrowUpRightIcon}
                color="#6B7280"
              />
            </div>

            {/* Per-transfer economics callout */}
            <div
              className={`rounded-2xl p-5 border flex items-start gap-3 ${
                c.netRevPerTransfer >= costPerTransfer
                  ? 'bg-mint-green/5 border-mint-green/20'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              {c.netRevPerTransfer >= costPerTransfer ? (
                <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
              ) : (
                <XCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
              )}
              <div className="text-sm text-gray-700">
                <p className="font-semibold mb-1">
                  Net revenue per transfer: {fmt(c.netRevPerTransfer)} vs. {fmt(costPerTransfer)} cost
                </p>
                <p>
                  {c.netRevPerTransfer >= costPerTransfer
                    ? `Each transfer is profitable on average — every transfer returns about ${fmt(
                        c.netRevPerTransfer - costPerTransfer,
                      )} after its cost. Scale spend.`
                    : `Each transfer loses about ${fmt(
                        costPerTransfer - c.netRevPerTransfer,
                      )} on average at these inputs. Raise close rate, lower transfer cost, or increase deal commission before scaling.`}
                </p>
              </div>
            </div>

            {/* Scenario table */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-1 flex items-center gap-2">
                <ChartBarIcon className="w-5 h-5 text-mint-green" /> Scenario by Close Rate
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                At {fmt(budget)} budget · {fmtNum(c.transfers, 0)} transfers · {fmt(commissionPerDeal)}/deal
                {closerSplit > 0 ? ` · ${closerSplit}% closer split` : ''}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3 font-semibold">Close %</th>
                      <th className="py-2 px-2 font-semibold text-right">Funded</th>
                      <th className="py-2 px-2 font-semibold text-right">Gross Rev</th>
                      <th className="py-2 px-2 font-semibold text-right">Your Net</th>
                      <th className="py-2 px-2 font-semibold text-right">Profit</th>
                      <th className="py-2 pl-2 font-semibold text-right">Cost / Deal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((s) => (
                      <tr
                        key={s.rate}
                        className={`border-b border-gray-100 ${s.rate === closeRate ? 'bg-mint-green/5' : ''}`}
                      >
                        <td className="py-3 pr-3 font-semibold text-gray-800">
                          {s.rate}%{s.rate === 3 && <span className="ml-1 text-[10px] text-amber-600">floor</span>}
                          {s.rate === closeRate && <span className="ml-1 text-[10px] text-mint-green">current</span>}
                        </td>
                        <td className="py-3 px-2 text-right tabular-nums text-gray-700">{fmtNum(s.funded, 1)}</td>
                        <td className="py-3 px-2 text-right tabular-nums text-ocean-blue font-medium">{fmt(s.grossRevenue)}</td>
                        <td className="py-3 px-2 text-right tabular-nums text-gray-700">{fmt(s.netRevenue)}</td>
                        <td className={`py-3 px-2 text-right tabular-nums font-semibold ${s.profit >= 0 ? 'text-mint-green' : 'text-red-500'}`}>
                          {s.profit >= 0 ? '+' : ''}{fmt(s.profit)}
                        </td>
                        <td className={`py-3 pl-2 text-right tabular-nums ${Number.isFinite(s.cpfd) && s.cpfd <= 1500 ? 'text-mint-green font-medium' : 'text-gray-600'}`}>
                          {Number.isFinite(s.cpfd) ? fmt(s.cpfd) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-mint-green/40 inline-block" /> Current close rate
                </span>
                <span>Cost / deal under $1,500 shown in green</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
