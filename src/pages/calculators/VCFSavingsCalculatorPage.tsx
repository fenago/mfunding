import { useState } from "react";
import { Link } from "react-router-dom";
import {
  LifebuoyIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowTrendingDownIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from '../../components/seo/SEO';
import supabase from "../../supabase";

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

  const inputCls =
    "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO title="MCA Debt Relief Savings Calculator" description="Estimate how much you could save by restructuring your merchant cash advance debt. Free MCA debt relief calculator from Momentum Funding." keywords="MCA debt relief calculator, merchant cash advance savings, MCA payment reduction calculator" />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <LifebuoyIcon className="w-4 h-4" />
                MCA Debt Relief Calculator
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                How much could you lower your{" "}
                <span className="text-mint-green">daily MCA payments?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Stacked advances eating your cash flow? Move the sliders to see an estimated reduction.
                Our debt-relief partner typically restructures payments by 50–75%. No new borrowing,
                no upfront fees, no obligation.
              </p>
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section className="container-max py-16">
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
            {/* Inputs */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-heading mb-6">Your current situation</h2>

              {/* Positions */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Number of advances / positions
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{positions}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={positions}
                  onChange={(e) => setPositions(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>1</span>
                  <span>10+</span>
                </div>
              </div>

              {/* Total balance */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Total balance owed
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{usd(totalBalance)}</span>
                </div>
                <input
                  type="range"
                  min={20000}
                  max={1000000}
                  step={5000}
                  value={totalBalance}
                  onChange={(e) => setTotalBalance(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$20K</span>
                  <span>$1M</span>
                </div>
              </div>

              {/* Combined payment */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Combined {frequency} payment
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{usd(payment)}</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={frequency === "daily" ? 10000 : 30000}
                  step={50}
                  value={payment}
                  onChange={(e) => setPayment(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$100</span>
                  <span>{frequency === "daily" ? "$10K/day" : "$30K/wk"}</span>
                </div>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Payment frequency
                </label>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 w-fit">
                  {(["daily", "weekly"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`px-6 py-2 text-sm font-semibold capitalize transition-colors ${
                        frequency === f
                          ? "bg-mint-green text-midnight-blue"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Result + gate */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {unlocked ? (
                <>
                  <div className="flex items-center gap-2 mb-6">
                    <ArrowTrendingDownIcon className="w-6 h-6 text-mint-green" />
                    <h2 className="text-2xl font-bold text-heading">Your estimated relief</h2>
                  </div>

                  <div className="rounded-xl bg-mint-green/10 p-5 mb-4 text-center">
                    <p className="text-sm text-text-secondary mb-1">Estimated new monthly payment</p>
                    <p className="text-3xl font-bold text-mint-green tabular-nums">
                      {usd(newPaymentLow)} – {usd(newPaymentHigh)}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      down from about {usd(currentMonthly)}/mo today
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {usd(monthlySavingsLow)} – {usd(monthlySavingsHigh)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">Est. monthly savings</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {usd(annualSavingsLow)} – {usd(annualSavingsHigh)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">Est. savings / 12 mo</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      We've got it, {form.contact_first_name || "there"}. A debt-relief specialist will
                      reach out within 24 hours to review your {positions} position
                      {positions === 1 ? "" : "s"} and build a plan to lower your payments.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed mt-5">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    These are <strong>estimates only</strong>, not an offer or a guarantee. Actual
                    results depend on your funders, balances, and program eligibility. Not all
                    businesses qualify, and savings are never guaranteed.
                  </p>

                  <Link
                    to="/"
                    className="inline-block mt-5 text-ocean-blue hover:underline text-sm"
                  >
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h2 className="text-2xl font-bold text-heading">See your estimate</h2>
                  </div>
                  <p className="text-text-secondary mb-6">
                    Enter your info to unlock your estimated new payment and monthly savings. It's free,
                    confidential, and there's no obligation.
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
                      {submitting ? "Calculating…" : "Show my estimated savings →"}
                    </button>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      Free, confidential, no upfront fees. Results are estimates, not guarantees.
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
