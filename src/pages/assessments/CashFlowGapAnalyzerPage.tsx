import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChartBarSquareIcon,
  LockClosedIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import {
  AssessLayout,
  AssessHero,
  AssessBody,
  AssessCard,
  AssessProgress,
  AssessSlider,
  AssessOption,
  AssessNav,
  AssessStat,
  AssessVerdict,
  AssessNote,
  GateForm,
  usd,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

  const progress = onResults ? 100 : Math.round(((step + 1) / 3) * 66);

  const canAdvance =
    step === 0 ? monthlyRevenue > 0 : step === 1 ? slowMonths.length > 0 : true;

  return (
    <AssessLayout
      seo={
        <SEO
          title="Cash Flow Gap Analyzer"
          description="Find out which months your business runs short, the estimated dollar gap, and the working-capital buffer you need. Free instant cash flow analyzer."
          keywords="cash flow gap analyzer, seasonal cash flow, working capital buffer calculator, business cash flow shortfall"
        />
      }
    >
      <AssessHero
        badge="Cash Flow Assessment"
        icon={<ChartBarSquareIcon />}
        title={
          <>
            Cash Flow <span className="os-go">Gap Analyzer</span>
          </>
        }
        lede={
          <>
            Seasonal slow-downs draining your account? Tell us about your revenue and slow months to
            see exactly when you'll run short, how big the gap is, and the working-capital buffer to
            cover it. <strong>Free, no credit impact.</strong>
          </>
        }
      />

      <AssessBody>
        {!onResults ? (
          <div className="as-narrow">
            <AssessCard>
              <AssessProgress
                step={step}
                total={3}
                label={`STEP ${step + 1} / 3`}
                percentOverride={progress}
              />

              {step === 0 && (
                <AssessSlider
                  label="Average month (your good months)"
                  value={monthlyRevenue}
                  display={usd(monthlyRevenue)}
                  min={5000}
                  max={500000}
                  step={2500}
                  onChange={setMonthlyRevenue}
                  minLabel="$5K"
                  maxLabel="$500K"
                />
              )}

              {step === 1 && (
                <>
                  <h2 className="as-qtitle">Which months are slow for you?</h2>
                  <p className="as-hint">Tap all the months revenue dips.</p>
                  <div className="as-monthgrid">
                    {MONTHS.map((m, i) => (
                      <AssessOption
                        key={m}
                        label={m}
                        selected={slowMonths.includes(i)}
                        onClick={() => toggleMonth(i)}
                      />
                    ))}
                  </div>
                  {slowMonths.length === 0 && (
                    <p className="as-hint" style={{ margin: "14px 0 0" }}>
                      Select at least one slow month to continue.
                    </p>
                  )}
                </>
              )}

              {step === 2 && (
                <AssessSlider
                  label="Revenue drop in slow months"
                  value={dropPct}
                  display={`${dropPct}%`}
                  min={10}
                  max={90}
                  step={5}
                  onChange={setDropPct}
                  minLabel="10%"
                  maxLabel="90%"
                  hint={
                    <>
                      A {dropPct}% drop means a slow month brings in about{" "}
                      <strong>{usd(slowRevenue)}</strong> instead of {usd(monthlyRevenue)}.
                    </>
                  }
                />
              )}

              <AssessNav
                onBack={() => setStep((s) => Math.max(0, s - 1))}
                onNext={() => setStep((s) => s + 1)}
                backDisabled={step === 0}
                nextDisabled={!canAdvance}
                nextLabel={step === 2 ? "See my results" : "Next"}
              />
            </AssessCard>
          </div>
        ) : (
          <div className="as-narrow">
            <div className="as-stack">
              {/* LIVE teaser — months + gap headline visible */}
              <AssessVerdict tone="info">
                <p className="as-verdict-cap">Months you'll likely run short</p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "center",
                    margin: "0 0 16px",
                  }}
                >
                  {shortMonthNames.length > 0 ? (
                    shortMonthNames.map((m) => (
                      <span key={m} className="as-chip is-danger" style={{ marginBottom: 0 }}>
                        {m}
                      </span>
                    ))
                  ) : (
                    <span className="as-verdict-sub" style={{ margin: 0 }}>
                      No slow months selected.
                    </span>
                  )}
                </div>
                <p className="as-verdict-cap">Estimated total annual gap</p>
                <p className="as-verdict-big as-t-danger">{usd(totalGap)}</p>
                <p className="as-verdict-sub">
                  about {usd(monthlyGap)} short in each of {slowMonths.length} slow month
                  {slowMonths.length === 1 ? "" : "s"}
                </p>
              </AssessVerdict>

              {unlocked ? (
                <AssessCard>
                  <div className="as-card-head">
                    <CheckCircleIcon />
                    <h2 className="as-card-title">Your full cash-flow analysis</h2>
                  </div>

                  <AssessVerdict tone="go">
                    <p className="as-verdict-cap">Recommended working-capital buffer</p>
                    <p className="as-verdict-big as-t-go">{usd(recommendedBuffer)}</p>
                    <p className="as-verdict-sub">
                      covers your {usd(totalGap)} gap plus a ~20% safety margin
                    </p>
                  </AssessVerdict>

                  <div className="as-statrow cols-3">
                    <AssessStat value={usd(monthlyGap)} label="Gap per slow month" />
                    <AssessStat value={slowMonths.length} label="Slow months / yr" />
                    <AssessStat value={usd(totalGap)} label="Total annual gap" />
                  </div>

                  <div className="as-success">
                    <CheckCircleIcon />
                    <p>
                      Thanks, {form.contact_first_name || "there"}! A funding specialist will reach
                      out within 24 hours with flexible working-capital options sized to bridge your{" "}
                      {shortMonthNames.join(", ") || "slow-season"} gap — no credit impact to check.
                    </p>
                  </div>

                  <AssessNote>
                    These figures are <strong>estimates for planning purposes only</strong>, not an
                    offer, approval, or guarantee. A merchant cash advance is a purchase of future
                    receivables, not a loan. Actual buffer needs depend on your real expenses and
                    underwriting.
                  </AssessNote>

                  <div>
                    <Link to="/tools" className="as-backlink">
                      ← Explore more free tools
                    </Link>
                  </div>
                </AssessCard>
              ) : (
                <>
                  {/* Locked preview */}
                  <AssessCard>
                    <AssessVerdict tone="go" className="as-locked">
                      <p className="as-verdict-cap">Recommended working-capital buffer</p>
                      <p className="as-verdict-big as-t-go as-blur">{usd(recommendedBuffer)}</p>
                      <div className="as-lockchip">
                        <span>
                          <LockClosedIcon /> Recommended buffer locked
                        </span>
                      </div>
                    </AssessVerdict>
                  </AssessCard>

                  {/* Gate */}
                  <AssessCard>
                    <GateForm
                      form={form}
                      onSet={set}
                      onSubmit={handleSubmit}
                      submitting={submitting}
                      error={error}
                      heading="Unlock your full analysis"
                      blurb="See your recommended buffer and the full month-by-month breakdown. Free, no obligation, and checking won't affect your credit."
                      submitIdle="Unlock my full analysis"
                      submitBusy="Analyzing…"
                      footnote={
                        <>No credit impact. Estimates only — not an offer or guarantee.</>
                      }
                    />
                  </AssessCard>
                </>
              )}
            </div>
          </div>
        )}
      </AssessBody>
    </AssessLayout>
  );
}
