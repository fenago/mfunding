import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PuzzlePieceIcon,
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

type ProductKey =
  | "Merchant Cash Advance"
  | "Business Line of Credit"
  | "Term Funding"
  | "Equipment Financing"
  | "SBA Program";

const PRODUCT_BLURB: Record<ProductKey, string> = {
  "Merchant Cash Advance":
    "Fast working capital repaid as a small share of daily or weekly sales — funded in as little as 24 hours, all credit profiles welcome.",
  "Business Line of Credit":
    "Flexible revolving capital you draw on as needed and only pay for what you use — ideal for managing ongoing cash-flow swings.",
  "Term Funding":
    "A fixed amount of capital with predictable payments over a set term — best for larger, planned investments in growth.",
  "Equipment Financing":
    "Capital secured by the equipment itself, letting you acquire machinery or vehicles while preserving cash on hand.",
  "SBA Program":
    "Government-backed financing with longer terms and lower costs for well-qualified, established businesses — slower to fund.",
};

// Answer options
const SPEED_OPTIONS = ["ASAP (24–48 hours)", "Within a week", "2–4 weeks", "1–2 months", "Flexible"];
const COLLATERAL_OPTIONS = ["Yes — equipment / assets", "Some", "No"];
const CREDIT_OPTIONS = ["Below 600", "600 – 679", "680 – 739", "740+"];
const USE_OPTIONS = [
  "Working capital / payroll",
  "Inventory",
  "Equipment purchase",
  "Expansion / new location",
  "Marketing",
  "Refinance / consolidate",
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

const TOTAL_STEPS = 5;

export default function FundingMatcherPage() {
  const [step, setStep] = useState(0);
  const [speed, setSpeed] = useState("");
  const [amount, setAmount] = useState(75000);
  const [collateral, setCollateral] = useState("");
  const [creditBand, setCreditBand] = useState("");
  const [useOfFunds, setUseOfFunds] = useState("");

  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const finished = step >= TOTAL_STEPS;

  // ── Matching engine: score each product ────────────────────────────────────
  function computeScores(): { key: ProductKey; score: number }[] {
    const s: Record<ProductKey, number> = {
      "Merchant Cash Advance": 0,
      "Business Line of Credit": 0,
      "Term Funding": 0,
      "Equipment Financing": 0,
      "SBA Program": 0,
    };

    // Speed
    if (speed === "ASAP (24–48 hours)") {
      s["Merchant Cash Advance"] += 5;
      s["Business Line of Credit"] += 2;
    } else if (speed === "Within a week") {
      s["Merchant Cash Advance"] += 3;
      s["Business Line of Credit"] += 3;
      s["Term Funding"] += 1;
    } else if (speed === "2–4 weeks") {
      s["Term Funding"] += 3;
      s["Equipment Financing"] += 2;
      s["Business Line of Credit"] += 1;
    } else if (speed === "1–2 months" || speed === "Flexible") {
      s["SBA Program"] += 4;
      s["Term Funding"] += 3;
      s["Equipment Financing"] += 2;
    }

    // Amount
    if (amount <= 50000) {
      s["Merchant Cash Advance"] += 3;
      s["Business Line of Credit"] += 3;
    } else if (amount <= 150000) {
      s["Term Funding"] += 2;
      s["Business Line of Credit"] += 2;
      s["Merchant Cash Advance"] += 1;
    } else {
      s["Term Funding"] += 3;
      s["SBA Program"] += 3;
      s["Equipment Financing"] += 1;
    }

    // Collateral
    if (collateral === "Yes — equipment / assets") {
      s["Equipment Financing"] += 4;
      s["SBA Program"] += 2;
      s["Term Funding"] += 1;
    } else if (collateral === "Some") {
      s["Term Funding"] += 1;
      s["Equipment Financing"] += 1;
    } else if (collateral === "No") {
      s["Merchant Cash Advance"] += 3;
      s["Business Line of Credit"] += 2;
    }

    // Credit
    if (creditBand === "Below 600") {
      s["Merchant Cash Advance"] += 4;
    } else if (creditBand === "600 – 679") {
      s["Merchant Cash Advance"] += 2;
      s["Business Line of Credit"] += 2;
    } else if (creditBand === "680 – 739") {
      s["Business Line of Credit"] += 2;
      s["Term Funding"] += 2;
    } else if (creditBand === "740+") {
      s["SBA Program"] += 3;
      s["Term Funding"] += 2;
      s["Business Line of Credit"] += 1;
    }

    // Use of funds
    if (useOfFunds === "Equipment purchase") s["Equipment Financing"] += 4;
    else if (useOfFunds === "Expansion / new location") {
      s["Term Funding"] += 3;
      s["SBA Program"] += 2;
    } else if (useOfFunds === "Working capital / payroll" || useOfFunds === "Inventory") {
      s["Merchant Cash Advance"] += 2;
      s["Business Line of Credit"] += 2;
    } else if (useOfFunds === "Marketing") {
      s["Business Line of Credit"] += 2;
      s["Merchant Cash Advance"] += 1;
    } else if (useOfFunds === "Refinance / consolidate") {
      s["Term Funding"] += 2;
      s["Business Line of Credit"] += 1;
    }

    return (Object.keys(s) as ProductKey[])
      .map((key) => ({ key, score: s[key] }))
      .sort((a, b) => b.score - a.score);
  }

  const ranked = computeScores();
  const best = ranked[0];
  const runnersUp = ranked.slice(1, 3);

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
          use_of_funds: useOfFunds || "Working capital",
          lead_source: "assessment",
          lead_source_detail: `Funding Matcher — best fit: ${best.key}; ${usd(
            amount
          )}; ${speed || "—"}; credit ${creditBand || "—"}`,
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

  const canAdvance =
    (step === 0 && speed) ||
    step === 1 ||
    (step === 2 && collateral) ||
    (step === 3 && creditBand) ||
    (step === 4 && useOfFunds);

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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="What Funding Fits Your Business? — Free Matcher"
        description="Answer 5 quick questions and get matched to the business funding product that fits best — MCA, line of credit, term funding, equipment financing, or SBA. No credit impact."
        keywords="business funding matcher, what funding is right for my business, MCA vs line of credit, best business financing option"
      />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <PuzzlePieceIcon className="w-4 h-4" />
                Funding Matcher
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                What funding{" "}
                <span className="text-mint-green">fits your business?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Answer 5 quick questions and we'll match you to the funding product that fits best —
                from a merchant cash advance to a line of credit, term funding, equipment financing,
                or an SBA program. Free, no credit impact.
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
                  <h2 className="text-xl font-bold text-heading mb-5">How fast do you need it?</h2>
                  <div className="space-y-3">
                    {SPEED_OPTIONS.map((o) => (
                      <Choice key={o} label={o} selected={speed === o} onClick={() => setSpeed(o)} />
                    ))}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-heading">How much do you need?</h2>
                    <span className="text-mint-green font-bold tabular-nums">{usd(amount)}</span>
                  </div>
                  <input
                    type="range"
                    min={5000}
                    max={500000}
                    step={5000}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
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
                  <h2 className="text-xl font-bold text-heading mb-5">
                    Do you have collateral available?
                  </h2>
                  <div className="space-y-3">
                    {COLLATERAL_OPTIONS.map((o) => (
                      <Choice
                        key={o}
                        label={o}
                        selected={collateral === o}
                        onClick={() => setCollateral(o)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h2 className="text-xl font-bold text-heading mb-5">Estimated credit band</h2>
                  <div className="space-y-3">
                    {CREDIT_OPTIONS.map((o) => (
                      <Choice
                        key={o}
                        label={o}
                        selected={creditBand === o}
                        onClick={() => setCreditBand(o)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div>
                  <h2 className="text-xl font-bold text-heading mb-5">What's it for?</h2>
                  <div className="grid grid-cols-1 gap-3">
                    {USE_OPTIONS.map((o) => (
                      <Choice
                        key={o}
                        label={o}
                        selected={useOfFunds === o}
                        onClick={() => setUseOfFunds(o)}
                      />
                    ))}
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
                  disabled={!canAdvance}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {step === TOTAL_STEPS - 1 ? "See my match" : "Next"}
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
                  <h2 className="text-2xl font-bold text-heading">Your best-fit funding</h2>
                </div>

                {unlocked ? (
                  <>
                    <div className="rounded-xl bg-mint-green/10 p-6 mb-5 text-center">
                      <p className="text-sm text-text-secondary mb-1">Recommended product</p>
                      <p className="text-2xl font-bold text-mint-green">{best.key}</p>
                    </div>
                    <p className="text-body mb-6">{PRODUCT_BLURB[best.key]}</p>

                    <h3 className="font-bold text-heading mb-3">Also worth considering</h3>
                    <div className="space-y-3">
                      {runnersUp.map((r) => (
                        <div
                          key={r.key}
                          className="rounded-xl border border-gray-200 dark:border-gray-600 p-4"
                        >
                          <p className="font-semibold text-heading mb-1">{r.key}</p>
                          <p className="text-sm text-text-secondary">{PRODUCT_BLURB[r.key]}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl bg-mint-green/10 p-6 mb-4 text-center relative overflow-hidden">
                      <p className="text-sm text-text-secondary mb-1">Recommended product</p>
                      <p className="text-2xl font-bold text-mint-green blur-md select-none">
                        ●●●●●●●●●
                      </p>
                    </div>
                    <p className="text-center text-text-secondary text-sm">
                      We've matched your answers to a best-fit product plus two runner-ups. Enter your
                      info to reveal your recommendation →
                    </p>
                  </>
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
                        out within 24 hours to walk through your {best.key} match and your{" "}
                        {usd(amount)} request — no credit impact to explore options.
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      This match is an <strong>estimate only</strong>, not an offer, approval, or
                      guarantee. A merchant cash advance is a purchase of future receivables, not a
                      loan. Final products and terms depend on underwriting and funder review.
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
                      ↺ Start over
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
                      <h2 className="text-2xl font-bold text-heading">Reveal your match</h2>
                    </div>
                    <p className="text-text-secondary mb-6">
                      Enter your info to unlock your recommended funding product, why it fits, and two
                      runner-ups. Free, no obligation, no credit impact.
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
                        {submitting ? "Matching…" : "Reveal my match →"}
                      </button>
                      <p className="text-xs text-gray-400 text-center leading-relaxed">
                        <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                        No credit impact to check. Matches are estimates, not offers.
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
