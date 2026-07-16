import { useState } from "react";
import { Link } from "react-router-dom";
import { ScaleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import {
  AssessLayout,
  AssessHero,
  AssessBody,
  AssessCard,
  AssessProgress,
  AssessSlider,
  AssessNav,
  AssessStat,
  AssessVerdict,
  AssessNote,
  GateForm,
  usd,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

// Payback assumptions used for the estimate
const FACTOR = 1.3; // typical factor rate
const TERM_MONTHS = 12;

const TOTAL_STEPS = 3;

export default function FundingAffordabilityPage() {
  const [step, setStep] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(60000);
  const [monthlyExpenses, setMonthlyExpenses] = useState(45000);
  const [marginPct, setMarginPct] = useState(20);

  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const finished = step >= TOTAL_STEPS;

  // ── Affordability math ──────────────────────────────────────────────────────
  // Take the more conservative of (revenue - expenses) and (revenue * margin%).
  const cashFlowProfit = Math.max(0, monthlyRevenue - monthlyExpenses);
  const marginProfit = Math.max(0, monthlyRevenue * (marginPct / 100));
  const safeProfit = Math.min(cashFlowProfit, marginProfit);

  // Don't commit more than 10% of gross revenue, nor more than 40% of free profit.
  const safeMonthlyPayment = Math.max(0, Math.min(monthlyRevenue * 0.1, safeProfit * 0.4));
  const safeDaily = safeMonthlyPayment / 21; // ~21 business days
  const safeWeekly = safeMonthlyPayment / 4.33;

  // Advance you could safely carry: payback = payment * term; advance = payback / factor.
  const safePayback = safeMonthlyPayment * TERM_MONTHS;
  const safeAdvance = safePayback / FACTOR;

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
          amount_requested: Math.round(safeAdvance),
          use_of_funds: "Working capital",
          lead_source: "assessment",
          lead_source_detail: `Funding Affordability — safe advance ~${usd(
            safeAdvance
          )}; sustainable ~${usd(safeDaily)}/day; ${usd(monthlyRevenue)}/mo rev, ${usd(
            monthlyExpenses
          )}/mo exp`,
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
    <AssessLayout
      seo={
        <SEO
          title="How Much Funding Can Your Business Safely Handle?"
          description="Find a safe working-capital amount your business can comfortably afford based on your revenue, expenses, and margin. Free instant assessment — no credit impact."
          keywords="how much funding can my business afford, safe merchant cash advance amount, business funding affordability calculator"
        />
      }
    >
      <AssessHero
        badge="Affordability Assessment"
        icon={<ScaleIcon />}
        title={
          <>
            How much funding can your business{" "}
            <span className="os-go">safely handle?</span>
          </>
        }
        lede={
          <>
            The right amount of working capital fuels growth — too much strains cash flow. Tell us
            your revenue, expenses, and margin and we'll estimate a comfortable advance and a payment
            you can sustain. <strong>Free, no credit impact.</strong>
          </>
        }
      />

      <AssessBody>
        {!finished ? (
          <div className="as-narrow">
            <AssessCard>
              <AssessProgress step={step} total={TOTAL_STEPS} />

              {step === 0 && (
                <AssessSlider
                  label="Average monthly revenue"
                  value={monthlyRevenue}
                  display={usd(monthlyRevenue)}
                  min={5000}
                  max={500000}
                  step={1000}
                  onChange={setMonthlyRevenue}
                  minLabel="$5K"
                  maxLabel="$500K+"
                />
              )}

              {step === 1 && (
                <AssessSlider
                  label="Average monthly expenses"
                  value={monthlyExpenses}
                  display={usd(monthlyExpenses)}
                  min={0}
                  max={500000}
                  step={1000}
                  onChange={setMonthlyExpenses}
                  minLabel="$0"
                  maxLabel="$500K+"
                  hint="All-in operating costs: payroll, rent, inventory, existing payments."
                />
              )}

              {step === 2 && (
                <AssessSlider
                  label="Rough profit margin"
                  value={marginPct}
                  display={`${marginPct}%`}
                  min={0}
                  max={80}
                  step={1}
                  onChange={setMarginPct}
                  minLabel="0%"
                  maxLabel="80%"
                  hint="Your best estimate of the profit margin on your sales."
                />
              )}

              <AssessNav
                onBack={() => setStep((s) => Math.max(0, s - 1))}
                onNext={() => setStep((s) => s + 1)}
                backDisabled={step === 0}
                nextLabel={step === TOTAL_STEPS - 1 ? "See my result" : "Next"}
              />
            </AssessCard>
          </div>
        ) : (
          <div className="as-cols">
            {/* Teaser / result */}
            <AssessCard>
              <div className="as-card-head">
                <ScaleIcon />
                <h2 className="as-card-title">What you can safely handle</h2>
              </div>

              {/* Teaser: sustainable payment is always visible */}
              <AssessVerdict tone="info" className="as-locked">
                <p className="as-verdict-cap">Sustainable payment, based on your numbers</p>
                <p className="as-verdict-big as-t-go">{usd(safeDaily)}/day</p>
                <p className="as-verdict-sub">about {usd(safeWeekly)}/week</p>
              </AssessVerdict>

              <div style={{ marginTop: 16 }}>
                {unlocked ? (
                  <>
                    <AssessVerdict tone="go">
                      <p className="as-verdict-cap">Estimated safe advance amount</p>
                      <p className="as-verdict-big as-t-go">{usd(safeAdvance)}</p>
                      <p className="as-verdict-sub">
                        over ~{TERM_MONTHS} months at a {FACTOR} factor
                      </p>
                    </AssessVerdict>

                    <div className="as-statrow cols-2">
                      <AssessStat value={usd(safeMonthlyPayment)} label="Est. monthly payment" />
                      <AssessStat value={usd(safeProfit)} label="Est. monthly free cash" />
                    </div>
                  </>
                ) : (
                  <AssessVerdict tone="go" className="as-locked">
                    <p className="as-verdict-cap">Estimated safe advance amount</p>
                    <p className="as-verdict-big as-t-go as-blur">{usd(safeAdvance)}</p>
                    <p className="as-verdict-sub">Enter your info to reveal the full safe amount →</p>
                  </AssessVerdict>
                )}
              </div>
            </AssessCard>

            {/* Gate */}
            <AssessCard>
              {unlocked ? (
                <>
                  <div className="as-success">
                    <CheckCircleIcon />
                    <p>
                      Thanks, {form.contact_first_name || "there"}! A funding specialist will reach
                      out within 24 hours to confirm a comfortable amount around {usd(safeAdvance)}{" "}
                      and structure payments that protect your cash flow — no credit impact.
                    </p>
                  </div>
                  <AssessNote>
                    These figures are <strong>estimates only</strong>, not an offer, approval, or
                    guarantee, and use illustrative assumptions (≈{FACTOR} factor over {TERM_MONTHS}{" "}
                    months). A merchant cash advance is a purchase of future receivables, not a loan.
                    Actual amounts and terms depend on underwriting and funder review.
                  </AssessNote>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep(0);
                        setUnlocked(false);
                        setForm(EMPTY_CONTACT);
                      }}
                      className="as-backlink"
                      style={{ background: "none", border: 0, cursor: "pointer" }}
                    >
                      ↺ Recalculate
                    </button>
                    <span className="as-sep">·</span>
                    <Link to="/" className="as-backlink">
                      Back to home
                    </Link>
                  </div>
                </>
              ) : (
                <GateForm
                  form={form}
                  onSet={set}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  error={error}
                  heading="Get your full report"
                  blurb="Enter your info to unlock the safe advance amount your business can comfortably handle, plus the monthly payment breakdown. Free, no obligation, no credit impact."
                  submitIdle="Get my safe amount"
                  submitBusy="Calculating…"
                  footnote={
                    <>No credit impact to check. Estimates only — not an offer or guarantee.</>
                  }
                />
              )}
            </AssessCard>
          </div>
        )}
      </AssessBody>
    </AssessLayout>
  );
}
