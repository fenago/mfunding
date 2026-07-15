import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CalculatorIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from '../../components/seo/SEO';
import supabase from "../../supabase";

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

  const inputCls =
    "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO title="Merchant Cash Advance Cost Calculator" description="Calculate the true cost of a merchant cash advance — factor rate, total payback, and daily/weekly remittance. Free calculator from Momentum Funding." keywords="merchant cash advance cost calculator, factor rate calculator, MCA payback calculator" />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <CalculatorIcon className="w-4 h-4" />
                Advance Cost Calculator
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                What will your advance{" "}
                <span className="text-mint-green">actually cost?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                A merchant cash advance uses a fixed factor rate — no compounding interest. Adjust the
                numbers below to see your total payback and per-period payment, then unlock the full
                breakdown.
              </p>
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section className="container-max py-16">
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
            {/* Inputs */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-heading mb-6">Advance details</h2>

              {/* Amount */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Advance amount
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{usd(amount)}</span>
                </div>
                <input
                  type="range"
                  min={5000}
                  max={1000000}
                  step={5000}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$5K</span>
                  <span>$1M</span>
                </div>
              </div>

              {/* Factor rate */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Estimated factor rate
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">
                    {factorRate.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={1.49}
                  step={0.01}
                  value={factorRate}
                  onChange={(e) => setFactorRate(Math.round(Number(e.target.value) * 100) / 100)}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>1.20</span>
                  <span>1.49</span>
                </div>
              </div>

              {/* Term */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Estimated term
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{term} months</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={18}
                  step={1}
                  value={term}
                  onChange={(e) => setTerm(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>3 mo</span>
                  <span>18 mo</span>
                </div>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Payment frequency
                </label>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 w-fit">
                  {(["daily", "weekly", "monthly"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`px-5 py-2 text-sm font-semibold capitalize transition-colors ${
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
                    <CalculatorIcon className="w-6 h-6 text-mint-green" />
                    <h2 className="text-2xl font-bold text-heading">Your full breakdown</h2>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="text-center rounded-lg bg-gray-50 dark:bg-gray-700/50 py-4 px-2">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {usd(amount)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">You receive</p>
                    </div>
                    <div className="text-center rounded-lg bg-gray-50 dark:bg-gray-700/50 py-4 px-2">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {usd(totalCost)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">Total cost (fee)</p>
                    </div>
                    <div className="text-center rounded-lg bg-mint-green/10 py-4 px-2">
                      <p className="text-lg font-bold text-mint-green tabular-nums">
                        {usd(totalRepayment)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">Total payback</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-mint-green/10 p-5 mb-4 text-center">
                    <p className="text-sm text-text-secondary mb-1">Estimated payment</p>
                    <p className="text-3xl font-bold text-mint-green tabular-nums">
                      {usd(payment)}
                      <span className="text-xl">/{freqAbbr}</span>
                    </p>
                  </div>

                  <p className="text-sm text-body leading-relaxed mb-4">
                    You get <strong>{usd(amount)}</strong> today and pay back{" "}
                    <strong>{usd(totalRepayment)}</strong> at a {factorRate.toFixed(2)} factor rate over{" "}
                    {term} months. The fee is fixed — it never changes, with no compounding interest.
                  </p>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3 mb-4">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      Thanks, {form.contact_first_name || "there"}! A specialist will reach out within
                      24 hours to match you with the best-priced offers across our funder network.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    These figures are <strong>estimates</strong> for illustration only — not an offer,
                    approval, or guarantee. A merchant cash advance is a purchase of future receivables,
                    not a loan. Your actual factor rate, term, and payment are set by the funder.
                  </p>

                  <Link to="/" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h2 className="text-2xl font-bold text-heading">Unlock your full breakdown</h2>
                  </div>
                  <p className="text-text-secondary mb-6">
                    Enter your info to see your total payback, total cost, and per-period payment — and
                    get matched with the best-priced offers. Free, no obligation, no credit impact.
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
                      {submitting ? "Calculating…" : "See my full breakdown →"}
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
        </section>
      </main>

      <Footer />
    </div>
  );
}
