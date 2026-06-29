import { useMemo, useState } from "react";
import { CalculatorIcon, InformationCircleIcon, ScaleIcon, BuildingLibraryIcon } from "@heroicons/react/24/outline";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const k = (n: number) => `$${Math.round(n / 1000)}K`;

function Slider({
  label,
  value,
  setValue,
  min,
  max,
  step,
  format,
  hint,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-semibold text-gray-900 dark:text-white">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full mt-1 accent-ocean-blue"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800" : "bg-gray-50 dark:bg-gray-900"}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function UnitEconomicsVCFPage() {
  // ── Debt restructuring (main program) ──
  const [enrolledDebt, setEnrolledDebt] = useState(150000);
  const [commissionPct, setCommissionPct] = useState(7);
  const [sharePct, setSharePct] = useState(100);
  const [completionPct, setCompletionPct] = useState(80);
  const [filesPerMonth, setFilesPerMonth] = useState(5);

  // ── FDIC bank term loan ──
  const [loanAmount, setLoanAmount] = useState(250000);
  const [totalCompPct, setTotalCompPct] = useState(4);
  const [splitPct, setSplitPct] = useState(50);
  const [loansPerMonth, setLoansPerMonth] = useState(2);

  const restructure = useMemo(() => {
    const grossPerFile = enrolledDebt * (commissionPct / 100) * (sharePct / 100);
    const netPerFile = grossPerFile * (completionPct / 100);
    const monthly = netPerFile * filesPerMonth;
    return { grossPerFile, netPerFile, monthly, annual: monthly * 12 };
  }, [enrolledDebt, commissionPct, sharePct, completionPct, filesPerMonth]);

  const bankLoan = useMemo(() => {
    const netPerLoan = loanAmount * (totalCompPct / 100) * (splitPct / 100);
    const monthly = netPerLoan * loansPerMonth;
    return { netPerLoan, monthly, annual: monthly * 12 };
  }, [loanAmount, totalCompPct, splitPct, loansPerMonth]);

  const combinedMonthly = restructure.monthly + bankLoan.monthly;
  const combinedAnnual = restructure.annual + bankLoan.annual;
  const mcaEquivalent = 4000; // avg MCA commission per funded deal, for comparison

  const card = "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <CalculatorIcon className="w-6 h-6 text-ocean-blue" /> Unit Economics — VCF (Debt Relief)
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          White-label Value Capital Funding economics. Two lanes: attorney-led debt restructuring (the main program) and the FDIC bank term loan.
        </p>
      </div>

      {/* Assumptions banner */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <InformationCircleIcon className="w-5 h-5 shrink-0" />
        <div>
          Defaults reflect VCF's published figures: <strong>up to 7%</strong> of restructured debt, <strong>~$14,960 avg comp/file</strong>, <strong>$50K min</strong> debt, paid recurring over 12–24 months. Two numbers VCF doesn't publish are set as assumptions you can tune: your <strong>share of the 7%</strong> (set to 100% — confirm in the Partner Agreement) and a <strong>completion rate</strong> haircut for merchants who drop mid-program.
        </div>
      </div>

      {/* Combined summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Combined monthly revenue" value={money(combinedMonthly)} sub="Restructuring + bank loan" highlight />
        <Stat label="Annualized" value={money(combinedAnnual)} />
        <Stat
          label="Avg restructuring file vs. MCA deal"
          value={`${(restructure.netPerFile / mcaEquivalent).toFixed(1)}×`}
          sub={`${money(restructure.netPerFile)} vs ${money(mcaEquivalent)} MCA`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Restructuring lane */}
        <div className={card}>
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ScaleIcon className="w-5 h-5 text-purple-500" /> Debt Restructuring <span className="text-xs font-normal text-gray-400">(main program)</span>
          </h2>
          <div className="mt-4 space-y-4">
            <Slider label="Avg debt restructured / file" value={enrolledDebt} setValue={setEnrolledDebt} min={50000} max={500000} step={5000} format={k} hint="$50K minimum to qualify" />
            <Slider label="Commission rate" value={commissionPct} setValue={setCommissionPct} min={1} max={7} step={0.5} format={(n) => `${n}%`} hint="Up to 7% of restructured debt" />
            <Slider label="Your share of commission" value={sharePct} setValue={setSharePct} min={50} max={100} step={5} format={(n) => `${n}%`} hint="Assumption — confirm split in the Partner Agreement" />
            <Slider label="Program completion rate" value={completionPct} setValue={setCompletionPct} min={50} max={100} step={5} format={(n) => `${n}%`} hint="Recurring payout over 12–24 mo; haircut for drop-offs" />
            <Slider label="Files closed / month" value={filesPerMonth} setValue={setFilesPerMonth} min={1} max={40} step={1} format={(n) => `${n}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Stat label="Gross comm / file" value={money(restructure.grossPerFile)} />
            <Stat label="Net / file (after completion)" value={money(restructure.netPerFile)} highlight />
            <Stat label="Monthly revenue" value={money(restructure.monthly)} />
            <Stat label="Annual revenue" value={money(restructure.annual)} />
          </div>
        </div>

        {/* Bank loan lane */}
        <div className={card}>
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BuildingLibraryIcon className="w-5 h-5 text-blue-500" /> FDIC Bank Term Loan
          </h2>
          <div className="mt-4 space-y-4">
            <Slider label="Avg funded amount" value={loanAmount} setValue={setLoanAmount} min={50000} max={500000} step={10000} format={k} hint="Up to $500K (more case-by-case)" />
            <Slider label="Total compensation" value={totalCompPct} setValue={setTotalCompPct} min={1} max={4} step={0.5} format={(n) => `${n}%`} hint="Up to 4% of funded amount" />
            <Slider label="Your split" value={splitPct} setValue={setSplitPct} min={25} max={100} step={5} format={(n) => `${n}%`} hint="50/50 per the Partner Agreement → ~2% net" />
            <Slider label="Loans / month" value={loansPerMonth} setValue={setLoansPerMonth} min={0} max={20} step={1} format={(n) => `${n}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Stat label="Net / loan (one-time)" value={money(bankLoan.netPerLoan)} highlight />
            <Stat label="Monthly revenue" value={money(bankLoan.monthly)} />
            <Stat label="Annual revenue" value={money(bankLoan.annual)} />
            <Stat label="Payout" value="One-time" sub="At closing (vs. recurring restructuring)" />
          </div>
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Eligibility: 640+ FICO, 2 yrs in business, $250K+ revenue with positive net income. No Transportation/Logistics or Cannabis. 10-yr term, refinances MCAs.
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Restructuring qualifies merchants with $50K+ MCA debt, no FICO minimum, ~90% approval, cutting daily payments 50–75%. Commission is on the amount of debt restructured (not a single loan) and pays weekly/monthly across the program.
      </p>
    </div>
  );
}
