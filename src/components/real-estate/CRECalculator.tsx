import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CurrencyDollarIcon,
  CheckBadgeIcon,
  ClockIcon,
  ArrowRightIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { getAllCREProducts } from "../../data/cre-products";

// ────────────────────────────────────────
// Utilities
// ────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number): string {
  return "$" + fmt(n);
}

function calcMonthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function calcInterestOnlyPayment(principal: number, annualRate: number): number {
  return (principal * (annualRate / 100)) / 12;
}

// ────────────────────────────────────────
// Range Slider
// ────────────────────────────────────────

interface RangeSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  color: string;
  label: string;
  displayValue: string;
  suffix?: string;
}

function RangeSlider({ min, max, step, value, onChange, color, label, displayValue, suffix }: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;

  const handlePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const raw = min + (x / rect.width) * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, snapped)));
    },
    [min, max, step, onChange]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer]
  );

  return (
    <div className="mb-7">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>
          {displayValue}
          {suffix && <span className="text-gray-400 font-normal ml-1">{suffix}</span>}
        </span>
      </div>
      <div
        ref={trackRef}
        className="relative h-2 rounded-full bg-gray-200 dark:bg-gray-600 cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => e.buttons === 1 && handlePointer(e)}
      >
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 shadow-md"
          style={{ left: `${pct}%`, marginLeft: "-10px", borderColor: color }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// CRE Calculator
// ────────────────────────────────────────

interface CRECalculatorProps {
  defaultProduct?: string;
}

export default function CRECalculator({ defaultProduct }: CRECalculatorProps) {
  const allProducts = getAllCREProducts();
  const initial = allProducts.find((p) => p.slug === defaultProduct) || allProducts[0];

  const [selectedSlug, setSelectedSlug] = useState(initial.slug);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const product = allProducts.find((p) => p.slug === selectedSlug) || allProducts[0];
  const cfg = product.creCalcConfig;

  const [propertyValue, setPropertyValue] = useState(
    Math.round((cfg.propertyValueMin + cfg.propertyValueMax) / 2 / cfg.propertyValueStep) * cfg.propertyValueStep
  );
  const [ltv, setLtv] = useState(Math.round((cfg.ltvMin + cfg.ltvMax) / 2));
  const [rate, setRate] = useState(cfg.rateMin + (cfg.rateMax - cfg.rateMin) * 0.3);
  const [term, setTerm] = useState(
    cfg.termUnit === "years"
      ? Math.round((cfg.termMin + cfg.termMax) / 2 / cfg.termStep) * cfg.termStep
      : Math.round((cfg.termMin + cfg.termMax) / 2)
  );
  const [constructionBudget, setConstructionBudget] = useState(
    cfg.hasConstructionBudget
      ? Math.round(((cfg.constructionBudgetMin || 50000) + (cfg.constructionBudgetMax || 5000000)) / 2 / (cfg.constructionBudgetStep || 25000)) * (cfg.constructionBudgetStep || 25000)
      : 0
  );

  const handleProductChange = (slug: string) => {
    setSelectedSlug(slug);
    setDropdownOpen(false);
    const p = allProducts.find((pr) => pr.slug === slug);
    if (!p) return;
    const c = p.creCalcConfig;
    setPropertyValue(
      Math.round((c.propertyValueMin + c.propertyValueMax) / 2 / c.propertyValueStep) * c.propertyValueStep
    );
    setLtv(Math.round((c.ltvMin + c.ltvMax) / 2));
    setRate(+(c.rateMin + (c.rateMax - c.rateMin) * 0.3).toFixed(2));
    setTerm(
      c.termUnit === "years"
        ? Math.round((c.termMin + c.termMax) / 2 / c.termStep) * c.termStep
        : Math.round((c.termMin + c.termMax) / 2)
    );
    if (c.hasConstructionBudget) {
      setConstructionBudget(
        Math.round(((c.constructionBudgetMin || 50000) + (c.constructionBudgetMax || 5000000)) / 2 / (c.constructionBudgetStep || 25000)) * (c.constructionBudgetStep || 25000)
      );
    } else {
      setConstructionBudget(0);
    }
  };

  // Calculate loan amount
  const totalProjectCost = cfg.hasConstructionBudget
    ? propertyValue + constructionBudget
    : propertyValue;
  const loanAmount = Math.round(totalProjectCost * (ltv / 100));
  const termMonths = cfg.termUnit === "years" ? term * 12 : term;

  // Calculate payment
  let monthlyPayment: number;
  let totalRepayment: number;
  let totalInterest: number;

  if (cfg.type === "interest-only") {
    monthlyPayment = calcInterestOnlyPayment(loanAmount, rate);
    totalRepayment = loanAmount + monthlyPayment * termMonths;
    totalInterest = monthlyPayment * termMonths;
  } else {
    monthlyPayment = calcMonthlyPayment(loanAmount, rate, termMonths);
    totalRepayment = monthlyPayment * termMonths;
    totalInterest = totalRepayment - loanAmount;
  }

  const termDisplay = cfg.termUnit === "years" ? `${term} yr` : `${term} mo`;

  return (
    <section className="section-padding bg-white dark:bg-gray-900 relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-medium mb-4">
            Loan Calculator
          </span>
          <h2 className="heading-2 text-gray-900 dark:text-white mb-4">
            Estimate Your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Real Estate Financing
            </span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            Adjust the sliders to see estimated loan amounts and payments for your real estate investment.
          </p>
        </motion.div>

        {/* Calculator Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="max-w-5xl mx-auto"
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-lg">
            <div className="grid grid-cols-1 lg:grid-cols-5">
              {/* Left Panel — highlights */}
              <div
                className="lg:col-span-2 p-8 text-white flex flex-col justify-between"
                style={{
                  background: `linear-gradient(135deg, ${product.color}dd 0%, ${product.color}88 100%)`,
                }}
              >
                <div>
                  <h3 className="text-2xl font-bold mb-6">{product.shortName}</h3>
                  <ul className="space-y-4">
                    {product.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-3">
                        <CheckBadgeIcon className="w-5 h-5 shrink-0 mt-0.5 text-white/90" />
                        <span className="text-white/90 text-sm">{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-8 pt-6 border-t border-white/20 flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="w-5 h-5 text-white/70" />
                    <span className="text-sm text-white/70">Close in {product.hero.approvalTime}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CurrencyDollarIcon className="w-5 h-5 text-white/70" />
                    <span className="text-sm text-white/70">{product.hero.amountRange}</span>
                  </div>
                </div>
              </div>

              {/* Right Panel — inputs + results */}
              <div className="lg:col-span-3 p-8">
                {/* Product Selector */}
                <div className="mb-8 relative" ref={dropdownRef}>
                  <label className="block text-sm font-semibold text-gray-800 dark:text-white mb-2">
                    Loan Type
                  </label>
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors relative z-10"
                  >
                    <span className="flex items-center gap-2">
                      <product.icon className="w-5 h-5" style={{ color: product.color }} />
                      {product.shortName}
                    </span>
                    <ChevronDownIcon
                      className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-2xl overflow-hidden">
                      {allProducts.map((p) => (
                        <button
                          key={p.slug}
                          onClick={() => handleProductChange(p.slug)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                            p.slug === selectedSlug
                              ? "bg-mint-green/10 text-mint-green font-semibold"
                              : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                          }`}
                        >
                          <p.icon className="w-5 h-5 flex-shrink-0" style={{ color: p.color }} />
                          {p.shortName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Property Value */}
                <RangeSlider
                  min={cfg.propertyValueMin}
                  max={cfg.propertyValueMax}
                  step={cfg.propertyValueStep}
                  value={propertyValue}
                  onChange={setPropertyValue}
                  color={product.color}
                  label={cfg.propertyValueLabel}
                  displayValue={fmtCurrency(propertyValue)}
                />

                {/* Construction Budget (only for construction loans) */}
                {cfg.hasConstructionBudget && (
                  <RangeSlider
                    min={cfg.constructionBudgetMin || 50000}
                    max={cfg.constructionBudgetMax || 10000000}
                    step={cfg.constructionBudgetStep || 25000}
                    value={constructionBudget}
                    onChange={setConstructionBudget}
                    color={product.color}
                    label="Construction Budget"
                    displayValue={fmtCurrency(constructionBudget)}
                  />
                )}

                {/* LTV / LTC */}
                <RangeSlider
                  min={cfg.ltvMin}
                  max={cfg.ltvMax}
                  step={cfg.ltvStep}
                  value={ltv}
                  onChange={setLtv}
                  color={product.color}
                  label={cfg.ltvLabel}
                  displayValue={`${ltv}%`}
                />

                {/* Interest Rate */}
                <RangeSlider
                  min={cfg.rateMin}
                  max={cfg.rateMax}
                  step={cfg.rateStep}
                  value={rate}
                  onChange={(v) => setRate(+v.toFixed(2))}
                  color={product.color}
                  label="Interest Rate"
                  displayValue={`${rate.toFixed(2)}%`}
                  suffix="APR"
                />

                {/* Term */}
                <RangeSlider
                  min={cfg.termMin}
                  max={cfg.termMax}
                  step={cfg.termStep}
                  value={term}
                  onChange={setTerm}
                  color={product.color}
                  label="Term"
                  displayValue={termDisplay}
                />

                {/* ── Results ── */}
                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Loan Amount</p>
                      <p className="text-xl font-bold" style={{ color: product.color }}>
                        {fmtCurrency(loanAmount)}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Monthly Payment{cfg.type === "interest-only" ? " (Interest Only)" : ""}
                      </p>
                      <p className="text-xl font-bold" style={{ color: product.color }}>
                        {fmtCurrency(Math.round(monthlyPayment))}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Interest</p>
                      <p className="text-lg font-bold text-gray-700 dark:text-gray-200">
                        {fmtCurrency(Math.round(totalInterest))}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Repayment</p>
                      <p className="text-lg font-bold text-gray-700 dark:text-gray-200">
                        {fmtCurrency(Math.round(totalRepayment))}
                      </p>
                    </div>
                  </div>

                  {cfg.hasConstructionBudget && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center mb-6">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Total Project Cost (Land + Construction)
                      </p>
                      <p className="text-lg font-bold text-gray-700 dark:text-gray-200">
                        {fmtCurrency(totalProjectCost)}
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center mb-5">
                    Estimates are for illustration only. Actual terms depend on property, credit, and experience.
                  </p>

                  <Link
                    to="/#apply"
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-white font-bold transition-opacity hover:opacity-90"
                    style={{ backgroundColor: product.color }}
                  >
                    Get Pre-Qualified — Free
                    <ArrowRightIcon className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
