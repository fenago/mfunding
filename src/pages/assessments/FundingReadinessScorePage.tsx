import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartBarIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import {
  AssessLayout,
  AssessHero,
  AssessBody,
  AssessCard,
  AssessProgress,
  AssessOption,
  AssessSlider,
  AssessNav,
  AssessVerdict,
  AssessNote,
  GateForm,
  usd,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

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
      ? { label: "Strong", color: "var(--go)" }
      : score >= 50
      ? { label: "Good", color: "var(--amber)" }
      : { label: "Building", color: "var(--as-danger)" };

  // Kit chip tone mapped from tier
  const chipTone = score >= 75 ? "is-go" : score >= 50 ? "is-amber" : "is-danger";

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

  // Can the user advance from the current step?
  const canAdvance =
    (step === 0 && tib) ||
    step === 1 ||
    step === 2 ||
    step === 3 ||
    (step === 4 && creditBand) ||
    (step === 5 && advances) ||
    (step === 6 && industry);

  // ── Radial gauge ───────────────────────────────────────────────────────────
  function Gauge({ value }: { value: number }) {
    const R = 56;
    const C = 2 * Math.PI * R;
    const pct = Math.max(0, Math.min(100, value)) / 100;
    return (
      <div className="relative w-40 h-40 mx-auto">
        <svg viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--hair)" strokeWidth="12" />
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
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            out of 100
          </span>
        </div>
      </div>
    );
  }

  return (
    <AssessLayout
      seo={
        <SEO
          title="Funding Readiness Score — Free Business Assessment"
          description="Answer 7 quick questions to see your free Funding Readiness Score and which working-capital products your business likely qualifies for. No credit impact."
          keywords="funding readiness score, business funding qualification, merchant cash advance eligibility, do I qualify for business funding"
        />
      }
    >
      <AssessHero
        badge="Funding Readiness Score"
        icon={<ChartBarIcon />}
        title={
          <>
            How fundable is your{" "}
            <span className="os-go">business right now?</span>
          </>
        }
        lede={
          <>
            Answer 7 quick questions to get your free Funding Readiness Score (0–100), see which
            working-capital products you likely qualify for, and an estimated funding range. No
            credit impact, no obligation.
          </>
        }
      />

      <AssessBody>
        {!finished ? (
          // ── Wizard ──────────────────────────────────────────────────────
          <div className="as-narrow">
            <AssessCard>
              <AssessProgress step={step} total={TOTAL_STEPS} />

              {step === 0 && (
                <div>
                  <h2 className="as-qtitle">How long in business?</h2>
                  {TIB_OPTIONS.map((o) => (
                    <AssessOption
                      key={o.label}
                      label={o.label}
                      selected={tib === o.label}
                      onClick={() => setTib(o.label)}
                    />
                  ))}
                </div>
              )}

              {step === 1 && (
                <AssessSlider
                  label="Average monthly revenue"
                  value={monthlyRevenue}
                  display={usd(monthlyRevenue)}
                  min={5000}
                  max={500000}
                  step={1000}
                  onChange={setMonthlyRevenue}
                  minLabel="$5K"
                  maxLabel="$500K+"
                />
              )}

              {step === 2 && (
                <AssessSlider
                  label="Average bank balance"
                  value={avgBalance}
                  display={usd(avgBalance)}
                  min={0}
                  max={200000}
                  step={500}
                  onChange={setAvgBalance}
                  minLabel="$0"
                  maxLabel="$200K+"
                  hint="Roughly what your account holds on a typical day."
                />
              )}

              {step === 3 && (
                <AssessSlider
                  label="Negative days / NSFs per month"
                  value={nsfs}
                  display={nsfs}
                  min={0}
                  max={30}
                  step={1}
                  onChange={setNsfs}
                  minLabel="0"
                  maxLabel="30+"
                  hint="How many times per month your account goes negative or bounces."
                />
              )}

              {step === 4 && (
                <div>
                  <h2 className="as-qtitle">Estimated credit band</h2>
                  {CREDIT_OPTIONS.map((o) => (
                    <AssessOption
                      key={o.label}
                      label={o.label}
                      selected={creditBand === o.label}
                      onClick={() => setCreditBand(o.label)}
                    />
                  ))}
                </div>
              )}

              {step === 5 && (
                <div>
                  <h2 className="as-qtitle">Existing advances / positions</h2>
                  {ADVANCE_OPTIONS.map((o) => (
                    <AssessOption
                      key={o.label}
                      label={o.label}
                      selected={advances === o.label}
                      onClick={() => setAdvances(o.label)}
                    />
                  ))}
                </div>
              )}

              {step === 6 && (
                <div>
                  <h2 className="as-qtitle">Industry</h2>
                  <div className="as-optgrid">
                    {INDUSTRY_OPTIONS.map((o) => (
                      <AssessOption
                        key={o}
                        label={o}
                        selected={industry === o}
                        onClick={() => setIndustry(o)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <AssessNav
                onBack={() => setStep((s) => Math.max(0, s - 1))}
                onNext={() => setStep((s) => s + 1)}
                backDisabled={step === 0}
                nextDisabled={!canAdvance}
                nextLabel={step === TOTAL_STEPS - 1 ? "See my score" : "Next"}
              />
            </AssessCard>
          </div>
        ) : (
          // ── Results: teaser gauge + gate ────────────────────────────────
          <div className="as-cols">
            {/* Teaser */}
            <AssessCard>
              <div className="as-card-head">
                <ChartBarIcon />
                <h2 className="as-card-title">Your Funding Readiness Score</h2>
              </div>

              <Gauge value={score} />

              <p style={{ textAlign: "center", marginTop: 16 }}>
                <span className={`as-chip ${chipTone}`}>{tier.label} readiness</span>
              </p>

              {unlocked ? (
                <>
                  <AssessVerdict tone="go">
                    <p className="as-verdict-cap">Estimated funding range</p>
                    <p className="as-verdict-big as-t-go">
                      {usd(low)} – {usd(high)}
                    </p>
                  </AssessVerdict>

                  <h3 className="as-card-title" style={{ fontSize: 16, margin: "22px 0 12px" }}>
                    Score breakdown
                  </h3>
                  <div style={{ marginBottom: 20 }}>
                    {breakdown.map((b) => (
                      <div key={b.label} style={{ marginBottom: 14 }}>
                        <div className="as-meter-row">
                          <span>{b.label}</span>
                          <span className="os-mono">
                            {Math.round(b.value)}/{b.max}
                          </span>
                        </div>
                        <div className="as-meter">
                          <div
                            className="as-meter-fill is-go"
                            style={{ width: `${(b.value / b.max) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <h3 className="as-card-title" style={{ fontSize: 16, margin: "0 0 8px" }}>
                    Products you likely qualify for
                  </h3>
                  {products.map((p) => (
                    <div key={p} className="as-checkrow">
                      <CheckCircleIcon />
                      {p}
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, marginTop: 16 }}>
                  Unlock your full breakdown, estimated funding range, and the products you qualify
                  for →
                </p>
              )}
            </AssessCard>

            {/* Gate */}
            <AssessCard>
              {unlocked ? (
                <>
                  <div className="as-success">
                    <CheckCircleIcon />
                    <p>
                      Thanks, {form.contact_first_name || "there"}! A funding specialist will reach
                      out within 24 hours with real options matched to your {score}/100 readiness
                      score — checking won't affect your credit.
                    </p>
                  </div>
                  <AssessNote>
                    This score and range are <strong>estimates only</strong>, not an offer,
                    approval, or guarantee. A merchant cash advance is a purchase of future
                    receivables, not a loan. Final amounts depend on underwriting and funder review.
                  </AssessNote>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep(0);
                        setUnlocked(false);
                        setForm(EMPTY_CONTACT);
                      }}
                      className="as-backlink"
                      style={{ background: "none", border: 0, cursor: "pointer" }}
                    >
                      ↺ Retake the assessment
                    </button>
                    <span className="as-sep">·</span>
                    <Link to="/" className="as-backlink">
                      Back to home
                    </Link>
                  </div>
                </>
              ) : (
                <GateForm
                  form={form}
                  onSet={set}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  error={error}
                  heading="Get your full report"
                  blurb="Enter your info to unlock your full score breakdown, estimated funding range, and the products you qualify for. Free, no obligation, no credit impact."
                  submitIdle="Get my full report"
                  submitBusy="Generating…"
                  footnote={
                    <>No credit impact to check. Estimates only — not an offer or guarantee.</>
                  }
                />
              )}
            </AssessCard>
          </div>
        )}
      </AssessBody>
    </AssessLayout>
  );
}
