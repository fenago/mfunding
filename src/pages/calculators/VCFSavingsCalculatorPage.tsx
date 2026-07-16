import { useState } from "react";
import { Link } from "react-router-dom";
import {
  LifebuoyIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowTrendingDownIcon,
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

// ── Money helpers ──────────────────────────────────────────────────────────
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Convert a per-period payment to an approximate monthly figure.
// ~21 business days / month for daily debits, ~4.33 weeks / month for weekly.
const toMonthly = (amount: number, freq: "daily" | "weekly") =>
  freq === "daily" ? amount * 21 : amount * 4.33;

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

export default function VCFSavingsCalculatorPage() {
  // Calculator inputs
  const [positions, setPositions] = useState(3);
  const [totalBalance, setTotalBalance] = useState(120000);
  const [payment, setPayment] = useState(1500);
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // ── Estimated reduction math (50%–75% lower payments) ──────────────────────
  const currentMonthly = toMonthly(payment, frequency);
  // New payment range: keep 25%–50% of the current payment (i.e. a 50%–75% cut).
  const newPaymentLow = currentMonthly * 0.25; // best case (75% reduction)
  const newPaymentHigh = currentMonthly * 0.5; // conservative (50% reduction)
  const monthlySavingsLow = currentMonthly - newPaymentHigh; // conservative saving
  const monthlySavingsHigh = currentMonthly - newPaymentLow; // best-case saving
  const annualSavingsLow = monthlySavingsLow * 12;
  const annualSavingsHigh = monthlySavingsHigh * 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vcf-intake", {
        body: {
          business_name: form.business_name,
          contact_first_name: form.contact_first_name,
          contact_last_name: form.contact_last_name,
          email: form.email,
          phone: form.phone,
          active_positions: String(positions),
          total_balance: String(totalBalance),
          daily_debit: String(payment),
          current_funders: "",
          hardship_reason: "Calculator lead",
        },
      });
      if (error) throw new Error(error.message);
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
      <SEO title="MCA Debt Relief Savings Calculator" description="Estimate how much you could save by restructuring your merchant cash advance debt. Free MCA debt relief calculator from Momentum Funding." keywords="MCA debt relief calculator, merchant cash advance savings, MCA payment reduction calculator" />

      <ToolHero
        eyebrow="MCA DEBT RELIEF CALCULATOR"
        title={
          <>
            HOW MUCH COULD YOU LOWER
            <br />
            <span className="os-go">YOUR DAILY MCA PAYMENTS?</span>
          </>
        }
        lede={
          <>
            Stacked advances eating your cash flow? Move the sliders to see an estimated reduction.
            Our debt-relief partner typically restructures payments by{" "}
            <strong>50–75%</strong>. No new borrowing, no upfront fees, no obligation.
          </>
        }
      />

      <OSSection tone="panel">
        <div className="ost-cols">
          {/* Inputs */}
          <ToolPanel>
            <PanelTitle>
              <LifebuoyIcon /> Your current situation
            </PanelTitle>

            <Slider
              label="Number of advances / positions"
              valueLabel={positions}
              min={1}
              max={10}
              step={1}
              value={positions}
              onChange={(e) => setPositions(Number(e.target.value))}
              minTick="1"
              maxTick="10+"
            />

            <Slider
              label="Total balance owed"
              valueLabel={usd(totalBalance)}
              min={20000}
              max={1000000}
              step={5000}
              value={totalBalance}
              onChange={(e) => setTotalBalance(Number(e.target.value))}
              minTick="$20K"
              maxTick="$1M"
            />

            <Slider
              label={`Combined ${frequency} payment`}
              valueLabel={usd(payment)}
              min={100}
              max={frequency === "daily" ? 10000 : 30000}
              step={50}
              value={payment}
              onChange={(e) => setPayment(Number(e.target.value))}
              minTick="$100"
              maxTick={frequency === "daily" ? "$10K/day" : "$30K/wk"}
            />

            <div className="ost-slider">
              <span className="ost-sliderlabel" style={{ display: "block", marginBottom: 10 }}>
                Payment frequency
              </span>
              <Segmented
                options={["daily", "weekly"] as const}
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
                  <ArrowTrendingDownIcon /> Your estimated relief
                </PanelTitle>

                <ResultHero
                  cap="Estimated new monthly payment"
                  value={`${usd(newPaymentLow)} – ${usd(newPaymentHigh)}`}
                  sub={`down from about ${usd(currentMonthly)}/mo today`}
                />

                <div className="ost-statgrid ost-statgrid-2">
                  <StatTile
                    value={`${usd(monthlySavingsLow)} – ${usd(monthlySavingsHigh)}`}
                    label="Est. monthly savings"
                  />
                  <StatTile
                    value={`${usd(annualSavingsLow)} – ${usd(annualSavingsHigh)}`}
                    label="Est. savings / 12 mo"
                  />
                </div>

                <div className="ost-note">
                  <CheckCircleIcon />
                  <p>
                    We've got it, {form.contact_first_name || "there"}. A debt-relief specialist will
                    reach out within 24 hours to review your {positions} position
                    {positions === 1 ? "" : "s"} and build a plan to lower your payments.
                  </p>
                </div>

                <p className="ost-fine" style={{ marginTop: 18 }}>
                  <ShieldCheckIcon />
                  These are <strong>estimates only</strong>, not an offer or a guarantee. Actual
                  results depend on your funders, balances, and program eligibility. Not all
                  businesses qualify, and savings are never guaranteed.
                </p>

                <Link to="/" className="ost-back">
                  ← Back to home
                </Link>
              </>
            ) : (
              <>
                <div className="ost-lockhead">
                  <LockClosedIcon />
                  <PanelTitle>See your estimate</PanelTitle>
                </div>
                <p className="ost-lead">
                  Enter your info to unlock your estimated new payment and monthly savings. It's free,
                  confidential, and there's no obligation.
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
                    {submitting ? "Calculating…" : "Show my estimated savings →"}
                  </button>
                  <p className="ost-fine" style={{ textAlign: "center" }}>
                    <ShieldCheckIcon />
                    Free, confidential, no upfront fees. Results are estimates, not guarantees.
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
