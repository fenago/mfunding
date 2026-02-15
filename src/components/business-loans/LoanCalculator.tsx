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
import { getAllProducts } from "../../data/products";

// ────────────────────────────────────────
// Utilities
// ────────────────────────────────────────

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US");
}

function calcMonthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round(principal / months);
  const r = annualRate / 100 / 12;
  return Math.round((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1));
}

// ────────────────────────────────────────
// Range Slider (reused pattern)
// ────────────────────────────────────────

function RangeSlider({
  value,
  onChange,
  min,
  max,
  step,
  minLabel,
  maxLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const percentage = ((value - min) / (max - min)) * 100;

  const updateValue = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + pct * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, stepped)));
    },
    [min, max, step, onChange]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    updateValue(e.clientX);
    const onMove = (ev: MouseEvent) => {
      if (isDragging.current) updateValue(ev.clientX);
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    updateValue(e.touches[0].clientX);
    const onMove = (ev: TouchEvent) => {
      if (isDragging.current) updateValue(ev.touches[0].clientX);
    };
    const onEnd = () => {
      isDragging.current = false;
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
  };

  return (
    <div>
      <div
        ref={trackRef}
        className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div
          className="absolute h-full bg-[#4CAF50] rounded-full"
          style={{ width: `${percentage}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-[3px] border-[#4CAF50] rounded-full shadow-md"
          style={{ left: `${percentage}%`, marginLeft: "-10px" }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Calculator Component
// ────────────────────────────────────────

interface LoanCalculatorProps {
  defaultProduct?: string; // slug of product to pre-select
}

export default function LoanCalculator({ defaultProduct }: LoanCalculatorProps) {
  const allProducts = getAllProducts();
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
  const cfg = product.calculatorConfig;

  // State for inputs
  const [amount, setAmount] = useState(Math.round((cfg.amountMin + cfg.amountMax) / 2 / cfg.amountStep) * cfg.amountStep);
  const [factorRate, setFactorRate] = useState(cfg.factorRateMin ? Math.round(((cfg.factorRateMin + cfg.factorRateMax!) / 2) * 100) / 100 : 1.3);
  const [apr, setApr] = useState(cfg.aprMin ? Math.round((cfg.aprMin + cfg.aprMax!) / 2) : 15);
  const [termValue, setTermValue] = useState(Math.round((cfg.termMin + cfg.termMax) / 2 / cfg.termStep) * cfg.termStep);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(cfg.defaultFrequency);

  // Reset inputs when product changes
  const handleProductChange = (slug: string) => {
    setSelectedSlug(slug);
    setDropdownOpen(false);
    const p = allProducts.find((pr) => pr.slug === slug);
    if (!p) return;
    const c = p.calculatorConfig;
    setAmount(Math.round((c.amountMin + c.amountMax) / 2 / c.amountStep) * c.amountStep);
    if (c.factorRateMin) setFactorRate(Math.round(((c.factorRateMin + c.factorRateMax!) / 2) * 100) / 100);
    if (c.aprMin) setApr(Math.round((c.aprMin + c.aprMax!) / 2));
    setTermValue(Math.round((c.termMin + c.termMax) / 2 / c.termStep) * c.termStep);
    setFrequency(c.defaultFrequency);
  };

  // Calculate payment
  const termInMonths = cfg.termUnit === "years" ? termValue * 12 : termValue;
  let payment = 0;
  let totalRepayment = 0;
  let paymentLabel = "";

  if (cfg.type === "factor-rate") {
    totalRepayment = Math.round(amount * factorRate);
    const totalBusinessDays = termInMonths * 20;
    const totalWeeks = termInMonths * 4;
    const daily = Math.round(totalRepayment / totalBusinessDays);
    const weekly = Math.round(totalRepayment / totalWeeks);
    payment = frequency === "daily" ? daily : weekly;
    paymentLabel = frequency === "daily" ? "/day" : "/wk";
  } else {
    const monthly = calcMonthlyPayment(amount, apr, termInMonths);
    totalRepayment = monthly * termInMonths;
    if (frequency === "weekly") {
      payment = Math.round(monthly / 4);
      paymentLabel = "/wk";
    } else if (frequency === "daily") {
      payment = Math.round(monthly / 20);
      paymentLabel = "/day";
    } else {
      payment = monthly;
      paymentLabel = "/mo";
    }
  }

  const handleAmountInput = (val: string) => {
    const num = parseInt(val.replace(/,/g, ""));
    if (!isNaN(num) && num >= cfg.amountMin && num <= cfg.amountMax) setAmount(num);
  };

  const handleRateInput = (val: string) => {
    if (cfg.type === "factor-rate") {
      const num = parseFloat(val);
      if (!isNaN(num) && num >= cfg.factorRateMin! && num <= cfg.factorRateMax!) {
        setFactorRate(Math.round(num * 100) / 100);
      }
    } else {
      const num = parseFloat(val);
      if (!isNaN(num) && num >= cfg.aprMin! && num <= cfg.aprMax!) setApr(num);
    }
  };

  const handleTermInput = (val: string) => {
    const num = parseInt(val);
    if (!isNaN(num) && num >= cfg.termMin && num <= cfg.termMax) setTermValue(num);
  };

  return (
    <section id="calculator" className="section-padding bg-white dark:bg-gray-900 relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-2 bg-[#4CAF50]/10 rounded-full text-[#4CAF50] text-sm font-medium mb-4">
            Funding Calculator
          </span>
          <h2 className="heading-2 text-gray-900 dark:text-white mb-4">
            See What You{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4CAF50] to-teal">
              Qualify For
            </span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto">
            Get an instant estimate. No credit check. No commitment.
          </p>
        </motion.div>

        {/* Calculator */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-5xl mx-auto"
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="grid lg:grid-cols-5">
              {/* Left Panel */}
              <div className="lg:col-span-2 bg-[#4CAF50] p-8 lg:p-10 flex flex-col justify-between text-white">
                <div>
                  <h3 className="text-2xl lg:text-3xl font-bold leading-tight mb-8">
                    {product.shortName} Calculator
                  </h3>
                  <div className="space-y-4">
                    {product.highlights.map((h, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                          {i === 0 ? (
                            <CheckBadgeIcon className="w-5 h-5" />
                          ) : i === 1 ? (
                            <CurrencyDollarIcon className="w-5 h-5" />
                          ) : (
                            <ClockIcon className="w-5 h-5" />
                          )}
                        </div>
                        <p className="text-sm font-medium leading-snug pt-1.5">{h}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-white/20">
                  <p className="text-xs text-white/60">
                    Estimates are for illustrative purposes only. Actual terms may vary based on your business profile.
                  </p>
                </div>
              </div>

              {/* Right Panel */}
              <div className="lg:col-span-3 p-8 lg:p-10">
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
                              ? "bg-[#4CAF50]/10 text-[#4CAF50] font-semibold"
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

                {/* Amount */}
                <div className="mb-7">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      How much do you need?
                    </label>
                    <div className="flex items-center bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      <span className="px-2 py-1.5 bg-[#4CAF50] text-white text-sm font-bold">$</span>
                      <input
                        type="text"
                        value={formatCurrency(amount)}
                        onChange={(e) => handleAmountInput(e.target.value)}
                        className="w-28 px-2 py-1.5 text-sm font-semibold text-[#4CAF50] bg-transparent outline-none text-right"
                      />
                    </div>
                  </div>
                  <RangeSlider
                    value={amount}
                    onChange={setAmount}
                    min={cfg.amountMin}
                    max={cfg.amountMax}
                    step={cfg.amountStep}
                    minLabel={`$${formatCurrency(cfg.amountMin)}`}
                    maxLabel={`$${formatCurrency(cfg.amountMax)}`}
                  />
                </div>

                {/* Rate (Factor Rate or APR) */}
                <div className="mb-7">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      {cfg.type === "factor-rate" ? "Estimated Factor Rate" : "Estimated APR"}
                    </label>
                    <input
                      type="text"
                      value={cfg.type === "factor-rate" ? factorRate.toFixed(2) : `${apr}%`}
                      onChange={(e) => handleRateInput(e.target.value.replace("%", ""))}
                      className="w-20 px-3 py-1.5 text-sm font-semibold text-[#4CAF50] bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-center outline-none"
                    />
                  </div>
                  <RangeSlider
                    value={cfg.type === "factor-rate" ? factorRate : apr}
                    onChange={(v) =>
                      cfg.type === "factor-rate"
                        ? setFactorRate(Math.round(v * 100) / 100)
                        : setApr(Math.round(v * 10) / 10)
                    }
                    min={cfg.type === "factor-rate" ? cfg.factorRateMin! : cfg.aprMin!}
                    max={cfg.type === "factor-rate" ? cfg.factorRateMax! : cfg.aprMax!}
                    step={cfg.type === "factor-rate" ? cfg.factorRateStep! : cfg.aprStep!}
                    minLabel={cfg.type === "factor-rate" ? `${cfg.factorRateMin}` : `${cfg.aprMin}%`}
                    maxLabel={cfg.type === "factor-rate" ? `${cfg.factorRateMax}` : `${cfg.aprMax}%`}
                  />
                </div>

                {/* Term */}
                <div className="mb-7">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      Estimated Term
                    </label>
                    <div className="flex items-center bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      <input
                        type="text"
                        value={termValue}
                        onChange={(e) => handleTermInput(e.target.value)}
                        className="w-12 px-2 py-1.5 text-sm font-semibold text-[#4CAF50] bg-transparent outline-none text-center"
                      />
                      <span className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {cfg.termUnit === "years" ? "yr" : "mo"}
                      </span>
                    </div>
                  </div>
                  <RangeSlider
                    value={termValue}
                    onChange={setTermValue}
                    min={cfg.termMin}
                    max={cfg.termMax}
                    step={cfg.termStep}
                    minLabel={`${cfg.termMin} ${cfg.termUnit === "years" ? "Year" : "Mo"}`}
                    maxLabel={`${cfg.termMax} ${cfg.termUnit === "years" ? "Years" : "Mo"}`}
                  />
                </div>

                {/* Payment Frequency (if multiple options) */}
                {cfg.frequencies.length > 1 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between">
                      <label className="text-base font-semibold text-gray-800 dark:text-white">
                        Payment Frequency
                      </label>
                      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                        {cfg.frequencies.map((f) => (
                          <button
                            key={f}
                            onClick={() => setFrequency(f)}
                            className={`px-5 py-2 text-sm font-semibold transition-colors capitalize ${
                              frequency === f
                                ? "bg-[#4CAF50] text-white"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Result */}
                <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-gray-700">
                  <div>
                    <p className="text-3xl font-bold text-[#4CAF50]">
                      ${formatCurrency(payment)}
                      <span className="text-lg font-medium text-gray-400">{paymentLabel}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Total repayment: ${formatCurrency(totalRepayment)}
                    </p>
                  </div>
                  <Link
                    to="/#apply"
                    className="inline-flex items-center gap-2 text-base font-semibold text-gray-700 dark:text-gray-300 hover:text-[#4CAF50] transition-colors"
                  >
                    Apply Now
                    <span className="w-9 h-9 bg-[#4CAF50] text-white rounded-lg flex items-center justify-center">
                      <ArrowRightIcon className="w-4 h-4" />
                    </span>
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
