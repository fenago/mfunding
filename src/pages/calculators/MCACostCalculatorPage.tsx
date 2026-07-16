import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CalculatorIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import { OSSection } from "../../components/landing/os/OSKit";
import {
  ToolShell,
  ToolHero,
  ToolPanel,
  PanelTitle,
  Slider,
  Segmented,
  Field,
  ResultHero,
  StatTile,
} from "../../components/landing/os/tools/ToolsKit";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface ContactForm {
  business_name: string;
  contact_first_name: string;
  contact_last_name: string;
  email: string;
  phone: string;
}
const EMPTY_CONTACT: ContactForm = {
  business_name: "",
  contact_first_name: "",
  contact_last_name: "",
  email: "",
  phone: "",
};

export default function MCACostCalculatorPage() {
  // Calculator inputs (math mirrors CalculatorSection.tsx on the homepage)
  const [amount, setAmount] = useState(50000);
  const [factorRate, setFactorRate] = useState(1.29);
  const [term, setTerm] = useState(12);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // ── Cost math (identical approach to the homepage calculator) ──────────────
  const totalRepayment = amount * factorRate;
  const totalCost = totalRepayment - amount; // fixed fee in plain dollars
  const totalBusinessDays = term * 20; // ~20 business days / month
  const totalWeeks = term * 4; // 4 weeks / month
  const dailyPayment = Math.round(totalRepayment / totalBusinessDays);
  const weeklyPayment = Math.round(totalRepayment / totalWeeks);
  const monthlyPayment = Math.round(totalRepayment / term);
  const payment =
    frequency === "daily" ? dailyPayment : frequency === "weekly" ? weeklyPayment : monthlyPayment;
  const freqAbbr = frequency === "daily" ? "day" : frequency === "weekly" ? "wk" : "mo";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: submitError } = await supabase.functions.invoke("mca-intake", {
        body: {
          business_name: form.business_name || "",
          contact_first_name: form.contact_first_name,
          contact_last_name: form.contact_last_name || "",
          email: form.email,
          phone: form.phone,
          amount_requested: Math.round(amount),
          use_of_funds: "Working capital",
          lead_source: "calculator",
          lead_source_detail: `Cost calculator — ${usd(amount)} at ${factorRate.toFixed(2)} factor over ${term} mo (${frequency})`,
        },
      });
      if (submitError) throw new Error(submitError.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ToolShell>
      <SEO title="Merchant Cash Advance Cost Calculator" description="Calculate the true cost of a merchant cash advance — factor rate, total payback, and daily/weekly remittance. Free calculator from Momentum Funding." keywords="merchant cash advance cost calculator, factor rate calculator, MCA payback calculator" />

      <ToolHero
        eyebrow="ADVANCE COST CALCULATOR"
        title={
          <>
            WHAT WILL YOUR ADVANCE
            <br />
            <span className="os-go">ACTUALLY COST?</span>
          </>
        }
        lede={
          <>
            A merchant cash advance uses a <strong>fixed factor rate</strong> — no compounding
            interest. Adjust the numbers below to see your total payback and per-period payment,
            then unlock the full breakdown.
          </>
        }
      />

      <OSSection tone="panel">
        <div className="ost-cols">
          {/* Inputs */}
          <ToolPanel>
            <PanelTitle>
              <CalculatorIcon /> Advance details
            </PanelTitle>

            <Slider
              label="Advance amount"
              valueLabel={usd(amount)}
              min={5000}
              max={1000000}
              step={5000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              minTick="$5K"
              maxTick="$1M"
            />

            <Slider
              label="Estimated factor rate"
              valueLabel={factorRate.toFixed(2)}
              min={1.2}
              max={1.49}
              step={0.01}
              value={factorRate}
              onChange={(e) => setFactorRate(Math.round(Number(e.target.value) * 100) / 100)}
              minTick="1.20"
              maxTick="1.49"
            />

            <Slider
              label="Estimated term"
              valueLabel={`${term} MO`}
              min={3}
              max={18}
              step={1}
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              minTick="3 mo"
              maxTick="18 mo"
            />

            <div className="ost-slider">
              <span className="ost-sliderlabel" style={{ display: "block", marginBottom: 10 }}>
                Payment frequency
              </span>
              <Segmented
                options={["daily", "weekly", "monthly"] as const}
                value={frequency}
                onChange={setFrequency}
              />
            </div>
          </ToolPanel>

          {/* Result + gate */}
          <ToolPanel>
            {unlocked ? (
              <>
                <PanelTitle>
                  <CalculatorIcon /> Your full breakdown
                </PanelTitle>

                <div className="ost-statgrid ost-statgrid-3">
                  <StatTile value={usd(amount)} label="You receive" />
                  <StatTile value={usd(totalCost)} label="Total cost (fee)" />
                  <StatTile value={usd(totalRepayment)} label="Total payback" go />
                </div>

                <ResultHero
                  cap="Estimated payment"
                  value={
                    <>
                      {usd(payment)}
                      <small>/{freqAbbr}</small>
                    </>
                  }
                />

                <p className="ost-lead" style={{ margin: "18px 0 16px" }}>
                  You get <strong>{usd(amount)}</strong> today and pay back{" "}
                  <strong>{usd(totalRepayment)}</strong> at a {factorRate.toFixed(2)} factor rate over{" "}
                  {term} months. The fee is fixed — it never changes, with no compounding interest.
                </p>

                <div className="ost-note" style={{ marginBottom: 16 }}>
                  <CheckCircleIcon />
                  <p>
                    Thanks, {form.contact_first_name || "there"}! A specialist will reach out within
                    24 hours to match you with the best-priced offers across our funder network.
                  </p>
                </div>

                <p className="ost-fine">
                  <ShieldCheckIcon />
                  These figures are <strong>estimates</strong> for illustration only — not an offer,
                  approval, or guarantee. A merchant cash advance is a purchase of future
                  receivables, not a loan. Your actual factor rate, term, and payment are set by the
                  funder.
                </p>

                <Link to="/" className="ost-back">
                  ← Back to home
                </Link>
              </>
            ) : (
              <>
                <div className="ost-lockhead">
                  <LockClosedIcon />
                  <PanelTitle>Unlock your full breakdown</PanelTitle>
                </div>
                <p className="ost-lead">
                  Enter your info to see your total payback, total cost, and per-period payment — and
                  get matched with the best-priced offers. Free, no obligation, no credit impact.
                </p>

                <form onSubmit={handleSubmit} className="ost-form">
                  <div className="ost-formgrid">
                    <Field
                      label="Business name"
                      col2
                      value={form.business_name}
                      onChange={(e) => set("business_name", e.target.value)}
                    />
                    <Field
                      label="First name *"
                      required
                      value={form.contact_first_name}
                      onChange={(e) => set("contact_first_name", e.target.value)}
                    />
                    <Field
                      label="Last name"
                      value={form.contact_last_name}
                      onChange={(e) => set("contact_last_name", e.target.value)}
                    />
                    <Field
                      label="Email *"
                      required
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                    />
                    <Field
                      label="Phone *"
                      required
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                    />
                  </div>

                  {error && <p className="ost-err">{error}</p>}

                  <button type="submit" disabled={submitting} className="os-cta-primary ost-submit">
                    {submitting ? "Calculating…" : "See my full breakdown →"}
                  </button>
                  <p className="ost-fine" style={{ textAlign: "center" }}>
                    <ShieldCheckIcon />
                    No credit impact to check. Estimates only — not an offer or guarantee.
                  </p>
                </form>
              </>
            )}
          </ToolPanel>
        </div>
      </OSSection>
    </ToolShell>
  );
}
