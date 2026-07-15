import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ScaleIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Payback assumptions used for the estimate
const FACTOR = 1.3; // typical factor rate
const TERM_MONTHS = 12;

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

  const inputCls =
    "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="How Much Funding Can Your Business Safely Handle?"
        description="Find a safe working-capital amount your business can comfortably afford based on your revenue, expenses, and margin. Free instant assessment — no credit impact."
        keywords="how much funding can my business afford, safe merchant cash advance amount, business funding affordability calculator"
      />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <ScaleIcon className="w-4 h-4" />
                Affordability Assessment
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                How much funding can your business{" "}
                <span className="text-mint-green">safely handle?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                The right amount of working capital fuels growth — too much strains cash flow. Tell us
                your revenue, expenses, and margin and we'll estimate a comfortable advance and a
                payment you can sustain. Free, no credit impact.
              </p>
            </div>
          </div>
        </section>

        <section className="container-max py-16">
          {!finished ? (
            <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              <div className="flex items-center justify-between mb-2 text-sm text-text-secondary">
                <span>
                  Step {step + 1} of {TOTAL_STEPS}
                </span>
                <span>{Math.round(((step + 1) / TOTAL_STEPS) * 100)}%</span>
              </div>
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full mb-7 overflow-hidden">
                <div
                  className="h-full bg-mint-green rounded-full transition-all"
                  style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
                />
              </div>

              {step === 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">Average monthly revenue</h2>
                    <span className="text-mint-green font-bold tabular-nums">
                      {usd(monthlyRevenue)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5000}
                    max={500000}
                    step={1000}
                    value={monthlyRevenue}
                    onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green mt-2"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$5K</span>
                    <span>$500K+</span>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">Average monthly expenses</h2>
                    <span className="text-mint-green font-bold tabular-nums">
                      {usd(monthlyExpenses)}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mb-2">
                    All-in operating costs: payroll, rent, inventory, existing payments.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={500000}
                    step={1000}
                    value={monthlyExpenses}
                    onChange={(e) => setMonthlyExpenses(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green mt-2"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$0</span>
                    <span>$500K+</span>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">Rough profit margin</h2>
                    <span className="text-mint-green font-bold tabular-nums">{marginPct}%</span>
                  </div>
                  <p className="text-sm text-text-secondary mb-2">
                    Your best estimate of the profit margin on your sales.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={1}
                    value={marginPct}
                    onChange={(e) => setMarginPct(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green mt-2"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>0%</span>
                    <span>80%</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mt-8">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-text-secondary disabled:opacity-40"
                >
                  <ArrowLeftIcon className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90"
                >
                  {step === TOTAL_STEPS - 1 ? "See my result" : "Next"}
                  <ArrowRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
              {/* Teaser / result */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <SparklesIcon className="w-6 h-6 text-mint-green" />
                  <h2 className="text-2xl font-bold text-heading">What you can safely handle</h2>
                </div>

                {/* Teaser: sustainable payment is always visible */}
                <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-5 mb-4 text-center">
                  <p className="text-sm text-text-secondary mb-1">
                    Sustainable payment, based on your numbers
                  </p>
                  <p className="text-2xl font-bold text-heading tabular-nums">
                    {usd(safeDaily)}/day
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    about {usd(safeWeekly)}/week
                  </p>
                </div>

                {unlocked ? (
                  <>
                    <div className="rounded-xl bg-mint-green/10 p-6 mb-4 text-center">
                      <p className="text-sm text-text-secondary mb-1">
                        Estimated safe advance amount
                      </p>
                      <p className="text-3xl font-bold text-mint-green tabular-nums">
                        {usd(safeAdvance)}
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        over ~{TERM_MONTHS} months at a {FACTOR} factor
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                        <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                          {usd(safeMonthlyPayment)}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">Est. monthly payment</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                        <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                          {usd(safeProfit)}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">Est. monthly free cash</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl bg-mint-green/10 p-6 text-center relative">
                    <p className="text-sm text-text-secondary mb-1">
                      Estimated safe advance amount
                    </p>
                    <p className="text-3xl font-bold text-mint-green blur-md select-none tabular-nums">
                      {usd(safeAdvance)}
                    </p>
                    <p className="text-xs text-text-secondary mt-2">
                      Enter your info to reveal the full safe amount →
                    </p>
                  </div>
                )}
              </div>

              {/* Gate */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                {unlocked ? (
                  <>
                    <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3 mb-4">
                      <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                      <p className="text-sm text-body">
                        Thanks, {form.contact_first_name || "there"}! A funding specialist will reach
                        out within 24 hours to confirm a comfortable amount around {usd(safeAdvance)}{" "}
                        and structure payments that protect your cash flow — no credit impact.
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      These figures are <strong>estimates only</strong>, not an offer, approval, or
                      guarantee, and use illustrative assumptions (≈{FACTOR} factor over {TERM_MONTHS}{" "}
                      months). A merchant cash advance is a purchase of future receivables, not a
                      loan. Actual amounts and terms depend on underwriting and funder review.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setStep(0);
                        setUnlocked(false);
                        setForm(EMPTY_CONTACT);
                      }}
                      className="inline-block mt-5 text-ocean-blue hover:underline text-sm"
                    >
                      ↺ Recalculate
                    </button>
                    <span className="mx-2 text-gray-300">·</span>
                    <Link to="/" className="text-ocean-blue hover:underline text-sm">
                      Back to home
                    </Link>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                      <h2 className="text-2xl font-bold text-heading">Get your full report</h2>
                    </div>
                    <p className="text-text-secondary mb-6">
                      Enter your info to unlock the safe advance amount your business can comfortably
                      handle, plus the monthly payment breakdown. Free, no obligation, no credit
                      impact.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <label className="text-sm sm:col-span-2">
                          <span className="text-gray-600 dark:text-gray-300">Business name</span>
                          <input
                            value={form.business_name}
                            onChange={(e) => set("business_name", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="text-gray-600 dark:text-gray-300">First name *</span>
                          <input
                            required
                            value={form.contact_first_name}
                            onChange={(e) => set("contact_first_name", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="text-gray-600 dark:text-gray-300">Last name</span>
                          <input
                            value={form.contact_last_name}
                            onChange={(e) => set("contact_last_name", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="text-gray-600 dark:text-gray-300">Email *</span>
                          <input
                            required
                            type="email"
                            value={form.email}
                            onChange={(e) => set("email", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="text-gray-600 dark:text-gray-300">Phone *</span>
                          <input
                            required
                            type="tel"
                            value={form.phone}
                            onChange={(e) => set("phone", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                      </div>

                      {error && <p className="text-sm text-red-500">{error}</p>}

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-60"
                      >
                        {submitting ? "Calculating…" : "Get my safe amount →"}
                      </button>
                      <p className="text-xs text-gray-400 text-center leading-relaxed">
                        <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                        No credit impact to check. Estimates only — not an offer or guarantee.
                      </p>
                    </form>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
