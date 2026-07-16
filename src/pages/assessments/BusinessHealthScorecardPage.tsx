import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardDocumentCheckIcon,
  LockClosedIcon,
  CheckCircleIcon,
  BanknotesIcon,
  ScaleIcon,
  RocketLaunchIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import {
  AssessLayout,
  AssessHero,
  AssessBody,
  AssessCard,
  AssessProgress,
  AssessOption,
  AssessVerdict,
  AssessNote,
  GateForm,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

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
/** Grade → OS tone name for AssessVerdict. */
function gradeTone(grade: string): "go" | "amber" | "danger" {
  if (grade === "A" || grade === "B") return "go";
  if (grade === "C") return "amber";
  return "danger";
}
/** Grade → OS text-color class. */
function gradeTextClass(grade: string): string {
  if (grade === "A" || grade === "B") return "as-t-go";
  if (grade === "C") return "as-t-amber";
  return "as-t-danger";
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

  const progress = onResults
    ? 100
    : Math.round((answers.filter((a) => a !== null).length / QUESTIONS.length) * 100);

  return (
    <AssessLayout
      seo={
        <SEO
          title="Business Financial Health Scorecard"
          description="Grade your business across cash flow, debt load, growth readiness, and margins. Free instant scorecard with tailored funding recommendations."
          keywords="business financial health scorecard, business health assessment, cash flow grade, business funding readiness"
        />
      }
    >
      <AssessHero
        badge="Business Health Assessment"
        icon={<ClipboardDocumentCheckIcon />}
        title={
          <>
            Your Business Financial{" "}
            <span className="os-go">Health Scorecard</span>
          </>
        }
        lede={
          <>
            Answer {QUESTIONS.length} quick questions to grade your business across cash flow, debt
            load, growth readiness, and margins — then get tailored recommendations.{" "}
            <strong>Free, no credit impact.</strong>
          </>
        }
      />

      <AssessBody>
        <div className="as-narrow">
          {/* ── Question steps ── */}
          {!onResults && (
            <AssessCard>
              <AssessProgress
                step={step}
                total={QUESTIONS.length}
                percentOverride={progress}
                label={`Question ${step + 1} of ${QUESTIONS.length} · ${CATEGORIES[QUESTIONS[step].category].label}`}
              />

              <p className="as-qlabel">
                {(() => {
                  const Icon = CATEGORIES[QUESTIONS[step].category].icon;
                  return <Icon />;
                })()}
                {CATEGORIES[QUESTIONS[step].category].label}
              </p>
              <h2 className="as-qtitle">{QUESTIONS[step].prompt}</h2>

              {QUESTIONS[step].options.map((opt, i) => (
                <AssessOption
                  key={opt.label}
                  label={opt.label}
                  selected={answers[step] === i}
                  onClick={() => choose(i)}
                />
              ))}

              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  className="as-back"
                  style={{ marginTop: 20 }}
                >
                  <span aria-hidden>←</span> Back
                </button>
              )}
            </AssessCard>
          )}

          {/* ── Results: teaser + gate / unlocked ── */}
          {onResults && (
            <div className="as-stack">
              {/* LIVE teaser — overall grade is always visible */}
              <AssessVerdict tone={gradeTone(overallGrade)}>
                <p className="as-verdict-cap">Your overall health grade</p>
                <p className={`as-grade ${gradeTextClass(overallGrade)}`}>{overallGrade}</p>
                <p className="as-verdict-sub">Score: {overallScore} / 100</p>
              </AssessVerdict>

              {unlocked ? (
                <AssessCard>
                  <div className="as-card-head">
                    <CheckCircleIcon />
                    <h2 className="as-card-title">Your full report card</h2>
                  </div>

                  <div className="as-stack">
                    {(Object.keys(CATEGORIES) as CategoryKey[]).map((cat) => {
                      const score = catScores[cat];
                      const grade = scoreToGrade(score);
                      const Icon = CATEGORIES[cat].icon;
                      const good = score >= 70;
                      const fill = good ? "is-go" : score >= 60 ? "is-amber" : "is-danger";
                      return (
                        <div key={cat} className="as-rowcard">
                          <div className="as-meter-row">
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                color: "var(--tx)",
                                fontWeight: 600,
                              }}
                            >
                              <Icon style={{ width: 18, height: 18, color: "var(--go-text)" }} />
                              {CATEGORIES[cat].label}
                            </span>
                            <span
                              className={gradeTextClass(grade)}
                              style={{ fontFamily: "'Anton',sans-serif", fontSize: 24, lineHeight: 1 }}
                            >
                              {grade}
                            </span>
                          </div>
                          <div className="as-meter" style={{ marginBottom: 10 }}>
                            <div className={`as-meter-fill ${fill}`} style={{ width: `${score}%` }} />
                          </div>
                          <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--lede)", margin: 0 }}>
                            {good ? RECS[cat].good : RECS[cat].poor}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tailored next step */}
                  <div className="as-success" style={{ marginTop: 22 }}>
                    <CheckCircleIcon />
                    <p>
                      {isDistress ? (
                        <>
                          Thanks, {form.contact_first_name || "there"}! Your debt load graded{" "}
                          <strong>{debtGrade}</strong>. A debt-relief specialist will reach out within
                          24 hours to review your positions and build a plan to lower your daily
                          payments before taking on anything new.
                        </>
                      ) : (
                        <>
                          Thanks, {form.contact_first_name || "there"}! Your business looks
                          well-positioned. A funding specialist will reach out within 24 hours with
                          working-capital options matched to your numbers — no credit impact to check.
                        </>
                      )}
                    </p>
                  </div>

                  <AssessNote>
                    This scorecard is an <strong>estimate for educational purposes only</strong> — not
                    financial advice, an offer, an approval, or a guarantee. A merchant cash advance is
                    a purchase of future receivables, not a loan. Estimated debt-relief outcomes vary
                    and are never guaranteed.
                  </AssessNote>

                  <div>
                    <Link to="/tools" className="as-backlink">
                      ← Explore more free tools
                    </Link>
                  </div>
                </AssessCard>
              ) : (
                <>
                  {/* Locked breakdown preview */}
                  <AssessCard className="as-locked">
                    <div className="as-blur as-stack" aria-hidden>
                      {(Object.keys(CATEGORIES) as CategoryKey[]).map((cat) => {
                        const Icon = CATEGORIES[cat].icon;
                        return (
                          <div key={cat} className="as-rowcard">
                            <div className="as-meter-row" style={{ marginBottom: 0 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  color: "var(--tx)",
                                  fontWeight: 600,
                                }}
                              >
                                <Icon style={{ width: 18, height: 18, color: "var(--go-text)" }} />
                                {CATEGORIES[cat].label}
                              </span>
                              <span
                                style={{
                                  fontFamily: "'Anton',sans-serif",
                                  fontSize: 24,
                                  lineHeight: 1,
                                  color: "var(--faint)",
                                }}
                              >
                                ?
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="as-lockchip">
                      <span>
                        <LockClosedIcon /> Full breakdown locked
                      </span>
                    </div>
                  </AssessCard>

                  {/* Gate form */}
                  <AssessCard>
                    <GateForm
                      form={form}
                      onSet={set}
                      onSubmit={handleSubmit}
                      submitting={submitting}
                      error={error}
                      heading="Unlock your full report card"
                      blurb="Get your grade in every category plus tailored recommendations. Free, no obligation, and checking won't affect your credit."
                      submitIdle="Unlock my full report card"
                      submitBusy="Generating…"
                      footnote={
                        <>No credit impact. Educational estimate only — not an offer or guarantee.</>
                      }
                      disabled={!allAnswered}
                    />
                  </AssessCard>
                </>
              )}
            </div>
          )}
        </div>
      </AssessBody>
    </AssessLayout>
  );
}
