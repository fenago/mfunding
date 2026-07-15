import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardDocumentCheckIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";

// ── Money helper ────────────────────────────────────────────────────────────
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

type Tier = "likely" | "may" | "talk";

const TIER_META: Record<
  Tier,
  { headline: string; chip: string; ring: string; text: string; blurb: string }
> = {
  likely: {
    headline: "You likely qualify",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    ring: "border-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    blurb:
      "Based on what you shared, your situation lines up well with the businesses our debt-relief partner helps every day. The next step is a no-pressure conversation to confirm the details.",
  },
  may: {
    headline: "You may qualify",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    ring: "border-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    blurb:
      "You're close. A quick review of your positions and revenue will tell us which path fits — and whether a small change in approach opens up more options.",
  },
  talk: {
    headline: "Let's talk it through",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    ring: "border-sky-400",
    text: "text-ocean-blue",
    blurb:
      "Your numbers fall outside the typical program range, but that doesn't mean there's nothing we can do. A short, judgment-free call is the best way to find your options.",
  },
};

const STEPS = ["Total debt", "Positions", "Hardship", "Time in business", "Decision maker"] as const;

export default function ReliefQualifierPage() {
  // Assessment inputs
  const [step, setStep] = useState(0);
  const [totalDebt, setTotalDebt] = useState(80000);
  const [positions, setPositions] = useState(3);
  const [hardship, setHardship] = useState<boolean | null>(null);
  const [timeInBiz, setTimeInBiz] = useState<"<6mo" | "6-12mo" | "1-2yr" | "2yr+" | null>(null);
  const [decisionMaker, setDecisionMaker] = useState<boolean | null>(null);

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // ── Qualification logic ─────────────────────────────────────────────────────
  // Core gate: ~$50k+ total business debt is the typical program floor.
  const meetsDebtFloor = totalDebt >= 50000;
  const establishedBiz = timeInBiz === "1-2yr" || timeInBiz === "2yr+";

  let tier: Tier;
  if (meetsDebtFloor && establishedBiz && (decisionMaker ?? true)) {
    tier = positions >= 2 || hardship ? "likely" : "may";
  } else if (meetsDebtFloor || (totalDebt >= 35000 && positions >= 2)) {
    tier = "may";
  } else {
    tier = "talk";
  }
  const meta = TIER_META[tier];

  // Recommended path: heavy stacking + hardship → restructuring focus;
  // fewer positions / stronger profile → FDIC-bank refinance focus.
  const recommendsRestructuring = positions >= 3 || hardship === true;
  const pathTitle = recommendsRestructuring
    ? "MCA debt restructuring"
    : "FDIC-bank refinance";
  const pathBlurb = recommendsRestructuring
    ? "With multiple stacked positions or active hardship, a restructuring program is usually the fastest way to lower your payments and consolidate the chaos into one manageable schedule."
    : "With a cleaner profile, you may be a fit for a refinance through an FDIC-insured bank partner — replacing high-cost advances with longer, lower-cost financing. Eligibility is confirmed on your call.";

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
          total_balance: String(totalDebt),
          daily_debit: "",
          current_funders: "",
          hardship_reason: `Relief Qualifier — ${meta.headline}; path: ${pathTitle}; time-in-business: ${
            timeInBiz ?? "n/a"
          }; hardship: ${hardship ? "yes" : "no"}; decision maker: ${
            decisionMaker ? "yes" : "no"
          }`,
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

  // Choice-button helper
  const choiceCls = (active: boolean) =>
    `px-5 py-3 rounded-lg text-sm font-semibold border transition-colors ${
      active
        ? "bg-mint-green text-midnight-blue border-mint-green"
        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:border-ocean-blue"
    }`;

  // Whether the current step has enough info to advance.
  const canAdvance =
    (step === 0 && true) ||
    (step === 1 && true) ||
    (step === 2 && hardship !== null) ||
    (step === 3 && timeInBiz !== null) ||
    (step === 4 && decisionMaker !== null);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="Do You Qualify for MCA Relief? | Momentum Funding"
        description="Find out in under a minute whether you qualify for merchant cash advance debt relief — restructuring or an FDIC-bank refinance. Free, confidential, no upfront fees."
        keywords="MCA relief qualification, do I qualify MCA debt relief, merchant cash advance restructuring, FDIC bank refinance, business debt relief"
      />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <ClipboardDocumentCheckIcon className="w-4 h-4" />
                Relief Qualifier
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Do you qualify for{" "}
                <span className="text-mint-green">MCA debt relief?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Five quick questions tell you whether you likely qualify, the recommended path, and
                exactly what happens next. No judgment, no obligation, and no upfront fees — just a
                clear read on your options.
              </p>
            </div>
          </div>
        </section>

        {/* Assessment */}
        <section className="container-max py-16">
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
            {/* Steps / inputs */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {/* Progress */}
              <div className="flex items-center gap-1.5 mb-6">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex-1">
                    <div
                      className={`h-1.5 rounded-full transition-colors ${
                        i <= step ? "bg-mint-green" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs font-semibold text-text-secondary mb-5">
                Step {step + 1} of {STEPS.length} · {STEPS[step]}
              </p>

              {/* Step 0 — total debt */}
              {step === 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    How much total business debt do you have?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Combined MCAs, advances, and business loans. Most programs start around $50k.
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Total business debt
                    </label>
                    <span className="text-mint-green font-bold tabular-nums">{usd(totalDebt)}</span>
                  </div>
                  <input
                    type="range"
                    min={10000}
                    max={1000000}
                    step={5000}
                    value={totalDebt}
                    onChange={(e) => setTotalDebt(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$10K</span>
                    <span>$1M</span>
                  </div>
                  <p
                    className={`mt-4 text-sm font-medium ${
                      meetsDebtFloor ? "text-emerald-600 dark:text-emerald-400" : "text-text-secondary"
                    }`}
                  >
                    {meetsDebtFloor
                      ? "✓ Above the typical $50k program threshold."
                      : "Below the typical $50k threshold — we can still talk through options."}
                  </p>
                </div>
              )}

              {/* Step 1 — positions */}
              {step === 1 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    How many stacked positions do you have?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Count every open advance, even the small ones.
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Stacked positions
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
              )}

              {/* Step 2 — hardship */}
              {step === 2 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    Are you experiencing financial hardship?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Struggling to make daily payments, falling behind, or cash flow drying up? There's
                    no judgment here — it just helps us point you to the right path.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setHardship(true)}
                      className={choiceCls(hardship === true)}
                    >
                      Yes, it's tight
                    </button>
                    <button
                      type="button"
                      onClick={() => setHardship(false)}
                      className={choiceCls(hardship === false)}
                    >
                      No, just want options
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3 — time in business */}
              {step === 3 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    How long have you been in business?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Time in business affects which programs you're eligible for.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ["<6mo", "Under 6 months"],
                      ["6-12mo", "6–12 months"],
                      ["1-2yr", "1–2 years"],
                      ["2yr+", "2+ years"],
                    ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTimeInBiz(val)}
                        className={choiceCls(timeInBiz === val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4 — decision maker */}
              {step === 4 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    Are you the decision maker?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Can you make financial decisions for the business?
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setDecisionMaker(true)}
                      className={choiceCls(decisionMaker === true)}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisionMaker(false)}
                      className={choiceCls(decisionMaker === false)}
                    >
                      No / shared
                    </button>
                  </div>
                </div>
              )}

              {/* Nav buttons */}
              <div className="flex items-center justify-between mt-8">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="text-sm font-semibold text-text-secondary disabled:opacity-40"
                >
                  ← Back
                </button>
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    disabled={!canAdvance}
                    className="px-6 py-2.5 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90 disabled:opacity-40"
                  >
                    Next →
                  </button>
                ) : (
                  <span className="text-sm text-mint-green font-semibold">See your result →</span>
                )}
              </div>
            </div>

            {/* Result + gate */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {/* LIVE teaser — always visible */}
              <div className="flex items-center gap-2 mb-4">
                <SparklesIcon className={`w-6 h-6 ${meta.text}`} />
                <h2 className="text-2xl font-bold text-heading">Your result</h2>
              </div>

              <div className={`rounded-xl border-2 ${meta.ring} p-5 mb-5 text-center`}>
                <span
                  className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 ${meta.chip}`}
                >
                  {meta.headline}
                </span>
                <p className="text-sm text-body">{meta.blurb}</p>
              </div>

              {unlocked ? (
                <>
                  <div className="rounded-xl bg-mint-green/10 p-5 mb-4">
                    <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">
                      Recommended path
                    </p>
                    <p className="text-xl font-bold text-mint-green">{pathTitle}</p>
                    <p className="text-sm text-body mt-2">{pathBlurb}</p>
                  </div>

                  <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-5 mb-4">
                    <p className="text-sm font-bold text-heading mb-3">What happens next</p>
                    <ol className="space-y-2.5">
                      {[
                        "A debt-relief specialist calls you within 24 hours — confidential and judgment-free.",
                        "They review your positions, balances, and cash flow to confirm eligibility.",
                        "You get a clear, written plan with estimated payments before deciding anything.",
                        "If it's a fit, your specialist guides the setup. If not, you owe nothing.",
                      ].map((t, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-body">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-ocean-blue/15 text-ocean-blue font-bold text-xs flex items-center justify-center">
                            {i + 1}
                          </span>
                          {t}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      You're all set, {form.contact_first_name || "there"}. Watch for a call from your
                      relief specialist within 24 hours.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed mt-5">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    This is an <strong>estimated eligibility indication</strong>, not an offer,
                    approval, or guarantee of relief or savings. Restructuring and an FDIC-bank
                    refinance are different programs, and restructuring is not the same as a
                    reverse-consolidation advance. Final eligibility is confirmed during your call.
                    There are <strong>no upfront fees</strong>.
                  </p>

                  <Link to="/" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h3 className="text-xl font-bold text-heading">Get your full result</h3>
                  </div>
                  <p className="text-text-secondary mb-6 text-sm">
                    Enter your info to unlock your recommended path and exactly what happens next.
                    Free, confidential, no obligation.
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
                      className="w-full py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {submitting ? "Checking…" : "Get my full result"}
                      {!submitting && <ArrowRightIcon className="w-4 h-4" />}
                    </button>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      Free, confidential, no upfront fees. Eligibility is estimated, not guaranteed.
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
