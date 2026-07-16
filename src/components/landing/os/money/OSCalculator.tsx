// OSCalculator — the business-funding estimator, restyled to the Momentum OS
// dispatch board. Same math and inputs as the legacy LoanCalculator (amount /
// factor-rate-or-APR / term / frequency), just wearing the OS tokens and the one
// go-green signal instead of the old #4CAF50 card.
import { useState, useRef, useEffect } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { OSSection, Eyebrow, Display } from "../OSKit";
import { OSRange } from "./MoneyKit";
import { getAllProducts } from "../../../../data/products";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function calcMonthly(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round(principal / months);
  const r = annualRate / 100 / 12;
  return Math.round((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1));
}

export default function OSCalculator({ defaultProduct }: { defaultProduct?: string }) {
  const allProducts = getAllProducts();
  const initial = allProducts.find((p) => p.slug === defaultProduct) || allProducts[0];

  const [selectedSlug, setSelectedSlug] = useState(initial.slug);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const product = allProducts.find((p) => p.slug === selectedSlug) || allProducts[0];
  const cfg = product.calculatorConfig;

  const [amount, setAmount] = useState(Math.round((cfg.amountMin + cfg.amountMax) / 2 / cfg.amountStep) * cfg.amountStep);
  const [factorRate, setFactorRate] = useState(cfg.factorRateMin ? Math.round(((cfg.factorRateMin + cfg.factorRateMax!) / 2) * 100) / 100 : 1.3);
  const [apr, setApr] = useState(cfg.aprMin ? Math.round((cfg.aprMin + cfg.aprMax!) / 2) : 15);
  const [termValue, setTermValue] = useState(Math.round((cfg.termMin + cfg.termMax) / 2 / cfg.termStep) * cfg.termStep);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(cfg.defaultFrequency);

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

  const termInMonths = cfg.termUnit === "years" ? termValue * 12 : termValue;
  let payment = 0;
  let totalRepayment = 0;
  let paymentLabel = "";

  if (cfg.type === "factor-rate") {
    totalRepayment = Math.round(amount * factorRate);
    const daily = Math.round(totalRepayment / (termInMonths * 20));
    const weekly = Math.round(totalRepayment / (termInMonths * 4));
    payment = frequency === "daily" ? daily : weekly;
    paymentLabel = frequency === "daily" ? "/day" : "/wk";
  } else {
    const monthly = calcMonthly(amount, apr, termInMonths);
    totalRepayment = monthly * termInMonths;
    if (frequency === "weekly") { payment = Math.round(monthly / 4); paymentLabel = "/wk"; }
    else if (frequency === "daily") { payment = Math.round(monthly / 20); paymentLabel = "/day"; }
    else { payment = monthly; paymentLabel = "/mo"; }
  }

  const handleAmountInput = (val: string) => {
    const num = parseInt(val.replace(/,/g, ""));
    if (!isNaN(num) && num >= cfg.amountMin && num <= cfg.amountMax) setAmount(num);
  };
  const handleRateInput = (val: string) => {
    const num = parseFloat(val);
    if (cfg.type === "factor-rate") {
      if (!isNaN(num) && num >= cfg.factorRateMin! && num <= cfg.factorRateMax!) setFactorRate(Math.round(num * 100) / 100);
    } else if (!isNaN(num) && num >= cfg.aprMin! && num <= cfg.aprMax!) setApr(num);
  };
  const handleTermInput = (val: string) => {
    const num = parseInt(val);
    if (!isNaN(num) && num >= cfg.termMin && num <= cfg.termMax) setTermValue(num);
  };

  return (
    <OSSection tone="panel" id="calculator">
      <div className="money-secthead" style={{ margin: "0 auto 40px", textAlign: "center", maxWidth: "40em" }}>
        <Eyebrow>FUNDING CALCULATOR</Eyebrow>
        <Display>SEE WHAT YOU <span className="os-go">QUALIFY FOR.</span></Display>
      </div>

      <div className="money-calc-shell">
        <div className="money-calc-grid">
          {/* left rail — the product read-out */}
          <div className="money-calc-left">
            <div>
              <h3 className="money-calc-left-title">{product.shortName}</h3>
              <ul className="money-calc-hi">
                {product.highlights.map((h) => (
                  <li key={h}><span className="money-doc-check" aria-hidden>✓</span>{h}</li>
                ))}
              </ul>
            </div>
            <p className="money-calc-note">
              Estimates are illustrative only. Actual terms depend on your business profile. Checking your
              options is free and won&rsquo;t affect your credit.
            </p>
          </div>

          {/* right — inputs + result */}
          <div className="money-calc-right">
            <div className="money-calc-select" ref={dropdownRef}>
              <span className="money-calc-sellabel os-mono">FUNDING TYPE</span>
              <button className="money-calc-selbtn" onClick={() => setDropdownOpen(!dropdownOpen)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <product.icon className="money-calc-pico" style={{ color: "var(--go-text)" }} />
                  {product.shortName}
                </span>
                <ChevronDownIcon className="money-calc-selico" style={{ transform: dropdownOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
              </button>
              {dropdownOpen && (
                <div className="money-calc-menu">
                  {allProducts.map((p) => (
                    <button key={p.slug} className={p.slug === selectedSlug ? "on" : ""} onClick={() => handleProductChange(p.slug)}>
                      <p.icon style={{ color: "var(--go-text)" }} />
                      {p.shortName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* amount */}
            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">How much do you need?</label>
                <input className="money-calc-input" value={`$${fmt(amount)}`} onChange={(e) => handleAmountInput(e.target.value)} />
              </div>
              <OSRange value={amount} onChange={setAmount} min={cfg.amountMin} max={cfg.amountMax} step={cfg.amountStep}
                minLabel={`$${fmt(cfg.amountMin)}`} maxLabel={`$${fmt(cfg.amountMax)}`} />
            </div>

            {/* rate */}
            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">{cfg.type === "factor-rate" ? "Estimated factor rate" : "Estimated APR"}</label>
                <input className="money-calc-input" style={{ width: 80 }}
                  value={cfg.type === "factor-rate" ? factorRate.toFixed(2) : `${apr}%`}
                  onChange={(e) => handleRateInput(e.target.value.replace("%", ""))} />
              </div>
              <OSRange
                value={cfg.type === "factor-rate" ? factorRate : apr}
                onChange={(v) => cfg.type === "factor-rate" ? setFactorRate(Math.round(v * 100) / 100) : setApr(Math.round(v * 10) / 10)}
                min={cfg.type === "factor-rate" ? cfg.factorRateMin! : cfg.aprMin!}
                max={cfg.type === "factor-rate" ? cfg.factorRateMax! : cfg.aprMax!}
                step={cfg.type === "factor-rate" ? cfg.factorRateStep! : cfg.aprStep!}
                minLabel={cfg.type === "factor-rate" ? `${cfg.factorRateMin}` : `${cfg.aprMin}%`}
                maxLabel={cfg.type === "factor-rate" ? `${cfg.factorRateMax}` : `${cfg.aprMax}%`} />
            </div>

            {/* term */}
            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">Estimated term</label>
                <input className="money-calc-input" style={{ width: 96 }}
                  value={`${termValue} ${cfg.termUnit === "years" ? "yr" : "mo"}`}
                  onChange={(e) => handleTermInput(e.target.value)} />
              </div>
              <OSRange value={termValue} onChange={setTermValue} min={cfg.termMin} max={cfg.termMax} step={cfg.termStep}
                minLabel={`${cfg.termMin} ${cfg.termUnit === "years" ? "yr" : "mo"}`}
                maxLabel={`${cfg.termMax} ${cfg.termUnit === "years" ? "yr" : "mo"}`} />
            </div>

            {/* frequency */}
            {cfg.frequencies.length > 1 && (
              <div className="money-calc-row" style={{ marginBottom: 22 }}>
                <label className="money-calc-label">Payment frequency</label>
                <div className="money-calc-seg">
                  {cfg.frequencies.map((f) => (
                    <button key={f} className={frequency === f ? "on" : ""} onClick={() => setFrequency(f)}>{f}</button>
                  ))}
                </div>
              </div>
            )}

            {/* result */}
            <div className="money-calc-result">
              <div>
                <span className="money-calc-pay">${fmt(payment)}<small>{paymentLabel}</small></span>
                <p className="money-calc-total">Total repayment: ${fmt(totalRepayment)}</p>
              </div>
              <a href="/apply" className="os-cta-primary">Apply now <span aria-hidden>→</span></a>
            </div>
          </div>
        </div>
      </div>
    </OSSection>
  );
}
