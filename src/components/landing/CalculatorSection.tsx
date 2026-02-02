import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalculatorIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  BanknotesIcon,
  UserGroupIcon,
  ChartBarIcon,
  BuildingLibraryIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { ShineBorder } from '../ui/shine-border';
import { ParticlesBackground } from '../ui/particles-background';
import { ShimmerButton } from '../ui/shimmer-button';

// Tab definitions
const calculatorTabs = [
  { id: 'payroll', name: 'Payroll', icon: UserGroupIcon, shortName: 'Payroll' },
  { id: 'waiting', name: 'Cost of Waiting', icon: ClockIcon, shortName: 'Waiting' },
  { id: 'roi', name: 'ROI Calculator', icon: ArrowTrendingUpIcon, shortName: 'ROI' },
  { id: 'runway', name: 'Cash Runway', icon: ChartBarIcon, shortName: 'Runway' },
  { id: 'compare', name: 'Bank vs. Us', icon: BuildingLibraryIcon, shortName: 'Compare' },
];

// Reusable slider component
function Slider({
  value,
  onChange,
  min,
  max,
  step,
  formatValue,
  label,
  icon: Icon,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  label: string;
  icon: React.ElementType;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleInteraction = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newValue = Math.round((min + percent * (max - min)) / step) * step;
    onChange(Math.min(max, Math.max(min, newValue)));
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      handleInteraction(clientX);
    };

    const handleEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  return (
    <div className="p-4 rounded-xl bg-white/50 border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-ocean-blue" />
        <span className="text-sm font-medium text-heading">{label}</span>
      </div>

      <div className="text-2xl font-bold text-ocean-blue mb-3">
        {formatValue(value)}
      </div>

      <div
        ref={trackRef}
        className="relative h-2 rounded-full bg-gray-200 cursor-pointer"
        onMouseDown={(e) => {
          setIsDragging(true);
          handleInteraction(e.clientX);
        }}
        onTouchStart={(e) => {
          setIsDragging(true);
          handleInteraction(e.touches[0].clientX);
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ocean-blue to-mint-green"
          style={{ width: `${percentage}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-3 border-mint-green shadow-md cursor-grab"
          style={{ left: `calc(${percentage}% - 10px)` }}
        />
      </div>

      <div className="flex justify-between text-xs text-text-secondary mt-1">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}

// Format helpers
const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatFullCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// =====================
// CALCULATOR 1: PAYROLL
// =====================
function PayrollCalculator() {
  const [employees, setEmployees] = useState(8);
  const [hourlyWage, setHourlyWage] = useState(22);
  const [hoursPerWeek, setHoursPerWeek] = useState(40);

  const weeklyPayroll = employees * hourlyWage * hoursPerWeek;
  const biweeklyPayroll = weeklyPayroll * 2;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Slider
          value={employees}
          onChange={setEmployees}
          min={1}
          max={50}
          step={1}
          formatValue={(v) => `${v} employees`}
          label="Number of Employees"
          icon={UserGroupIcon}
        />
        <Slider
          value={hourlyWage}
          onChange={setHourlyWage}
          min={12}
          max={75}
          step={1}
          formatValue={(v) => `$${v}/hr`}
          label="Average Hourly Wage"
          icon={BanknotesIcon}
        />
        <Slider
          value={hoursPerWeek}
          onChange={setHoursPerWeek}
          min={20}
          max={50}
          step={5}
          formatValue={(v) => `${v} hrs/week`}
          label="Hours Per Week"
          icon={ClockIcon}
        />
      </div>

      <div className="flex flex-col justify-center">
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl p-8 text-center border border-red-200">
          <p className="text-sm font-semibold text-red-600 uppercase tracking-wider mb-2">
            You need to make payroll
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={weeklyPayroll}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-5xl lg:text-6xl font-bold text-red-600 mb-2"
            >
              {formatFullCurrency(weeklyPayroll)}
            </motion.div>
          </AnimatePresence>
          <p className="text-red-700/70 text-sm mb-4">every Friday</p>

          <div className="border-t border-red-200 pt-4 mt-4">
            <p className="text-red-700/80 text-sm">
              Bi-weekly: <span className="font-bold">{formatFullCurrency(biweeklyPayroll)}</span>
            </p>
          </div>

          <p className="text-red-800/60 text-sm mt-6 italic">
            Your crew has families counting on them. They're counting on you.
          </p>
        </div>

        <a href="#apply" className="mt-6">
          <ShimmerButton
            shimmerColor="#ffffff"
            shimmerSize="0.1em"
            background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
            className="w-full text-midnight-blue font-bold py-4"
            borderRadius="0.75rem"
          >
            Get Funded Before Friday →
          </ShimmerButton>
        </a>
      </div>
    </div>
  );
}

// ============================
// CALCULATOR 2: COST OF WAITING
// ============================
function WaitingCalculator() {
  const [opportunityValue, setOpportunityValue] = useState(250000);
  const [monthlyRevenue, setMonthlyRevenue] = useState(25000);
  const [weeksWaiting, setWeeksWaiting] = useState(6);

  const weeklyLoss = monthlyRevenue / 4;
  const totalLoss = weeklyLoss * weeksWaiting;
  const dailyLoss = totalLoss / (weeksWaiting * 7);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Slider
          value={opportunityValue}
          onChange={setOpportunityValue}
          min={25000}
          max={3000000}
          step={25000}
          formatValue={formatCurrency}
          label="Opportunity You're Missing"
          icon={BoltIcon}
        />
        <Slider
          value={monthlyRevenue}
          onChange={setMonthlyRevenue}
          min={5000}
          max={100000}
          step={1000}
          formatValue={formatCurrency}
          label="Monthly Revenue It Would Generate"
          icon={ArrowTrendingUpIcon}
        />
        <Slider
          value={weeksWaiting}
          onChange={setWeeksWaiting}
          min={1}
          max={12}
          step={1}
          formatValue={(v) => `${v} ${v === 1 ? 'week' : 'weeks'}`}
          label="How Long the Bank Makes You Wait"
          icon={ClockIcon}
        />
      </div>

      <div className="flex flex-col justify-center">
        <div className="bg-gradient-to-br from-orange-50 to-red-100 rounded-2xl p-8 text-center border border-orange-200 relative overflow-hidden">
          <motion.div
            className="absolute inset-0 opacity-10"
            animate={{ backgroundPosition: ['0% 0%', '100% 100%'] }}
            transition={{ duration: 10, repeat: Infinity, repeatType: 'reverse' }}
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, #f97316 0, #f97316 1px, transparent 0, transparent 50%)',
              backgroundSize: '10px 10px',
            }}
          />

          <div className="relative">
            <p className="text-sm font-semibold text-orange-600 uppercase tracking-wider mb-2">
              Revenue Lost While Waiting
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={totalLoss}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-5xl lg:text-6xl font-bold text-orange-600 mb-2"
              >
                {formatFullCurrency(totalLoss)}
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-center gap-2 mb-4">
              <motion.div
                className="w-2 h-2 rounded-full bg-orange-500"
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              <span className="text-orange-700 font-medium">
                {formatFullCurrency(dailyLoss)} lost every day
              </span>
            </div>

            <p className="text-orange-800/60 text-sm italic">
              That equipment deal. That big contract. Gone—because the bank moves at their pace, not yours.
            </p>
          </div>
        </div>

        <a href="#apply" className="mt-6">
          <ShimmerButton
            shimmerColor="#ffffff"
            shimmerSize="0.1em"
            background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
            className="w-full text-midnight-blue font-bold py-4"
            borderRadius="0.75rem"
          >
            Stop Waiting. Get Funded Now →
          </ShimmerButton>
        </a>
      </div>
    </div>
  );
}

// ==========================
// CALCULATOR 3: ROI / BREAK-EVEN
// ==========================
function ROICalculator() {
  const [fundingAmount, setFundingAmount] = useState(75000);
  const [expectedRevenue, setExpectedRevenue] = useState(15000);
  const [factorRate, setFactorRate] = useState(1.25);

  const totalRepayment = fundingAmount * factorRate;
  const monthlyCost = totalRepayment / 12;
  const monthlyProfit = expectedRevenue - monthlyCost;
  const breakEvenMonths = monthlyProfit > 0 ? Math.ceil(totalRepayment / expectedRevenue) : Infinity;
  const yearOneProfit = (expectedRevenue * 12) - totalRepayment;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Slider
          value={fundingAmount}
          onChange={setFundingAmount}
          min={25000}
          max={3000000}
          step={25000}
          formatValue={formatCurrency}
          label="Funding Amount"
          icon={BanknotesIcon}
        />
        <Slider
          value={expectedRevenue}
          onChange={setExpectedRevenue}
          min={5000}
          max={250000}
          step={5000}
          formatValue={formatCurrency}
          label="Expected Monthly Revenue Increase"
          icon={ArrowTrendingUpIcon}
        />
        <Slider
          value={factorRate}
          onChange={setFactorRate}
          min={1.1}
          max={1.5}
          step={0.05}
          formatValue={(v) => `${v.toFixed(2)}x`}
          label="Factor Rate"
          icon={CalculatorIcon}
        />
      </div>

      <div className="flex flex-col justify-center">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-100 rounded-2xl p-8 text-center border border-emerald-200">
          <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wider mb-2">
            Break-Even Point
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={breakEvenMonths}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-5xl lg:text-6xl font-bold text-emerald-600 mb-2"
            >
              {breakEvenMonths === Infinity ? '—' : `${breakEvenMonths} months`}
            </motion.div>
          </AnimatePresence>
          <p className="text-emerald-700/70 text-sm mb-4">then it's pure profit</p>

          <div className="grid grid-cols-2 gap-4 border-t border-emerald-200 pt-4 mt-4">
            <div>
              <p className="text-xs text-emerald-600/70">Total Cost</p>
              <p className="font-bold text-emerald-800">{formatFullCurrency(totalRepayment)}</p>
            </div>
            <div>
              <p className="text-xs text-emerald-600/70">Year 1 Profit</p>
              <p className={`font-bold ${yearOneProfit >= 0 ? 'text-emerald-800' : 'text-red-600'}`}>
                {yearOneProfit >= 0 ? '+' : ''}{formatFullCurrency(yearOneProfit)}
              </p>
            </div>
          </div>

          <p className="text-emerald-800/60 text-sm mt-6 italic">
            This isn't a cost—it's an investment in your growth.
          </p>
        </div>

        <a href="#apply" className="mt-6">
          <ShimmerButton
            shimmerColor="#ffffff"
            shimmerSize="0.1em"
            background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
            className="w-full text-midnight-blue font-bold py-4"
            borderRadius="0.75rem"
          >
            Invest in Your Business →
          </ShimmerButton>
        </a>
      </div>
    </div>
  );
}

// ==========================
// CALCULATOR 4: CASH RUNWAY
// ==========================
function RunwayCalculator() {
  const [currentCash, setCurrentCash] = useState(50000);
  const [monthlyExpenses, setMonthlyExpenses] = useState(85000);
  const [monthlyRevenue, setMonthlyRevenue] = useState(75000);
  const [fundingAmount, setFundingAmount] = useState(75000);

  const monthlyBurn = monthlyExpenses - monthlyRevenue;
  const currentRunwayDays = monthlyBurn > 0 ? Math.floor((currentCash / monthlyBurn) * 30) : 999;
  const fundedRunwayDays = monthlyBurn > 0 ? Math.floor(((currentCash + fundingAmount) / monthlyBurn) * 30) : 999;
  const additionalDays = fundedRunwayDays - currentRunwayDays;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Slider
          value={currentCash}
          onChange={setCurrentCash}
          min={0}
          max={500000}
          step={10000}
          formatValue={formatCurrency}
          label="Current Cash on Hand"
          icon={BanknotesIcon}
        />
        <Slider
          value={monthlyExpenses}
          onChange={setMonthlyExpenses}
          min={25000}
          max={1000000}
          step={25000}
          formatValue={formatCurrency}
          label="Monthly Expenses"
          icon={ChartBarIcon}
        />
        <Slider
          value={monthlyRevenue}
          onChange={setMonthlyRevenue}
          min={0}
          max={1000000}
          step={25000}
          formatValue={formatCurrency}
          label="Monthly Revenue"
          icon={ArrowTrendingUpIcon}
        />
        <Slider
          value={fundingAmount}
          onChange={setFundingAmount}
          min={25000}
          max={3000000}
          step={25000}
          formatValue={formatCurrency}
          label="Funding Amount"
          icon={BoltIcon}
        />
      </div>

      <div className="flex flex-col justify-center">
        <div className="bg-gradient-to-br from-slate-50 to-blue-100 rounded-2xl p-8 border border-slate-200">
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Current runway */}
            <div className="text-center">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">Now</p>
              <motion.div
                key={currentRunwayDays}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className={`text-4xl font-bold ${currentRunwayDays < 30 ? 'text-red-600' : currentRunwayDays < 60 ? 'text-orange-500' : 'text-slate-700'}`}
              >
                {currentRunwayDays > 365 ? '1yr+' : `${currentRunwayDays}d`}
              </motion.div>
              <p className="text-xs text-slate-500">runway</p>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center">
              <motion.div
                animate={{ x: [0, 10, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-3xl text-mint-green"
              >
                →
              </motion.div>
            </div>
          </div>

          {/* With funding */}
          <div className="bg-white/70 rounded-xl p-6 text-center">
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">
              With {formatCurrency(fundingAmount)} Funding
            </p>
            <motion.div
              key={fundedRunwayDays}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-5xl font-bold text-emerald-600 mb-1"
            >
              {fundedRunwayDays > 365 ? '1yr+' : `${fundedRunwayDays} days`}
            </motion.div>
            <p className="text-emerald-700 font-medium">
              +{additionalDays > 365 ? '1yr+' : `${additionalDays} days`} of breathing room
            </p>
          </div>

          <p className="text-slate-600 text-sm mt-6 text-center italic">
            {currentRunwayDays < 30
              ? "You're running on fumes. Let's fix that."
              : "More runway means more options. More peace of mind."}
          </p>
        </div>

        <a href="#apply" className="mt-6">
          <ShimmerButton
            shimmerColor="#ffffff"
            shimmerSize="0.1em"
            background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
            className="w-full text-midnight-blue font-bold py-4"
            borderRadius="0.75rem"
          >
            Extend Your Runway →
          </ShimmerButton>
        </a>
      </div>
    </div>
  );
}

// ============================
// CALCULATOR 5: BANK VS US
// ============================
function CompareCalculator() {
  const [fundingAmount, setFundingAmount] = useState(75000);
  const [opportunityValue, setOpportunityValue] = useState(35000);

  const bankWaitWeeks = 8;
  const bankApprovalRate = 25;
  const momentumWaitDays = 3;
  const momentumApprovalRate = 85;

  const bankOpportunityCost = opportunityValue * (bankWaitWeeks / 4);
  const momentumOpportunityCost = opportunityValue * (momentumWaitDays / 30);
  const savings = bankOpportunityCost - momentumOpportunityCost;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Slider
          value={fundingAmount}
          onChange={setFundingAmount}
          min={25000}
          max={3000000}
          step={25000}
          formatValue={formatCurrency}
          label="Funding Amount Needed"
          icon={BanknotesIcon}
        />
        <Slider
          value={opportunityValue}
          onChange={setOpportunityValue}
          min={10000}
          max={500000}
          step={10000}
          formatValue={formatCurrency}
          label="Monthly Revenue You're Missing"
          icon={ArrowTrendingUpIcon}
        />

        {/* Comparison cards */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          {/* Bank */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BuildingLibraryIcon className="w-5 h-5 text-red-500" />
              <span className="font-semibold text-red-800">The Bank</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-red-600/70">Wait time</span>
                <span className="font-bold text-red-700">{bankWaitWeeks}+ weeks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-600/70">Approval rate</span>
                <span className="font-bold text-red-700">{bankApprovalRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-600/70">Paperwork</span>
                <span className="font-bold text-red-700">25+ hours</span>
              </div>
            </div>
          </div>

          {/* Momentum */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BoltIcon className="w-5 h-5 text-emerald-500" />
              <span className="font-semibold text-emerald-800">Momentum</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-emerald-600/70">Wait time</span>
                <span className="font-bold text-emerald-700">{momentumWaitDays} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-600/70">Approval rate</span>
                <span className="font-bold text-emerald-700">{momentumApprovalRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-600/70">Paperwork</span>
                <span className="font-bold text-emerald-700">5 mins</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-100 rounded-2xl p-8 text-center border border-emerald-200">
          <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wider mb-2">
            By Choosing Momentum, You Save
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={savings}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-5xl lg:text-6xl font-bold text-emerald-600 mb-2"
            >
              {formatFullCurrency(savings)}
            </motion.div>
          </AnimatePresence>
          <p className="text-emerald-700/70 text-sm mb-4">in opportunity cost alone</p>

          <div className="bg-white/60 rounded-lg p-4 mt-4">
            <p className="text-emerald-800 text-sm">
              <span className="font-bold">Plus:</span> No rejection letter. No waiting by the phone.
              No explaining to your crew why the bank said no.
            </p>
          </div>

          <p className="text-emerald-800/60 text-sm mt-6 italic">
            Yes, our rate is different. But you're funded THIS WEEK.
          </p>
        </div>

        <a href="#apply" className="mt-6">
          <ShimmerButton
            shimmerColor="#ffffff"
            shimmerSize="0.1em"
            background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
            className="w-full text-midnight-blue font-bold py-4"
            borderRadius="0.75rem"
          >
            Skip the Bank. Get Funded Now →
          </ShimmerButton>
        </a>
      </div>
    </div>
  );
}

// ====================
// MAIN COMPONENT
// ====================
export default function CalculatorSection() {
  const [activeTab, setActiveTab] = useState('payroll');

  const renderCalculator = () => {
    switch (activeTab) {
      case 'payroll':
        return <PayrollCalculator />;
      case 'waiting':
        return <WaitingCalculator />;
      case 'roi':
        return <ROICalculator />;
      case 'runway':
        return <RunwayCalculator />;
      case 'compare':
        return <CompareCalculator />;
      default:
        return <PayrollCalculator />;
    }
  };

  return (
    <section id="calculator" className="section-padding bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 opacity-30">
        <ParticlesBackground particleCount={40} particleColor="#007EA7" speed={0.2} />
      </div>

      <div className="container-max relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto"
        >
          {/* Header */}
          <div className="text-center mb-10">
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-ocean-blue to-teal flex items-center justify-center mx-auto mb-4 shadow-lg"
            >
              <CalculatorIcon className="w-8 h-8 text-white" />
            </motion.div>
            <h2 className="heading-2 text-heading mb-3">
              See the <span className="text-brand-gradient">Real Numbers</span>
            </h2>
            <p className="text-text-secondary text-lg max-w-xl mx-auto">
              Stop guessing. These calculators show you exactly what's at stake.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {calculatorTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-ocean-blue to-teal text-white shadow-lg'
                      : 'bg-white text-text-secondary hover:bg-gray-100 border border-gray-200'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.name}</span>
                  <span className="sm:hidden">{tab.shortName}</span>
                </motion.button>
              );
            })}
          </div>

          {/* Calculator Card */}
          <ShineBorder
            borderRadius={24}
            borderWidth={2}
            duration={8}
            color={['#00D49D', '#007EA7', '#00A896']}
          >
            <div className="p-6 lg:p-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {renderCalculator()}
                </motion.div>
              </AnimatePresence>
            </div>
          </ShineBorder>
        </motion.div>
      </div>
    </section>
  );
}
