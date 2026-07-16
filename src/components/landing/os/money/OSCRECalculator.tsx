// OSCRECalculator — the real-estate financing estimator on the Momentum OS board.
// Same math and inputs as the legacy CRECalculator (property value / optional
// construction budget / LTV-or-LTC / rate / term, interest-only or amortized),
// restyled to the OS tokens and the single go-green signal.
import { useState, useRef, useEffect } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { OSSection, Eyebrow, Display } from "../OSKit";
import { OSRange } from "./MoneyKit";
import { getAllCREProducts } from "../../../../data/cre-products";

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function calcMonthly(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}
function calcInterestOnly(principal: number, annualRate: number): number {
  return (principal * (annualRate / 100)) / 12;
}

export default function OSCRECalculator({ defaultProduct }: { defaultProduct?: string }) {
  const allProducts = getAllCREProducts();
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
  const cfg = product.creCalcConfig;

  const [propertyValue, setPropertyValue] = useState(
    Math.round((cfg.propertyValueMin + cfg.propertyValueMax) / 2 / cfg.propertyValueStep) * cfg.propertyValueStep
  );
  const [ltv, setLtv] = useState(Math.round((cfg.ltvMin + cfg.ltvMax) / 2));
  const [rate, setRate] = useState(+(cfg.rateMin + (cfg.rateMax - cfg.rateMin) * 0.3).toFixed(2));
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
    setPropertyValue(Math.round((c.propertyValueMin + c.propertyValueMax) / 2 / c.propertyValueStep) * c.propertyValueStep);
    setLtv(Math.round((c.ltvMin + c.ltvMax) / 2));
    setRate(+(c.rateMin + (c.rateMax - c.rateMin) * 0.3).toFixed(2));
    setTerm(c.termUnit === "years" ? Math.round((c.termMin + c.termMax) / 2 / c.termStep) * c.termStep : Math.round((c.termMin + c.termMax) / 2));
    setConstructionBudget(
      c.hasConstructionBudget
        ? Math.round(((c.constructionBudgetMin || 50000) + (c.constructionBudgetMax || 5000000)) / 2 / (c.constructionBudgetStep || 25000)) * (c.constructionBudgetStep || 25000)
        : 0
    );
  };

  const totalProjectCost = cfg.hasConstructionBudget ? propertyValue + constructionBudget : propertyValue;
  const loanAmount = Math.round(totalProjectCost * (ltv / 100));
  const termMonths = cfg.termUnit === "years" ? term * 12 : term;

  let monthlyPayment: number;
  let totalRepayment: number;
  let totalInterest: number;
  if (cfg.type === "interest-only") {
    monthlyPayment = calcInterestOnly(loanAmount, rate);
    totalInterest = monthlyPayment * termMonths;
    totalRepayment = loanAmount + totalInterest;
  } else {
    monthlyPayment = calcMonthly(loanAmount, rate, termMonths);
    totalRepayment = monthlyPayment * termMonths;
    totalInterest = totalRepayment - loanAmount;
  }

  const termDisplay = cfg.termUnit === "years" ? `${term} yr` : `${term} mo`;

  return (
    <OSSection tone="panel" id="calculator">
      <div className="money-secthead" style={{ margin: "0 auto 40px", textAlign: "center", maxWidth: "40em" }}>
        <Eyebrow>LOAN CALCULATOR</Eyebrow>
        <Display>ESTIMATE YOUR <span className="os-go">FINANCING.</span></Display>
      </div>

      <div className="money-calc-shell">
        <div className="money-calc-grid">
          {/* left rail */}
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
              Close in {product.hero.approvalTime} · {product.hero.amountRange}. Estimates are illustrative only —
              actual terms depend on the property, your credit, and your experience.
            </p>
          </div>

          {/* right */}
          <div className="money-calc-right">
            <div className="money-calc-select" ref={dropdownRef}>
              <span className="money-calc-sellabel os-mono">LOAN TYPE</span>
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

            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">{cfg.propertyValueLabel}</label>
                <span className="money-calc-input" style={{ background: "transparent", border: "none" }}>{fmtCurrency(propertyValue)}</span>
              </div>
              <OSRange value={propertyValue} onChange={setPropertyValue} min={cfg.propertyValueMin} max={cfg.propertyValueMax} step={cfg.propertyValueStep}
                minLabel={fmtCurrency(cfg.propertyValueMin)} maxLabel={fmtCurrency(cfg.propertyValueMax)} />
            </div>

            {cfg.hasConstructionBudget && (
              <div className="money-calc-field">
                <div className="money-calc-row">
                  <label className="money-calc-label">Construction budget</label>
                  <span className="money-calc-input" style={{ background: "transparent", border: "none" }}>{fmtCurrency(constructionBudget)}</span>
                </div>
                <OSRange value={constructionBudget} onChange={setConstructionBudget}
                  min={cfg.constructionBudgetMin || 50000} max={cfg.constructionBudgetMax || 10000000} step={cfg.constructionBudgetStep || 25000}
                  minLabel={fmtCurrency(cfg.constructionBudgetMin || 50000)} maxLabel={fmtCurrency(cfg.constructionBudgetMax || 10000000)} />
              </div>
            )}

            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">{cfg.ltvLabel}</label>
                <span className="money-calc-input" style={{ background: "transparent", border: "none" }}>{ltv}%</span>
              </div>
              <OSRange value={ltv} onChange={setLtv} min={cfg.ltvMin} max={cfg.ltvMax} step={cfg.ltvStep}
                minLabel={`${cfg.ltvMin}%`} maxLabel={`${cfg.ltvMax}%`} />
            </div>

            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">Interest rate</label>
                <span className="money-calc-input" style={{ background: "transparent", border: "none" }}>{rate.toFixed(2)}% APR</span>
              </div>
              <OSRange value={rate} onChange={(v) => setRate(+v.toFixed(2))} min={cfg.rateMin} max={cfg.rateMax} step={cfg.rateStep}
                minLabel={`${cfg.rateMin}%`} maxLabel={`${cfg.rateMax}%`} />
            </div>

            <div className="money-calc-field">
              <div className="money-calc-row">
                <label className="money-calc-label">Term</label>
                <span className="money-calc-input" style={{ background: "transparent", border: "none" }}>{termDisplay}</span>
              </div>
              <OSRange value={term} onChange={setTerm} min={cfg.termMin} max={cfg.termMax} step={cfg.termStep}
                minLabel={`${cfg.termMin} ${cfg.termUnit === "years" ? "yr" : "mo"}`}
                maxLabel={`${cfg.termMax} ${cfg.termUnit === "years" ? "yr" : "mo"}`} />
            </div>

            {/* result cells */}
            <div className="money-calc-cells" style={{ marginTop: 22 }}>
              <div className="money-calc-cell">
                <span className="money-calc-cell-k">Loan amount</span>
                <span className="money-calc-cell-v hero">{fmtCurrency(loanAmount)}</span>
              </div>
              <div className="money-calc-cell">
                <span className="money-calc-cell-k">Monthly{cfg.type === "interest-only" ? " (int. only)" : ""}</span>
                <span className="money-calc-cell-v hero">{fmtCurrency(Math.round(monthlyPayment))}</span>
              </div>
              <div className="money-calc-cell">
                <span className="money-calc-cell-k">Total interest</span>
                <span className="money-calc-cell-v">{fmtCurrency(Math.round(totalInterest))}</span>
              </div>
              <div className="money-calc-cell">
                <span className="money-calc-cell-k">Total repayment</span>
                <span className="money-calc-cell-v">{fmtCurrency(Math.round(totalRepayment))}</span>
              </div>
              {cfg.hasConstructionBudget && (
                <div className="money-calc-cell" style={{ gridColumn: "1 / -1" }}>
                  <span className="money-calc-cell-k">Total project cost (land + construction)</span>
                  <span className="money-calc-cell-v">{fmtCurrency(totalProjectCost)}</span>
                </div>
              )}
            </div>

            <div className="money-calc-result" style={{ borderTop: "none", paddingTop: 20 }}>
              <p className="money-calc-total" style={{ margin: 0 }}>Estimates only — actual terms vary by property, credit, and experience.</p>
              <a href="/apply" className="os-cta-primary">Get pre-qualified <span aria-hidden>→</span></a>
            </div>
          </div>
        </div>
      </div>
    </OSSection>
  );
}
