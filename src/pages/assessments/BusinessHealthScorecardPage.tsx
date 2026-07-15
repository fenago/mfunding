import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardDocumentCheckIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
  BanknotesIcon,
  ScaleIcon,
  RocketLaunchIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";

// ── Categories ───────────────────────────────────────────────────────────────
type CategoryKey = "cashflow" | "debt" | "growth" | "margins";

const CATEGORIES: Record<
  CategoryKey,
  { label: string; icon: typeof BanknotesIcon }
> = {
  cashflow: { label: "Cash Flow", icon: BanknotesIcon },
  debt: { label: "Debt Load", icon: ScaleIcon },
  growth: { label: "Growth Readiness", icon: RocketLaunchIcon },
  margins: { label: "Margins & Profitability", icon: ChartBarIcon },
};

// Metadata an option can contribute toward lead routing/values.
interface OptionMeta {
  revenue?: number;
  positions?: number;
  balance?: number;
  debit?: number;
}
interface Option {
  label: string;
  points: number; // 0 (worst) – 100 (best)
  meta?: OptionMeta;
}
interface Question {
  category: CategoryKey;
  prompt: string;
  options: Option[];
}

const QUESTIONS: Question[] = [
  // ── Cash Flow ──
  {
    category: "cashflow",
    prompt: "What is your average monthly revenue?",
    options: [
      { label: "Under $15,000", points: 25, meta: { revenue: 10000 } },
      { label: "$15,000 – $40,000", points: 55, meta: { revenue: 27000 } },
      { label: "$40,000 – $100,000", points: 80, meta: { revenue: 70000 } },
      { label: "Over $100,000", points: 100, meta: { revenue: 150000 } },
    ],
  },
  {
    category: "cashflow",
    prompt: "How much cash reserve do you keep on hand?",
    options: [
      { label: "Almost none", points: 10 },
      { label: "Less than 1 month of expenses", points: 40 },
      { label: "1 – 3 months of expenses", points: 80 },
      { label: "More than 3 months", points: 100 },
    ],
  },
  {
    category: "cashflow",
    prompt: "How often do you struggle to cover payroll or bills?",
    options: [
      { label: "Most weeks", points: 5 },
      { label: "A few times a month", points: 35 },
      { label: "Occasionally", points: 70 },
      { label: "Almost never", points: 100 },
    ],
  },
  // ── Debt Load ──
  {
    category: "debt",
    prompt: "How many business advances / positions do you currently have?",
    options: [
      { label: "None", points: 100, meta: { positions: 0 } },
      { label: "1 advance", points: 70, meta: { positions: 1 } },
      { label: "2 advances", points: 35, meta: { positions: 2 } },
      { label: "3 or more (stacked)", points: 5, meta: { positions: 4 } },
    ],
  },
  {
    category: "debt",
    prompt: "What is the total balance owed across your advances?",
    options: [
      { label: "None", points: 100, meta: { balance: 0 } },
      { label: "Under $25,000", points: 70, meta: { balance: 20000 } },
      { label: "$25,000 – $100,000", points: 35, meta: { balance: 60000 } },
      { label: "Over $100,000", points: 5, meta: { balance: 150000 } },
    ],
  },
  {
    category: "debt",
    prompt: "How much do those advances debit from your account each day?",
    options: [
      { label: "Nothing — no advances", points: 100, meta: { debit: 0 } },
      { label: "Under $300/day", points: 70, meta: { debit: 200 } },
      { label: "$300 – $1,000/day", points: 35, meta: { debit: 650 } },
      { label: "Over $1,000/day", points: 5, meta: { debit: 1500 } },
    ],
  },
  // ── Growth Readiness ──
  {
    category: "growth",
    prompt: "How long have you been in business?",
    options: [
      { label: "Less than 6 months", points: 20 },
      { label: "6 – 12 months", points: 55 },
      { label: "1 – 3 years", points: 85 },
      { label: "3+ years", points: 100 },
    ],
  },
  {
    category: "growth",
    prompt: "Do you have a clear plan for how you'd use new capital?",
    options: [
      { label: "Not really", points: 25 },
      { label: "A rough idea", points: 60 },
      { label: "Yes — a specific growth opportunity", points: 100 },
    ],
  },
  // ── Margins & Profitability ──
  {
    category: "margins",
    prompt: "What is your approximate net profit margin?",
    options: [
      { label: "Losing money", points: 5 },
      { label: "Breaking even", points: 40 },
      { label: "5% – 15%", points: 80 },
      { label: "Over 15%", points: 100 },
    ],
  },
  {
    category: "margins",
    prompt: "How has revenue trended over the last 6 months?",
    options: [
      { label: "Declining", points: 20 },
      { label: "Flat", points: 60 },
      { label: "Growing steadily", points: 100 },
    ],
  },
];

// ── Grading helpers ──────────────────────────────────────────────────────────
function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
function gradeColor(grade: string): string {
  if (grade === "A" || grade === "B") return "text-mint-green";
  if (grade === "C") return "text-warning";
  return "text-error";
}
function gradeBg(grade: string): string {
  if (grade === "A" || grade === "B") return "bg-mint-green/10 border-mint-green/30";
  if (grade === "C") return "bg-warning/10 border-warning/30";
  return "bg-error/10 border-error/30";
}

const RECS: Record<CategoryKey, { good: string; poor: string }> = {
  cashflow: {
    good: "Your cash position is solid — a working-capital advance could accelerate growth without strain.",
    poor: "Cash is tight. Stabilizing reserves with flexible working capital can smooth out the gaps.",
  },
  debt: {
    good: "Low existing debt means you have room to take on new funding on favorable terms.",
    poor: "Existing advance debt is heavy. A debt-relief restructure could free up daily cash flow before adding anything new.",
  },
  growth: {
    good: "You're well-positioned to deploy capital into growth.",
    poor: "Focus on time-in-business milestones and a concrete capital plan to unlock better offers.",
  },
  margins: {
    good: "Healthy margins make your business attractive to funders.",
    poor: "Thin margins are a risk — improving profitability strengthens your funding options.",
  },
};

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

export default function BusinessHealthScorecardPage() {
  // answers[i] = selected option index for QUESTIONS[i]
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => QUESTIONS.map(() => null),
  );
  const [step, setStep] = useState(0); // 0..QUESTIONS.length-1 = questions, == length => results screen

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const onResults = step >= QUESTIONS.length;
  const allAnswered = answers.every((a) => a !== null);

  function choose(optIdx: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[step] = optIdx;
      return next;
    });
    // auto-advance
    setStep((s) => Math.min(s + 1, QUESTIONS.length));
  }

  // ── Compute category scores + overall ──────────────────────────────────────
  function categoryScore(cat: CategoryKey): number {
    const idxs = QUESTIONS.map((q, i) => ({ q, i })).filter((x) => x.q.category === cat);
    const vals = idxs
      .map(({ q, i }) => {
        const a = answers[i];
        return a === null ? null : q.options[a].points;
      })
      .filter((v): v is number => v !== null);
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  const catScores: Record<CategoryKey, number> = {
    cashflow: categoryScore("cashflow"),
    debt: categoryScore("debt"),
    growth: categoryScore("growth"),
    margins: categoryScore("margins"),
  };
  const overallScore = Math.round(
    (catScores.cashflow + catScores.debt + catScores.growth + catScores.margins) / 4,
  );
  const overallGrade = scoreToGrade(overallScore);
  const debtGrade = scoreToGrade(catScores.debt);

  // Distress when debt load is poor (grade D or F = score < 70).
  const isDistress = catScores.debt < 70;

  // Pull selected metadata for lead values.
  function collectMeta(): Required<OptionMeta> {
    const acc: Required<OptionMeta> = { revenue: 0, positions: 0, balance: 0, debit: 0 };
    answers.forEach((a, i) => {
      if (a === null) return;
      const m = QUESTIONS[i].options[a].meta;
      if (!m) return;
      if (m.revenue !== undefined) acc.revenue = m.revenue;
      if (m.positions !== undefined) acc.positions = m.positions;
      if (m.balance !== undefined) acc.balance = m.balance;
      if (m.debit !== undefined) acc.debit = m.debit;
    });
    return acc;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const meta = collectMeta();
      const summary = `Health Scorecard — overall ${overallGrade} (${overallScore}). Cash Flow ${scoreToGrade(
        catScores.cashflow,
      )}, Debt Load ${debtGrade}, Growth ${scoreToGrade(catScores.growth)}, Margins ${scoreToGrade(
        catScores.margins,
      )}.`;

      const fn = isDistress ? "vcf-intake" : "mca-intake";
      const body = isDistress
        ? {
            business_name: form.business_name,
            contact_first_name: form.contact_first_name,
            contact_last_name: form.contact_last_name,
            email: form.email,
            phone: form.phone,
            active_positions: String(meta.positions || 2),
            total_balance: String(meta.balance || 0),
            daily_debit: String(meta.debit || 0),
            current_funders: "",
            hardship_reason: summary,
          }
        : {
            business_name: form.business_name,
            contact_first_name: form.contact_first_name,
            contact_last_name: form.contact_last_name,
            email: form.email,
            phone: form.phone,
            amount_requested: Math.round(meta.revenue || 25000),
            use_of_funds: "Working capital",
            lead_source: "assessment",
            lead_source_detail: summary,
          };

      const { data, error } = await supabase.functions.invoke(fn, { body });
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

  const progress = onResults
    ? 100
    : Math.round((answers.filter((a) => a !== null).length / QUESTIONS.length) * 100);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="Business Financial Health Scorecard"
        description="Grade your business across cash flow, debt load, growth readiness, and margins. Free instant scorecard with tailored funding recommendations."
        keywords="business financial health scorecard, business health assessment, cash flow grade, business funding readiness"
      />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-14 lg:py-16">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <ClipboardDocumentCheckIcon className="w-4 h-4" />
                Business Health Assessment
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Your Business Financial{" "}
                <span className="text-mint-green">Health Scorecard</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Answer {QUESTIONS.length} quick questions to grade your business across cash flow,
                debt load, growth readiness, and margins — then get tailored recommendations. Free,
                no credit impact.
              </p>
            </div>
          </div>
        </section>

        <section className="container-max py-14">
          <div className="max-w-3xl mx-auto">
            {/* Progress bar */}
            <div className="mb-8">
              <div className="flex justify-between text-xs text-text-secondary mb-2">
                <span>
                  {onResults
                    ? "Complete"
                    : `Question ${step + 1} of ${QUESTIONS.length} · ${CATEGORIES[QUESTIONS[step].category].label}`}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-mint-green transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* ── Question steps ── */}
            {!onResults && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm animate-scale-in">
                <p className="text-sm font-semibold text-ocean-blue mb-2 inline-flex items-center gap-2">
                  {(() => {
                    const Icon = CATEGORIES[QUESTIONS[step].category].icon;
                    return <Icon className="w-4 h-4" />;
                  })()}
                  {CATEGORIES[QUESTIONS[step].category].label}
                </p>
                <h2 className="text-2xl font-bold text-heading mb-6">{QUESTIONS[step].prompt}</h2>
                <div className="space-y-3">
                  {QUESTIONS[step].options.map((opt, i) => {
                    const selected = answers[step] === i;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => choose(i)}
                        className={`w-full text-left px-5 py-4 rounded-xl border transition-all ${
                          selected
                            ? "border-mint-green bg-mint-green/10 ring-2 ring-mint-green"
                            : "border-gray-200 dark:border-gray-600 hover:border-ocean-blue hover:bg-ocean-blue/5"
                        }`}
                      >
                        <span className="text-body font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    className="mt-6 inline-flex items-center gap-1 text-sm text-ocean-blue hover:underline"
                  >
                    <ArrowLeftIcon className="w-4 h-4" /> Back
                  </button>
                )}
              </div>
            )}

            {/* ── Results: teaser + gate / unlocked ── */}
            {onResults && (
              <div className="space-y-6">
                {/* LIVE teaser — overall grade is always visible */}
                <div
                  className={`rounded-2xl border p-8 text-center ${gradeBg(overallGrade)} animate-scale-in`}
                >
                  <p className="text-sm text-text-secondary mb-1">Your overall health grade</p>
                  <p className={`text-7xl font-extrabold leading-none ${gradeColor(overallGrade)}`}>
                    {overallGrade}
                  </p>
                  <p className="text-sm text-text-secondary mt-2">Score: {overallScore} / 100</p>
                </div>

                {unlocked ? (
                  <>
                    {/* Full report card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                      <div className="flex items-center gap-2 mb-6">
                        <CheckCircleIcon className="w-6 h-6 text-mint-green" />
                        <h2 className="text-2xl font-bold text-heading">Your full report card</h2>
                      </div>

                      <div className="space-y-4">
                        {(Object.keys(CATEGORIES) as CategoryKey[]).map((cat) => {
                          const score = catScores[cat];
                          const grade = scoreToGrade(score);
                          const Icon = CATEGORIES[cat].icon;
                          const good = score >= 70;
                          return (
                            <div
                              key={cat}
                              className="rounded-xl border border-gray-200 dark:border-gray-700 p-4"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="inline-flex items-center gap-2 font-semibold text-heading">
                                  <Icon className="w-5 h-5 text-ocean-blue" />
                                  {CATEGORIES[cat].label}
                                </span>
                                <span className={`text-2xl font-extrabold ${gradeColor(grade)}`}>
                                  {grade}
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-2">
                                <div
                                  className={`h-full ${good ? "bg-mint-green" : score >= 60 ? "bg-warning" : "bg-error"}`}
                                  style={{ width: `${score}%` }}
                                />
                              </div>
                              <p className="text-sm text-body">
                                {good ? RECS[cat].good : RECS[cat].poor}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tailored next step */}
                      <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-5 mt-6 flex items-start gap-3">
                        <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                        <p className="text-sm text-body">
                          {isDistress ? (
                            <>
                              Thanks, {form.contact_first_name || "there"}! Your debt load graded{" "}
                              <strong>{debtGrade}</strong>. A debt-relief specialist will reach out
                              within 24 hours to review your positions and build a plan to lower your
                              daily payments before taking on anything new.
                            </>
                          ) : (
                            <>
                              Thanks, {form.contact_first_name || "there"}! Your business looks
                              well-positioned. A funding specialist will reach out within 24 hours
                              with working-capital options matched to your numbers — no credit impact
                              to check.
                            </>
                          )}
                        </p>
                      </div>

                      <p className="text-xs text-text-secondary leading-relaxed mt-5">
                        <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                        This scorecard is an <strong>estimate for educational purposes only</strong>
                        — not financial advice, an offer, an approval, or a guarantee. A merchant
                        cash advance is a purchase of future receivables, not a loan. Estimated debt-
                        relief outcomes vary and are never guaranteed.
                      </p>

                      <Link to="/tools" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                        ← Explore more free tools
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Locked breakdown preview */}
                    <div className="relative bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm overflow-hidden">
                      <div className="space-y-3 blur-sm select-none pointer-events-none" aria-hidden>
                        {(Object.keys(CATEGORIES) as CategoryKey[]).map((cat) => {
                          const Icon = CATEGORIES[cat].icon;
                          return (
                            <div
                              key={cat}
                              className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 p-4"
                            >
                              <span className="inline-flex items-center gap-2 font-semibold text-heading">
                                <Icon className="w-5 h-5 text-ocean-blue" />
                                {CATEGORIES[cat].label}
                              </span>
                              <span className="text-2xl font-extrabold text-gray-400">?</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-midnight-blue/80 text-white text-sm font-semibold">
                          <LockClosedIcon className="w-4 h-4" /> Full breakdown locked
                        </span>
                      </div>
                    </div>

                    {/* Gate form */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                        <h2 className="text-2xl font-bold text-heading">
                          Unlock your full report card
                        </h2>
                      </div>
                      <p className="text-text-secondary mb-6">
                        Get your grade in every category plus tailored recommendations. Free, no
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
                          disabled={submitting || !allAnswered}
                          className="w-full py-3 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 disabled:opacity-60"
                        >
                          {submitting ? "Generating…" : "Unlock my full report card →"}
                        </button>
                        <p className="text-xs text-gray-400 text-center leading-relaxed">
                          <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                          No credit impact. Educational estimate only — not an offer or guarantee.
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
