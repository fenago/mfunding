import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChartBarIcon,
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

const MINT = "#00D49D";

// ── Answer option sets ───────────────────────────────────────────────────────
const TIB_OPTIONS = [
  { label: "Less than 6 months", pts: 2 },
  { label: "6 – 12 months", pts: 9 },
  { label: "1 – 2 years", pts: 15 },
  { label: "2 – 5 years", pts: 18 },
  { label: "5+ years", pts: 20 },
];
const CREDIT_OPTIONS = [
  { label: "Below 500", pts: 4 },
  { label: "500 – 599", pts: 9 },
  { label: "600 – 679", pts: 14 },
  { label: "680 – 739", pts: 18 },
  { label: "740+", pts: 20 },
];
const ADVANCE_OPTIONS = [
  { label: "None", pts: 10 },
  { label: "1", pts: 7 },
  { label: "2", pts: 4 },
  { label: "3", pts: 1 },
  { label: "4 or more", pts: 0 },
];
const INDUSTRY_OPTIONS = [
  "Retail",
  "Restaurant / Food Service",
  "Healthcare",
  "Construction",
  "Transportation",
  "Professional Services",
  "Manufacturing",
  "E-commerce",
  "Other",
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

const TOTAL_STEPS = 7;

export default function FundingReadinessScorePage() {
  // Assessment inputs
  const [step, setStep] = useState(0);
  const [tib, setTib] = useState<string>("");
  const [monthlyRevenue, setMonthlyRevenue] = useState(40000);
  const [avgBalance, setAvgBalance] = useState(8000);
  const [nsfs, setNsfs] = useState(2);
  const [creditBand, setCreditBand] = useState<string>("");
  const [advances, setAdvances] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const finished = step >= TOTAL_STEPS;

  // ── Scoring (0–100) ────────────────────────────────────────────────────────
  const revenueScore = Math.min(25, (monthlyRevenue / 100000) * 25); // 0–25
  const tibScore = TIB_OPTIONS.find((o) => o.label === tib)?.pts ?? 0; // 0–20
  const nsfScore = Math.max(0, 15 - nsfs * 1.5); // 0–15
  const creditScore = CREDIT_OPTIONS.find((o) => o.label === creditBand)?.pts ?? 0; // 0–20
  const balanceRatio = monthlyRevenue > 0 ? avgBalance / monthlyRevenue : 0;
  const balanceScore = Math.min(10, (balanceRatio / 0.25) * 10); // 0–10
  const stackScore = ADVANCE_OPTIONS.find((o) => o.label === advances)?.pts ?? 0; // 0–10

  const score = Math.round(
    revenueScore + tibScore + nsfScore + creditScore + balanceScore + stackScore
  );

  const tier =
    score >= 75
      ? { label: "Strong", color: MINT }
      : score >= 50
      ? { label: "Good", color: "#F59E0B" }
      : { label: "Building", color: "#EF4444" };

  // Likely products
  const products: string[] = [];
  if (score >= 45) products.push("Merchant Cash Advance");
  if (score >= 60 && nsfs <= 4) products.push("Business Line of Credit");
  if (score >= 70 && tibScore >= 15) products.push("Term Funding");
  if (creditScore >= 18 && tibScore >= 18) products.push("SBA Programs");
  if (products.length === 0) products.push("Starter Working Capital");

  // Estimated amount range (~50–150% of monthly revenue), scaled by readiness
  const factor = 0.6 + (score / 100) * 0.9; // ~0.6x–1.5x
  const low = monthlyRevenue * 0.5;
  const high = monthlyRevenue * Math.max(0.75, factor);
  const midpoint = (low + high) / 2;

  const breakdown = [
    { label: "Monthly revenue", value: revenueScore, max: 25 },
    { label: "Time in business", value: tibScore, max: 20 },
    { label: "Credit profile", value: creditScore, max: 20 },
    { label: "Cash management (NSFs)", value: nsfScore, max: 15 },
    { label: "Avg. bank balance", value: balanceScore, max: 10 },
    { label: "Existing advances", value: stackScore, max: 10 },
  ];

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
          amount_requested: Math.round(midpoint),
          use_of_funds: "Working capital",
          lead_source: "assessment",
          lead_source_detail: `Funding Readiness Score — ${score}/100 (${tier.label}); est. ${usd(
            low
          )}–${usd(high)}; ${monthlyRevenue.toLocaleString()}/mo${
            industry ? `, ${industry}` : ""
          }`,
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

  // Can the user advance from the current step?
  const canAdvance =
    (step === 0 && tib) ||
    step === 1 ||
    step === 2 ||
    step === 3 ||
    (step === 4 && creditBand) ||
    (step === 5 && advances) ||
    (step === 6 && industry);

  // ── Reusable choice button ─────────────────────────────────────────────────
  function Choice({
    label,
    selected,
    onClick,
  }: {
    label: string;
    selected: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-4 py-3 rounded-xl border-2 font-medium transition-colors ${
          selected
            ? "border-mint-green bg-mint-green/10 text-heading"
            : "border-gray-200 dark:border-gray-600 hover:border-mint-green/60 text-body"
        }`}
      >
        {label}
      </button>
    );
  }

  // ── Radial gauge ───────────────────────────────────────────────────────────
  function Gauge({ value }: { value: number }) {
    const R = 56;
    const C = 2 * Math.PI * R;
    const pct = Math.max(0, Math.min(100, value)) / 100;
    return (
      <div className="relative w-40 h-40 mx-auto">
        <svg viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#E5E7EB" strokeWidth="12" />
          <circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={tier.color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tabular-nums" style={{ color: tier.color }}>
            {value}
          </span>
          <span className="text-xs text-text-secondary">out of 100</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="Funding Readiness Score — Free Business Assessment"
        description="Answer 7 quick questions to see your free Funding Readiness Score and which working-capital products your business likely qualifies for. No credit impact."
        keywords="funding readiness score, business funding qualification, merchant cash advance eligibility, do I qualify for business funding"
      />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <ChartBarIcon className="w-4 h-4" />
                Funding Readiness Score
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                How fundable is your{" "}
                <span className="text-mint-green">business right now?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Answer 7 quick questions to get your free Funding Readiness Score (0–100), see which
                working-capital products you likely qualify for, and an estimated funding range. No
                credit impact, no obligation.
              </p>
            </div>
          </div>
        </section>

        <section className="container-max py-16">
          {!finished ? (
            // ── Wizard ──────────────────────────────────────────────────────
            <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {/* Progress */}
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
                  <h2 className="text-xl font-bold text-heading mb-5">How long in business?</h2>
                  <div className="space-y-3">
                    {TIB_OPTIONS.map((o) => (
                      <Choice
                        key={o.label}
                        label={o.label}
                        selected={tib === o.label}
                        onClick={() => setTib(o.label)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {step === 1 && (
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

              {step === 2 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">Average bank balance</h2>
                    <span className="text-mint-green font-bold tabular-nums">{usd(avgBalance)}</span>
                  </div>
                  <p className="text-sm text-text-secondary mb-2">
                    Roughly what your account holds on a typical day.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={200000}
                    step={500}
                    value={avgBalance}
                    onChange={(e) => setAvgBalance(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green mt-2"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$0</span>
                    <span>$200K+</span>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">
                      Negative days / NSFs per month
                    </h2>
                    <span className="text-mint-green font-bold tabular-nums">{nsfs}</span>
                  </div>
                  <p className="text-sm text-text-secondary mb-2">
                    How many times per month your account goes negative or bounces.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={nsfs}
                    onChange={(e) => setNsfs(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green mt-2"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>0</span>
                    <span>30+</span>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div>
                  <h2 className="text-xl font-bold text-heading mb-5">Estimated credit band</h2>
                  <div className="space-y-3">
                    {CREDIT_OPTIONS.map((o) => (
                      <Choice
                        key={o.label}
                        label={o.label}
                        selected={creditBand === o.label}
                        onClick={() => setCreditBand(o.label)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div>
                  <h2 className="text-xl font-bold text-heading mb-5">
                    Existing advances / positions
                  </h2>
                  <div className="space-y-3">
                    {ADVANCE_OPTIONS.map((o) => (
                      <Choice
                        key={o.label}
                        label={o.label}
                        selected={advances === o.label}
                        onClick={() => setAdvances(o.label)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {step === 6 && (
                <div>
                  <h2 className="text-xl font-bold text-heading mb-5">Industry</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {INDUSTRY_OPTIONS.map((o) => (
                      <Choice
                        key={o}
                        label={o}
                        selected={industry === o}
                        onClick={() => setIndustry(o)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Nav */}
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
                  disabled={!canAdvance}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {step === TOTAL_STEPS - 1 ? "See my score" : "Next"}
                  <ArrowRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            // ── Results: teaser gauge + gate ────────────────────────────────
            <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
              {/* Teaser */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <SparklesIcon className="w-6 h-6 text-mint-green" />
                  <h2 className="text-2xl font-bold text-heading">Your Funding Readiness Score</h2>
                </div>

                <Gauge value={score} />

                <p className="text-center mt-4 mb-2">
                  <span
                    className="inline-block px-4 py-1.5 rounded-full text-sm font-bold"
                    style={{ backgroundColor: `${tier.color}1A`, color: tier.color }}
                  >
                    {tier.label} readiness
                  </span>
                </p>

                {unlocked ? (
                  <>
                    <div className="rounded-xl bg-mint-green/10 p-6 my-4 text-center">
                      <p className="text-sm text-text-secondary mb-1">Estimated funding range</p>
                      <p className="text-3xl font-bold text-mint-green tabular-nums">
                        {usd(low)} – {usd(high)}
                      </p>
                    </div>

                    <h3 className="font-bold text-heading mb-3">Score breakdown</h3>
                    <div className="space-y-3 mb-5">
                      {breakdown.map((b) => (
                        <div key={b.label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-body">{b.label}</span>
                            <span className="text-text-secondary tabular-nums">
                              {Math.round(b.value)}/{b.max}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-mint-green rounded-full"
                              style={{ width: `${(b.value / b.max) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <h3 className="font-bold text-heading mb-2">Products you likely qualify for</h3>
                    <ul className="space-y-2">
                      {products.map((p) => (
                        <li key={p} className="flex items-center gap-2 text-body">
                          <CheckCircleIcon className="w-5 h-5 text-mint-green flex-shrink-0" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-center text-text-secondary text-sm mt-4">
                    Unlock your full breakdown, estimated funding range, and the products you qualify
                    for →
                  </p>
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
                        out within 24 hours with real options matched to your {score}/100 readiness
                        score — checking won't affect your credit.
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      This score and range are <strong>estimates only</strong>, not an offer,
                      approval, or guarantee. A merchant cash advance is a purchase of future
                      receivables, not a loan. Final amounts depend on underwriting and funder
                      review.
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
                      ↺ Retake the assessment
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
                      Enter your info to unlock your full score breakdown, estimated funding range,
                      and the products you qualify for. Free, no obligation, no credit impact.
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
                        {submitting ? "Generating…" : "Get my full report →"}
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
