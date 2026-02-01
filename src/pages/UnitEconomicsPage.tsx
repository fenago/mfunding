import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChartBarIcon,
  CalculatorIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  UserIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

// Format helpers
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

// Slider component
function Slider({
  value,
  onChange,
  min,
  max,
  step,
  formatValue,
  label,
  icon: Icon,
  color = '#007EA7',
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  label: string;
  icon: React.ElementType;
  color?: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color }} />
          <span className="text-sm font-medium text-gray-700">{label}</span>
        </div>
        <motion.span
          key={value}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-lg font-bold"
          style={{ color }}
        >
          {formatValue(value)}
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
          background: `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, #E5E7EB ${percentage}%, #E5E7EB 100%)`,
        }}
      />

      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}

// Toggle switch
function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
      <div>
        <p className="font-medium text-gray-700">{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-14 h-7 rounded-full transition-colors ${
          enabled ? 'bg-mint-green' : 'bg-gray-300'
        }`}
      >
        <motion.div
          className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md"
          animate={{ left: enabled ? '1.75rem' : '0.25rem' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

// Metric card
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
      className={`p-5 rounded-xl border ${
        highlight
          ? 'bg-gradient-to-br from-mint-green/10 to-teal/10 border-mint-green/30'
          : 'bg-white border-gray-200'
      } shadow-sm`}
      whileHover={{ scale: 1.02, y: -2 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" style={{ color }} />
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
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

// Comparison row
function ComparisonRow({
  label,
  withSales,
  withoutSales,
  isCurrency = true,
  isHighlightRow = false,
}: {
  label: string;
  withSales: number;
  withoutSales: number;
  isCurrency?: boolean;
  isHighlightRow?: boolean;
}) {
  const format = isCurrency ? formatCurrency : formatPercent;

  return (
    <div
      className={`grid grid-cols-3 gap-4 py-3 ${
        isHighlightRow ? 'bg-mint-green/5 -mx-4 px-4 rounded-lg' : ''
      }`}
    >
      <div className="font-medium text-gray-700">{label}</div>
      <div className={`text-center font-semibold ${isHighlightRow ? 'text-mint-green text-lg' : 'text-ocean-blue'}`}>
        {format(withSales)}
      </div>
      <div className={`text-center font-semibold ${isHighlightRow ? 'text-teal text-lg' : 'text-teal'}`}>
        {format(withoutSales)}
      </div>
    </div>
  );
}

export default function UnitEconomicsPage() {
  // Input state
  const [costPerLead, setCostPerLead] = useState(150);
  const [conversionRate, setConversionRate] = useState(15);
  const [avgDealSize, setAvgDealSize] = useState(75000);
  const [commissionRate, setCommissionRate] = useState(10);
  const [useSalesPerson, setUseSalesPerson] = useState(true);
  const [salesPersonPct, setSalesPersonPct] = useState(35);

  // Additional costs
  const [processingFee, setProcessingFee] = useState(2);
  const [monthlyOverhead, setMonthlyOverhead] = useState(5000);
  const [dealsPerMonth, setDealsPerMonth] = useState(10);

  // Per-deal fixed costs
  const [perDealFixedCosts, setPerDealFixedCosts] = useState(150); // UCC, verification, e-sign, etc.

  // Clawback / Default risk
  const [defaultRate, setDefaultRate] = useState(12); // % of deals that default early
  const [clawbackPct, setClawbackPct] = useState(100); // % of commission clawed back on default

  // CLTV / Renewals
  const [renewalRate, setRenewalRate] = useState(40);
  const [avgRenewals, setAvgRenewals] = useState(2);
  const [renewalCommission, setRenewalCommission] = useState(5);

  // Calculations
  const calculations = useMemo(() => {
    // Basic metrics
    const leadsNeededPerDeal = 100 / conversionRate;
    const costPerAcquisition = costPerLead * leadsNeededPerDeal;
    const grossCommission = avgDealSize * (commissionRate / 100);
    const processingCost = avgDealSize * (processingFee / 100);

    // Sales person cost
    const salesCommission = useSalesPerson ? grossCommission * (salesPersonPct / 100) : 0;
    const salesCommissionYouClose = 0;

    // Clawback risk (expected loss per deal based on default rate)
    const clawbackRiskWithSales = (grossCommission - salesCommission) * (defaultRate / 100) * (clawbackPct / 100);
    const clawbackRiskYouClose = grossCommission * (defaultRate / 100) * (clawbackPct / 100);

    // Net profit per deal (before overhead)
    const netProfitWithSales = grossCommission - salesCommission - costPerAcquisition - processingCost - perDealFixedCosts - clawbackRiskWithSales;
    const netProfitYouClose = grossCommission - salesCommissionYouClose - costPerAcquisition - processingCost - perDealFixedCosts - clawbackRiskYouClose;

    // Overhead per deal
    const overheadPerDeal = monthlyOverhead / dealsPerMonth;

    // Final profit (after overhead allocation)
    const finalProfitWithSales = netProfitWithSales - overheadPerDeal;
    const finalProfitYouClose = netProfitYouClose - overheadPerDeal;

    // ROI calculations
    const totalInvestmentWithSales = costPerAcquisition + processingCost + perDealFixedCosts + salesCommission + overheadPerDeal;
    const totalInvestmentYouClose = costPerAcquisition + processingCost + perDealFixedCosts + overheadPerDeal;
    const roiWithSales = totalInvestmentWithSales > 0 ? (finalProfitWithSales / totalInvestmentWithSales) * 100 : 0;
    const roiYouClose = totalInvestmentYouClose > 0 ? (finalProfitYouClose / totalInvestmentYouClose) * 100 : 0;

    // Break-even (accounting for clawback risk)
    const effectiveCommissionWithSales = (grossCommission - salesCommission) * (1 - (defaultRate / 100) * (clawbackPct / 100));
    const effectiveCommissionYouClose = grossCommission * (1 - (defaultRate / 100) * (clawbackPct / 100));
    const breakEvenLeadsWithSales = Math.ceil((costPerAcquisition + processingCost + perDealFixedCosts) / (effectiveCommissionWithSales - processingCost - perDealFixedCosts) * leadsNeededPerDeal) || 0;
    const breakEvenLeadsYouClose = Math.ceil((costPerAcquisition + processingCost + perDealFixedCosts) / (effectiveCommissionYouClose - processingCost - perDealFixedCosts) * leadsNeededPerDeal) || 0;

    // Monthly projections
    const monthlyRevenueWithSales = finalProfitWithSales * dealsPerMonth;
    const monthlyRevenueYouClose = finalProfitYouClose * dealsPerMonth;

    // CLTV calculations (renewals also subject to clawback risk, but typically lower)
    const renewalValue = avgDealSize * (renewalCommission / 100);
    const expectedRenewals = avgRenewals * (renewalRate / 100);
    const renewalRevenue = renewalValue * expectedRenewals;
    const renewalClawbackRisk = renewalRevenue * (defaultRate / 100) * (clawbackPct / 100) * 0.5; // Lower clawback risk on renewals

    const cltvWithSales = (grossCommission - salesCommission) * (1 - (defaultRate / 100) * (clawbackPct / 100)) +
                          (renewalRevenue - renewalRevenue * (salesPersonPct / 100)) * (1 - (defaultRate / 100) * (clawbackPct / 100) * 0.5);
    const cltvYouClose = grossCommission * (1 - (defaultRate / 100) * (clawbackPct / 100)) +
                         renewalRevenue * (1 - (defaultRate / 100) * (clawbackPct / 100) * 0.5);

    // Lead efficiency
    const revenuePerLead = (grossCommission * (conversionRate / 100));
    const profitPerLeadWithSales = (netProfitWithSales * (conversionRate / 100));
    const profitPerLeadYouClose = (netProfitYouClose * (conversionRate / 100));

    // Total cost breakdown for transparency
    const totalCostsWithSales = costPerAcquisition + processingCost + perDealFixedCosts + salesCommission + clawbackRiskWithSales + overheadPerDeal;
    const totalCostsYouClose = costPerAcquisition + processingCost + perDealFixedCosts + clawbackRiskYouClose + overheadPerDeal;

    return {
      leadsNeededPerDeal,
      costPerAcquisition,
      grossCommission,
      processingCost,
      salesCommission,
      perDealFixedCosts,
      clawbackRiskWithSales,
      clawbackRiskYouClose,
      netProfitWithSales,
      netProfitYouClose,
      overheadPerDeal,
      finalProfitWithSales,
      finalProfitYouClose,
      roiWithSales,
      roiYouClose,
      breakEvenLeadsWithSales,
      breakEvenLeadsYouClose,
      monthlyRevenueWithSales,
      monthlyRevenueYouClose,
      cltvWithSales,
      cltvYouClose,
      revenuePerLead,
      profitPerLeadWithSales,
      profitPerLeadYouClose,
      renewalRevenue,
      expectedRenewals,
      renewalClawbackRisk,
      totalCostsWithSales,
      totalCostsYouClose,
    };
  }, [
    costPerLead,
    conversionRate,
    avgDealSize,
    commissionRate,
    useSalesPerson,
    salesPersonPct,
    processingFee,
    monthlyOverhead,
    dealsPerMonth,
    perDealFixedCosts,
    defaultRate,
    clawbackPct,
    renewalRate,
    avgRenewals,
    renewalCommission,
  ]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <CalculatorIcon className="w-7 h-7 text-mint-green" />
              Unit Economics Calculator
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Analyze your MCA/lending business profitability
            </p>
          </div>
          <div className="text-right bg-mint-green/10 dark:bg-mint-green/20 rounded-lg px-4 py-2">
            <p className="text-xs text-mint-green font-medium uppercase tracking-wide">Comparing</p>
            <p className="font-semibold text-gray-700 dark:text-gray-200">With Sales Rep vs. You Closing</p>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Inputs */}
          <div className="lg:col-span-1 space-y-6">
            {/* Lead Acquisition */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <PhoneIcon className="w-5 h-5 text-ocean-blue" />
                Lead Acquisition
              </h2>
              <div className="space-y-4">
                <Slider
                  value={costPerLead}
                  onChange={setCostPerLead}
                  min={25}
                  max={500}
                  step={5}
                  formatValue={(v) => `$${v}`}
                  label="Cost Per Live Transfer Lead"
                  icon={CurrencyDollarIcon}
                  color="#007EA7"
                />
                <Slider
                  value={conversionRate}
                  onChange={setConversionRate}
                  min={5}
                  max={50}
                  step={1}
                  formatValue={(v) => `${v}%`}
                  label="Conversion Rate"
                  icon={ChartBarIcon}
                  color="#00A896"
                />
              </div>
            </div>

            {/* Deal Economics */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <BanknotesIcon className="w-5 h-5 text-mint-green" />
                Deal Economics
              </h2>
              <div className="space-y-4">
                <Slider
                  value={avgDealSize}
                  onChange={setAvgDealSize}
                  min={25000}
                  max={500000}
                  step={5000}
                  formatValue={(v) => `$${(v/1000).toFixed(0)}K`}
                  label="Average Deal Size"
                  icon={CurrencyDollarIcon}
                  color="#00D49D"
                />
                <Slider
                  value={commissionRate}
                  onChange={setCommissionRate}
                  min={5}
                  max={20}
                  step={0.5}
                  formatValue={(v) => `${v}%`}
                  label="Commission Rate"
                  icon={ChartBarIcon}
                  color="#00D49D"
                />
                <Slider
                  value={processingFee}
                  onChange={setProcessingFee}
                  min={0}
                  max={5}
                  step={0.25}
                  formatValue={(v) => `${v}%`}
                  label="Processing / Syndication Fee"
                  icon={ArrowPathIcon}
                  color="#6B7280"
                />
              </div>
            </div>

            {/* Sales Team */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <UserGroupIcon className="w-5 h-5 text-purple-600" />
                Sales Team
              </h2>
              <div className="space-y-4">
                <Toggle
                  enabled={useSalesPerson}
                  onChange={setUseSalesPerson}
                  label="Use Sales Person"
                  description="Toggle to compare scenarios"
                />
                {useSalesPerson && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Slider
                      value={salesPersonPct}
                      onChange={setSalesPersonPct}
                      min={20}
                      max={60}
                      step={5}
                      formatValue={(v) => `${v}%`}
                      label="Sales Person Commission %"
                      icon={UserIcon}
                      color="#9333EA"
                    />
                  </motion.div>
                )}
              </div>
            </div>

            {/* Per-Deal Fixed Costs */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <CurrencyDollarIcon className="w-5 h-5 text-rose-600" />
                Per-Deal Fixed Costs
              </h2>
              <div className="space-y-4">
                <Slider
                  value={perDealFixedCosts}
                  onChange={setPerDealFixedCosts}
                  min={0}
                  max={500}
                  step={25}
                  formatValue={(v) => `$${v}`}
                  label="Fixed Costs Per Deal"
                  icon={CurrencyDollarIcon}
                  color="#E11D48"
                />
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700 mb-1">Includes:</p>
                  <ul className="space-y-1">
                    <li>• UCC Filing: $50-150</li>
                    <li>• Bank Verification (Plaid): $5-50</li>
                    <li>• E-Signature: $1-3</li>
                    <li>• Credit Pull: $1-5</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Clawback / Default Risk */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <XCircleIcon className="w-5 h-5 text-red-600" />
                Clawback Risk
              </h2>
              <div className="space-y-4">
                <Slider
                  value={defaultRate}
                  onChange={setDefaultRate}
                  min={0}
                  max={30}
                  step={1}
                  formatValue={(v) => `${v}%`}
                  label="Early Default Rate"
                  icon={XCircleIcon}
                  color="#DC2626"
                />
                <Slider
                  value={clawbackPct}
                  onChange={setClawbackPct}
                  min={0}
                  max={100}
                  step={10}
                  formatValue={(v) => `${v}%`}
                  label="Clawback % on Default"
                  icon={ArrowPathIcon}
                  color="#DC2626"
                />
                <div className="text-xs text-gray-500 bg-red-50 rounded-lg p-3 border border-red-100">
                  <p className="font-medium text-red-700 mb-1">Expected Clawback Loss:</p>
                  <p className="text-red-600 text-lg font-bold">
                    {formatCurrency(calculations.clawbackRiskYouClose)} per deal
                  </p>
                  <p className="text-red-500 mt-1">
                    If {defaultRate}% of deals default and you lose {clawbackPct}% of commission
                  </p>
                </div>
              </div>
            </div>

            {/* Operations */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <ChartBarIcon className="w-5 h-5 text-amber-600" />
                Operations & Overhead
              </h2>
              <div className="space-y-4">
                <Slider
                  value={monthlyOverhead}
                  onChange={setMonthlyOverhead}
                  min={0}
                  max={25000}
                  step={500}
                  formatValue={(v) => `$${(v/1000).toFixed(1)}K`}
                  label="Monthly Overhead"
                  icon={CurrencyDollarIcon}
                  color="#F59E0B"
                />
                <Slider
                  value={dealsPerMonth}
                  onChange={setDealsPerMonth}
                  min={1}
                  max={50}
                  step={1}
                  formatValue={(v) => `${v} deals`}
                  label="Expected Deals / Month"
                  icon={ChartBarIcon}
                  color="#F59E0B"
                />
                <div className="text-xs text-gray-500 bg-amber-50 rounded-lg p-3 border border-amber-100">
                  <p className="font-medium text-amber-700 mb-1">Overhead includes:</p>
                  <ul className="space-y-1">
                    <li>• CRM/Software: $100-500/mo</li>
                    <li>• Dialer/Phone: $100-300/mo</li>
                    <li>• E&O Insurance: $100-300/mo</li>
                    <li>• Licensing fees (amortized)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* CLTV / Renewals */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4 flex items-center gap-2">
                <ArrowPathIcon className="w-5 h-5 text-indigo-600" />
                Renewals & CLTV
              </h2>
              <div className="space-y-4">
                <Slider
                  value={renewalRate}
                  onChange={setRenewalRate}
                  min={0}
                  max={80}
                  step={5}
                  formatValue={(v) => `${v}%`}
                  label="Renewal Rate"
                  icon={ArrowPathIcon}
                  color="#6366F1"
                />
                <Slider
                  value={avgRenewals}
                  onChange={setAvgRenewals}
                  min={1}
                  max={5}
                  step={0.5}
                  formatValue={(v) => `${v}x`}
                  label="Avg # of Renewals"
                  icon={ChartBarIcon}
                  color="#6366F1"
                />
                <Slider
                  value={renewalCommission}
                  onChange={setRenewalCommission}
                  min={2}
                  max={15}
                  step={0.5}
                  formatValue={(v) => `${v}%`}
                  label="Renewal Commission Rate"
                  icon={CurrencyDollarIcon}
                  color="#6366F1"
                />
              </div>
            </div>
          </div>

          {/* Right Column - Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricCard
                label="Cost Per Acquisition"
                value={formatCurrency(calculations.costPerAcquisition)}
                subValue={`${calculations.leadsNeededPerDeal.toFixed(1)} leads needed`}
                icon={PhoneIcon}
                color="#DC2626"
              />
              <MetricCard
                label="Gross Commission"
                value={formatCurrency(calculations.grossCommission)}
                subValue={`${commissionRate}% of deal`}
                icon={BanknotesIcon}
                color="#00D49D"
              />
              <MetricCard
                label="Clawback Risk"
                value={formatCurrency(calculations.clawbackRiskYouClose)}
                subValue={`${defaultRate}% default rate`}
                icon={XCircleIcon}
                color="#DC2626"
              />
              <MetricCard
                label="Net Profit/Deal"
                value={formatCurrency(calculations.finalProfitYouClose)}
                subValue="When you close"
                icon={ArrowTrendingUpIcon}
                color="#007EA7"
                highlight={calculations.finalProfitYouClose > 0}
              />
              <MetricCard
                label="Customer LTV"
                value={formatCurrency(calculations.cltvYouClose)}
                subValue={`${calculations.expectedRenewals.toFixed(1)} renewals expected`}
                icon={UserGroupIcon}
                color="#6366F1"
                highlight
              />
            </div>

            {/* Side by Side Comparison */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-6">
                Profit Comparison: Sales Rep vs. You Closing
              </h2>

              <div className="grid grid-cols-3 gap-4 pb-3 border-b border-gray-200 mb-2">
                <div className="font-semibold text-gray-500 text-sm">Metric</div>
                <div className="text-center font-semibold text-ocean-blue text-sm flex items-center justify-center gap-2">
                  <UserGroupIcon className="w-4 h-4" />
                  With Sales Rep
                </div>
                <div className="text-center font-semibold text-teal text-sm flex items-center justify-center gap-2">
                  <UserIcon className="w-4 h-4" />
                  You Close
                </div>
              </div>

              <div className="space-y-1 divide-y divide-gray-100">
                <ComparisonRow
                  label="Gross Commission"
                  withSales={calculations.grossCommission}
                  withoutSales={calculations.grossCommission}
                />
                <ComparisonRow
                  label="Sales Rep Commission"
                  withSales={calculations.salesCommission}
                  withoutSales={0}
                />
                <ComparisonRow
                  label="Syndication/Processing Fee"
                  withSales={calculations.processingCost}
                  withoutSales={calculations.processingCost}
                />
                <ComparisonRow
                  label="Per-Deal Fixed Costs"
                  withSales={perDealFixedCosts}
                  withoutSales={perDealFixedCosts}
                />
                <ComparisonRow
                  label="Lead Acquisition Cost"
                  withSales={calculations.costPerAcquisition}
                  withoutSales={calculations.costPerAcquisition}
                />
                <ComparisonRow
                  label="Clawback Risk (Expected)"
                  withSales={calculations.clawbackRiskWithSales}
                  withoutSales={calculations.clawbackRiskYouClose}
                />
                <ComparisonRow
                  label="Overhead Per Deal"
                  withSales={calculations.overheadPerDeal}
                  withoutSales={calculations.overheadPerDeal}
                />
                <div className="grid grid-cols-3 gap-4 py-2 border-t-2 border-gray-300">
                  <div className="font-semibold text-gray-700 text-sm">Total Costs</div>
                  <div className="text-center font-semibold text-red-500">
                    {formatCurrency(calculations.totalCostsWithSales)}
                  </div>
                  <div className="text-center font-semibold text-red-500">
                    {formatCurrency(calculations.totalCostsYouClose)}
                  </div>
                </div>
                <ComparisonRow
                  label="Net Profit Per Deal"
                  withSales={calculations.finalProfitWithSales}
                  withoutSales={calculations.finalProfitYouClose}
                  isHighlightRow
                />
                <ComparisonRow
                  label="ROI"
                  withSales={calculations.roiWithSales}
                  withoutSales={calculations.roiYouClose}
                  isCurrency={false}
                />
                <ComparisonRow
                  label="Monthly Profit"
                  withSales={calculations.monthlyRevenueWithSales}
                  withoutSales={calculations.monthlyRevenueYouClose}
                />
              </div>

              {/* Profit difference */}
              <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-mint-green/10 to-teal/10 border border-mint-green/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Additional profit when you close</p>
                    <p className="text-2xl font-bold text-mint-green">
                      +{formatCurrency(calculations.finalProfitYouClose - calculations.finalProfitWithSales)}
                      <span className="text-sm font-normal text-gray-500"> per deal</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Monthly difference</p>
                    <p className="text-2xl font-bold text-teal">
                      +{formatCurrency(calculations.monthlyRevenueYouClose - calculations.monthlyRevenueWithSales)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Warning if profit is negative */}
              {calculations.finalProfitYouClose < 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200"
                >
                  <div className="flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-red-700">Warning: Negative Unit Economics</p>
                      <p className="text-sm text-red-600 mt-1">
                        At current settings, you're losing {formatCurrency(Math.abs(calculations.finalProfitYouClose))} per deal.
                        Consider: lowering lead costs, improving conversion rate, increasing deal size, or reducing clawback exposure.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* CLTV Analysis */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-6 flex items-center gap-2">
                <ArrowTrendingUpIcon className="w-5 h-5 text-indigo-600" />
                Customer Lifetime Value (CLTV)
              </h2>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                    <p className="text-sm text-indigo-600 font-medium">Initial Deal Value</p>
                    <p className="text-2xl font-bold text-indigo-700">{formatCurrency(calculations.grossCommission)}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
                    <p className="text-sm text-purple-600 font-medium">Expected Renewal Revenue</p>
                    <p className="text-2xl font-bold text-purple-700">{formatCurrency(calculations.renewalRevenue)}</p>
                    <p className="text-xs text-purple-500 mt-1">
                      {calculations.expectedRenewals.toFixed(1)} renewals × {formatCurrency(avgDealSize * (renewalCommission / 100))} each
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-ocean-blue/10 border border-ocean-blue/20">
                    <div className="flex items-center gap-2 mb-2">
                      <UserGroupIcon className="w-5 h-5 text-ocean-blue" />
                      <p className="text-sm text-ocean-blue font-medium">CLTV (With Sales Rep)</p>
                    </div>
                    <p className="text-3xl font-bold text-ocean-blue">{formatCurrency(calculations.cltvWithSales)}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-teal/10 border border-teal/20">
                    <div className="flex items-center gap-2 mb-2">
                      <UserIcon className="w-5 h-5 text-teal" />
                      <p className="text-sm text-teal font-medium">CLTV (You Close)</p>
                    </div>
                    <p className="text-3xl font-bold text-teal">{formatCurrency(calculations.cltvYouClose)}</p>
                  </div>
                </div>
              </div>

              {/* CLTV to CAC ratio */}
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-sm text-gray-600">LTV:CAC Ratio (Sales Rep)</p>
                  <p className="text-2xl font-bold text-gray-800">
                    {(calculations.cltvWithSales / calculations.costPerAcquisition).toFixed(1)}x
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {calculations.cltvWithSales / calculations.costPerAcquisition >= 3 ? (
                      <span className="text-green-600 flex items-center gap-1">
                        <CheckCircleIcon className="w-3 h-3" /> Healthy (3x+)
                      </span>
                    ) : (
                      <span className="text-amber-600 flex items-center gap-1">
                        <XCircleIcon className="w-3 h-3" /> Below target (3x+)
                      </span>
                    )}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-sm text-gray-600">LTV:CAC Ratio (You Close)</p>
                  <p className="text-2xl font-bold text-gray-800">
                    {(calculations.cltvYouClose / calculations.costPerAcquisition).toFixed(1)}x
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {calculations.cltvYouClose / calculations.costPerAcquisition >= 3 ? (
                      <span className="text-green-600 flex items-center gap-1">
                        <CheckCircleIcon className="w-3 h-3" /> Healthy (3x+)
                      </span>
                    ) : (
                      <span className="text-amber-600 flex items-center gap-1">
                        <XCircleIcon className="w-3 h-3" /> Below target (3x+)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Break-even Analysis */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold text-midnight-blue mb-4">
                Break-Even Analysis
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-sm text-amber-700 font-medium">Break-even Leads (Sales Rep)</p>
                  <p className="text-3xl font-bold text-amber-600">{calculations.breakEvenLeadsWithSales}</p>
                  <p className="text-xs text-amber-600/70 mt-1">leads needed to break even</p>
                </div>
                <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                  <p className="text-sm text-green-700 font-medium">Break-even Leads (You Close)</p>
                  <p className="text-3xl font-bold text-green-600">{calculations.breakEvenLeadsYouClose}</p>
                  <p className="text-xs text-green-600/70 mt-1">leads needed to break even</p>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="text-sm text-blue-700 font-medium">Profit Per Lead</p>
                  <p className="text-3xl font-bold text-blue-600">{formatCurrency(calculations.profitPerLeadYouClose)}</p>
                  <p className="text-xs text-blue-600/70 mt-1">expected value per lead</p>
                </div>
              </div>
            </div>

            {/* Quick Scenarios */}
            <div className="bg-gradient-to-br from-midnight-blue to-ocean-blue rounded-2xl p-6 text-white">
              <h2 className="text-lg font-semibold mb-4">Quick Scenario Analysis</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                  <p className="text-white/70 text-sm">10 Deals / Month</p>
                  <p className="text-2xl font-bold">{formatCurrency(calculations.finalProfitYouClose * 10)}</p>
                  <p className="text-mint-green text-sm">monthly profit (you close)</p>
                </div>
                <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                  <p className="text-white/70 text-sm">20 Deals / Month</p>
                  <p className="text-2xl font-bold">{formatCurrency(calculations.finalProfitYouClose * 20)}</p>
                  <p className="text-mint-green text-sm">monthly profit (you close)</p>
                </div>
                <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                  <p className="text-white/70 text-sm">Annual (12 mo × {dealsPerMonth} deals)</p>
                  <p className="text-2xl font-bold">{formatCurrency(calculations.monthlyRevenueYouClose * 12)}</p>
                  <p className="text-mint-green text-sm">yearly profit potential</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
