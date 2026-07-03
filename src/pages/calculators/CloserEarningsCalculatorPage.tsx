import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BriefcaseIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from '../../components/seo/SEO';
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface ContactForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}
const EMPTY_CONTACT: ContactForm = { first_name: "", last_name: "", email: "", phone: "" };

export default function CloserEarningsCalculatorPage() {
  // Calculator inputs
  const [dealsPerMonth, setDealsPerMonth] = useState(6);
  const [avgDealSize, setAvgDealSize] = useState(50000);
  const [splitPct, setSplitPct] = useState(35);

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Commission = 8 points (8% of funded amount); the closer keeps their split.
  const commissionPerDeal = avgDealSize * 0.08;
  const earningsPerDeal = commissionPerDeal * (splitPct / 100);
  const monthly = earningsPerDeal * dealsPerMonth;
  const annual = monthly * 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await mustWrite(
        "submit closer recruiting application",
        supabase.from("contact_submissions").insert({
          name: `${form.first_name} ${form.last_name}`.trim(),
          email: form.email,
          phone: form.phone || null,
          subject: "MCA Closer Recruiting Application",
          message:
            `Recruiting lead from closer-earnings calculator. ` +
            `Inputs: ${dealsPerMonth} deals/mo, avg deal ${usd(avgDealSize)}, ${splitPct}% split. ` +
            `Projected: ${usd(monthly)}/mo, ${usd(annual)}/yr.`,
        }),
      );
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
      <SEO title="MCA Closer Earnings Calculator" description="Estimate your potential earnings as a 1099 MCA closer with Momentum Funding. Calculate commission on funded deals." keywords="MCA closer earnings, commission calculator, MCA sales rep income" />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <BriefcaseIcon className="w-4 h-4" />
                Closer Earnings Calculator
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                How much can you earn as an{" "}
                <span className="text-mint-green">MCA closer?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Our 1099 closers earn a generous split on every funded deal — company leads provided.
                Adjust the numbers to see your earning potential, then apply to join the team.
              </p>
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section className="container-max py-16">
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
            {/* Inputs */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-heading mb-6">Your potential</h2>

              {/* Deals / month */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Funded deals per month
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{dealsPerMonth}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={dealsPerMonth}
                  onChange={(e) => setDealsPerMonth(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>1</span>
                  <span>30</span>
                </div>
              </div>

              {/* Avg deal size */}
              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Average deal size
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{usd(avgDealSize)}</span>
                </div>
                <input
                  type="range"
                  min={10000}
                  max={250000}
                  step={5000}
                  value={avgDealSize}
                  onChange={(e) => setAvgDealSize(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$10K</span>
                  <span>$250K</span>
                </div>
              </div>

              {/* Split */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Your commission split
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{splitPct}%</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={70}
                  step={5}
                  value={splitPct}
                  onChange={(e) => setSplitPct(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>30% (company leads)</span>
                  <span>70% (self-gen)</span>
                </div>
              </div>

              <p className="text-xs text-text-secondary mt-6 leading-relaxed">
                Based on 8 points (8% of funded amount) per new deal — the standard MCA broker
                commission. Your split is applied to that commission.
              </p>
            </div>

            {/* Result + gate */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {unlocked ? (
                <>
                  <div className="flex items-center gap-2 mb-6">
                    <TrophyIcon className="w-6 h-6 text-mint-green" />
                    <h2 className="text-2xl font-bold text-heading">Your earning potential</h2>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl bg-mint-green/10 p-5 text-center">
                      <p className="text-sm text-text-secondary mb-1">Per month</p>
                      <p className="text-2xl font-bold text-mint-green tabular-nums">{usd(monthly)}</p>
                    </div>
                    <div className="rounded-xl bg-mint-green/10 p-5 text-center">
                      <p className="text-sm text-text-secondary mb-1">Per year</p>
                      <p className="text-2xl font-bold text-mint-green tabular-nums">{usd(annual)}</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 mb-4 text-center">
                    <p className="text-sm text-body">
                      That's about <strong>{usd(earningsPerDeal)}</strong> per funded deal at a{" "}
                      {splitPct}% split.
                    </p>
                  </div>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3 mb-4">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      Thanks, {form.first_name || "there"}! Your application is in. Our team will reach
                      out to talk through the role, leads, and onboarding.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    Figures are <strong>estimates</strong> of earning potential, not a guarantee of
                    income. Actual earnings depend on close rate, deal flow, and individual performance.
                    Closers are independent (1099) contractors.
                  </p>

                  <Link to="/" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h2 className="text-2xl font-bold text-heading">See your earning potential</h2>
                  </div>
                  <p className="text-text-secondary mb-6">
                    Enter your info to unlock your projected monthly and annual earnings — and apply to
                    join our closer team.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <label className="text-sm">
                        <span className="text-gray-600 dark:text-gray-300">First name *</span>
                        <input
                          required
                          value={form.first_name}
                          onChange={(e) => set("first_name", e.target.value)}
                          className={inputCls}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-gray-600 dark:text-gray-300">Last name</span>
                        <input
                          value={form.last_name}
                          onChange={(e) => set("last_name", e.target.value)}
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
                      {submitting ? "Submitting…" : "Show my earnings & apply to join →"}
                    </button>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      Earning potential is an estimate, not a guarantee of income.
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
