import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChartBarSquareIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

export default function CashFlowGapAnalyzerPage() {
  // Multi-step inputs
  const [step, setStep] = useState(0); // 0,1,2 = inputs, 3 = results
  const [monthlyRevenue, setMonthlyRevenue] = useState(40000);
  const [slowMonths, setSlowMonths] = useState<number[]>([]); // indices 0-11
  const [dropPct, setDropPct] = useState(40); // % revenue drop in slow months

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleMonth(i: number) {
    setSlowMonths((prev) =>
      prev.includes(i) ? prev.filter((m) => m !== i) : [...prev, i].sort((a, b) => a - b),
    );
  }

  // ── Gap math ───────────────────────────────────────────────────────────────
  // Estimate operating expenses at ~85% of average revenue (typical small biz).
  const monthlyExpenses = monthlyRevenue * 0.85;
  const slowRevenue = monthlyRevenue * (1 - dropPct / 100);
  const monthlyGap = Math.max(0, monthlyExpenses - slowRevenue); // shortfall per slow month
  const totalGap = monthlyGap * slowMonths.length;
  // Recommend a buffer covering the total gap plus ~20% safety margin.
  const recommendedBuffer = Math.round((totalGap * 1.2) / 1000) * 1000;
  const shortMonthNames = slowMonths.map((i) => MONTHS[i]);

  const onResults = step >= 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const summary = `Cash Flow Gap Analyzer — ${usd(monthlyRevenue)}/mo avg, ${slowMonths.length} slow month(s) (${shortMonthNames.join(", ") || "none"}), ${dropPct}% drop. Est. gap ${usd(totalGap)}, recommended buffer ${usd(recommendedBuffer)}.`;
      const { data, error } = await supabase.functions.invoke("mca-intake", {
        body: {
          business_name: form.business_name,
          contact_first_name: form.contact_first_name,
          contact_last_name: form.contact_last_name,
          email: form.email,
          phone: form.phone,
          amount_requested: Math.max(5000, recommendedBuffer),
          use_of_funds: "Working capital",
          lead_source: "assessment",
          lead_source_detail: summary,
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

  const progress = onResults ? 100 : Math.round(((step + 1) / 3) * 66);

  const canAdvance =
    step === 0 ? monthlyRevenue > 0 : step === 1 ? slowMonths.length > 0 : true;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="Cash Flow Gap Analyzer"
        description="Find out which months your business runs short, the estimated dollar gap, and the working-capital buffer you need. Free instant cash flow analyzer."
        keywords="cash flow gap analyzer, seasonal cash flow, working capital buffer calculator, business cash flow shortfall"
      />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-14 lg:py-16">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <ChartBarSquareIcon className="w-4 h-4" />
                Cash Flow Assessment
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Cash Flow <span className="text-mint-green">Gap Analyzer</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Seasonal slow-downs draining your account? Tell us about your revenue and slow months
                to see exactly when you'll run short, how big the gap is, and the working-capital
                buffer to cover it. Free, no credit impact.
              </p>
            </div>
          </div>
        </section>

        <section className="container-max py-14">
          <div className="max-w-3xl mx-auto">
            {/* Progress */}
            <div className="mb-8">
              <div className="flex justify-between text-xs text-text-secondary mb-2">
                <span>{onResults ? "Complete" : `Step ${step + 1} of 3`}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-mint-green transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* ── Input steps ── */}
            {!onResults && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm animate-scale-in">
                {step === 0 && (
                  <>
                    <h2 className="text-2xl font-bold text-heading mb-6">
                      What's your average monthly revenue?
                    </h2>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        Average month (your good months)
                      </label>
                      <span className="text-mint-green font-bold tabular-nums">
                        {usd(monthlyRevenue)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5000}
                      max={500000}
                      step={2500}
                      value={monthlyRevenue}
                      onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                    />
                    <div className="flex justify-between text-xs text-text-secondary mt-1">
                      <span>$5K</span>
                      <span>$500K</span>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <h2 className="text-2xl font-bold text-heading mb-2">
                      Which months are slow for you?
                    </h2>
                    <p className="text-text-secondary mb-6">Tap all the months revenue dips.</p>
                    <div className="grid grid-cols-4 gap-3">
                      {MONTHS.map((m, i) => {
                        const sel = slowMonths.includes(i);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleMonth(i)}
                            className={`py-3 rounded-xl border text-sm font-semibold transition-all ${
                              sel
                                ? "border-mint-green bg-mint-green/10 ring-2 ring-mint-green text-heading"
                                : "border-gray-200 dark:border-gray-600 hover:border-ocean-blue text-body"
                            }`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                    {slowMonths.length === 0 && (
                      <p className="text-xs text-text-secondary mt-4">
                        Select at least one slow month to continue.
                      </p>
                    )}
                  </>
                )}

                {step === 2 && (
                  <>
                    <h2 className="text-2xl font-bold text-heading mb-6">
                      How much does revenue drop in those months?
                    </h2>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        Revenue drop in slow months
                      </label>
                      <span className="text-mint-green font-bold tabular-nums">{dropPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={5}
                      value={dropPct}
                      onChange={(e) => setDropPct(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                    />
                    <div className="flex justify-between text-xs text-text-secondary mt-1">
                      <span>10%</span>
                      <span>90%</span>
                    </div>
                    <p className="text-sm text-body mt-4">
                      A {dropPct}% drop means a slow month brings in about{" "}
                      <strong className="text-heading">{usd(slowRevenue)}</strong> instead of{" "}
                      {usd(monthlyRevenue)}.
                    </p>
                  </>
                )}

                {/* Nav */}
                <div className="flex items-center justify-between mt-8">
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="inline-flex items-center gap-1 text-sm text-ocean-blue hover:underline disabled:opacity-0"
                  >
                    <ArrowLeftIcon className="w-4 h-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    disabled={!canAdvance}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-60"
                  >
                    {step === 2 ? "See my results" : "Next"} <ArrowRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Results ── */}
            {onResults && (
              <div className="space-y-6">
                {/* LIVE teaser — months + gap headline visible */}
                <div className="rounded-2xl border border-ocean-blue/30 bg-ocean-blue/5 p-8 animate-scale-in">
                  <div className="flex items-center gap-2 mb-4">
                    <CalendarDaysIcon className="w-6 h-6 text-ocean-blue" />
                    <h2 className="text-xl font-bold text-heading">Months you'll likely run short</h2>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {shortMonthNames.length > 0 ? (
                      shortMonthNames.map((m) => (
                        <span
                          key={m}
                          className="px-3 py-1.5 rounded-full bg-error/10 text-error text-sm font-semibold"
                        >
                          {m}
                        </span>
                      ))
                    ) : (
                      <span className="text-body text-sm">No slow months selected.</span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary mb-1">Estimated total annual gap</p>
                  <p className="text-4xl font-extrabold text-error tabular-nums">{usd(totalGap)}</p>
                  <p className="text-xs text-text-secondary mt-1">
                    about {usd(monthlyGap)} short in each of {slowMonths.length} slow month
                    {slowMonths.length === 1 ? "" : "s"}
                  </p>
                </div>

                {unlocked ? (
                  <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                    <div className="flex items-center gap-2 mb-6">
                      <CheckCircleIcon className="w-6 h-6 text-mint-green" />
                      <h2 className="text-2xl font-bold text-heading">Your full cash-flow analysis</h2>
                    </div>

                    <div className="rounded-xl bg-mint-green/10 p-6 mb-4 text-center">
                      <p className="text-sm text-text-secondary mb-1">
                        Recommended working-capital buffer
                      </p>
                      <p className="text-4xl font-extrabold text-mint-green tabular-nums">
                        {usd(recommendedBuffer)}
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        covers your {usd(totalGap)} gap plus a ~20% safety margin
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                        <p className="text-lg font-bold text-heading tabular-nums">{usd(monthlyGap)}</p>
                        <p className="text-xs text-text-secondary mt-0.5">Gap per slow month</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                        <p className="text-lg font-bold text-heading tabular-nums">
                          {slowMonths.length}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">Slow months / yr</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                        <p className="text-lg font-bold text-heading tabular-nums">{usd(totalGap)}</p>
                        <p className="text-xs text-text-secondary mt-0.5">Total annual gap</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-5 flex items-start gap-3">
                      <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                      <p className="text-sm text-body">
                        Thanks, {form.contact_first_name || "there"}! A funding specialist will reach
                        out within 24 hours with flexible working-capital options sized to bridge your{" "}
                        {shortMonthNames.join(", ") || "slow-season"} gap — no credit impact to check.
                      </p>
                    </div>

                    <p className="text-xs text-text-secondary leading-relaxed mt-5">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      These figures are <strong>estimates for planning purposes only</strong>, not an
                      offer, approval, or guarantee. A merchant cash advance is a purchase of future
                      receivables, not a loan. Actual buffer needs depend on your real expenses and
                      underwriting.
                    </p>

                    <Link to="/tools" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                      ← Explore more free tools
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* Locked preview */}
                    <div className="relative bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm overflow-hidden">
                      <div className="blur-sm select-none pointer-events-none" aria-hidden>
                        <p className="text-sm text-text-secondary mb-1 text-center">
                          Recommended working-capital buffer
                        </p>
                        <p className="text-4xl font-extrabold text-mint-green tabular-nums text-center">
                          {usd(recommendedBuffer)}
                        </p>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-midnight-blue/80 text-white text-sm font-semibold">
                          <LockClosedIcon className="w-4 h-4" /> Recommended buffer locked
                        </span>
                      </div>
                    </div>

                    {/* Gate */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                        <h2 className="text-2xl font-bold text-heading">Unlock your full analysis</h2>
                      </div>
                      <p className="text-text-secondary mb-6">
                        See your recommended buffer and the full month-by-month breakdown. Free, no
                        obligation, and checking won't affect your credit.
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
                          {submitting ? "Analyzing…" : "Unlock my full analysis →"}
                        </button>
                        <p className="text-xs text-gray-400 text-center leading-relaxed">
                          <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                          No credit impact. Estimates only — not an offer or guarantee.
                        </p>
                      </form>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
