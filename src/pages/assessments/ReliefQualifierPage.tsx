import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardDocumentCheckIcon,
  CheckCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import {
  AssessLayout,
  AssessHero,
  AssessBody,
  AssessCard,
  AssessSteps,
  AssessSlider,
  AssessOption,
  AssessNav,
  AssessVerdict,
  AssessNote,
  GateForm,
  usd,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

type Tier = "likely" | "may" | "talk";

const TIER_META: Record<Tier, { headline: string; tone: "go" | "amber" | "info"; blurb: string }> = {
  likely: {
    headline: "You likely qualify",
    tone: "go",
    blurb:
      "Based on what you shared, your situation lines up well with the businesses our debt-relief partner helps every day. The next step is a no-pressure conversation to confirm the details.",
  },
  may: {
    headline: "You may qualify",
    tone: "amber",
    blurb:
      "You're close. A quick review of your positions and revenue will tell us which path fits — and whether a small change in approach opens up more options.",
  },
  talk: {
    headline: "Let's talk it through",
    tone: "info",
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

  // Whether the current step has enough info to advance.
  const canAdvance =
    (step === 0 && true) ||
    (step === 1 && true) ||
    (step === 2 && hardship !== null) ||
    (step === 3 && timeInBiz !== null) ||
    (step === 4 && decisionMaker !== null);

  return (
    <AssessLayout
      seo={
        <SEO
          title="Do You Qualify for MCA Relief? | Momentum Funding"
          description="Find out in under a minute whether you qualify for merchant cash advance debt relief — restructuring or an FDIC-bank refinance. Free, confidential, no upfront fees."
          keywords="MCA relief qualification, do I qualify MCA debt relief, merchant cash advance restructuring, FDIC bank refinance, business debt relief"
        />
      }
    >
      <AssessHero
        badge="Relief Qualifier"
        icon={<ClipboardDocumentCheckIcon />}
        title={
          <>
            Do you qualify for <span className="os-go">MCA debt relief?</span>
          </>
        }
        lede={
          <>
            Five quick questions tell you whether you likely qualify, the recommended path, and
            exactly what happens next. No judgment, no obligation, and no upfront fees — just a clear
            read on your options.
          </>
        }
      />

      <AssessBody>
        <div className="as-cols">
          {/* Steps / inputs */}
          <AssessCard>
            <AssessSteps steps={STEPS} current={step} />
            <p
              className="os-mono"
              style={{
                fontSize: 12,
                letterSpacing: ".08em",
                color: "var(--muted)",
                margin: "0 0 18px",
              }}
            >
              STEP {step + 1} / {STEPS.length} · {STEPS[step]}
            </p>

            {/* Step 0 — total debt */}
            {step === 0 && (
              <div>
                <h2 className="as-qtitle">How much total business debt do you have?</h2>
                <p className="as-hint">
                  Combined MCAs, advances, and business loans. Most programs start around $50k.
                </p>
                <AssessSlider
                  label="Total business debt"
                  value={totalDebt}
                  display={usd(totalDebt)}
                  min={10000}
                  max={1000000}
                  step={5000}
                  onChange={setTotalDebt}
                  minLabel="$10K"
                  maxLabel="$1M"
                />
                <p className={`as-hint ${meetsDebtFloor ? "as-t-go" : ""}`} style={{ marginTop: 14 }}>
                  {meetsDebtFloor
                    ? "✓ Above the typical $50k program threshold."
                    : "Below the typical $50k threshold — we can still talk through options."}
                </p>
              </div>
            )}

            {/* Step 1 — positions */}
            {step === 1 && (
              <div>
                <h2 className="as-qtitle">How many stacked positions do you have?</h2>
                <p className="as-hint">Count every open advance, even the small ones.</p>
                <AssessSlider
                  label="Stacked positions"
                  value={positions}
                  display={positions}
                  min={1}
                  max={10}
                  step={1}
                  onChange={setPositions}
                  minLabel="1"
                  maxLabel="10+"
                />
              </div>
            )}

            {/* Step 2 — hardship */}
            {step === 2 && (
              <div>
                <h2 className="as-qtitle">Are you experiencing financial hardship?</h2>
                <p className="as-hint">
                  Struggling to make daily payments, falling behind, or cash flow drying up? There's
                  no judgment here — it just helps us point you to the right path.
                </p>
                <div className="as-optgrid">
                  <AssessOption
                    label="Yes, it's tight"
                    selected={hardship === true}
                    onClick={() => setHardship(true)}
                  />
                  <AssessOption
                    label="No, just want options"
                    selected={hardship === false}
                    onClick={() => setHardship(false)}
                  />
                </div>
              </div>
            )}

            {/* Step 3 — time in business */}
            {step === 3 && (
              <div>
                <h2 className="as-qtitle">How long have you been in business?</h2>
                <p className="as-hint">Time in business affects which programs you're eligible for.</p>
                <div className="as-optgrid">
                  {([
                    ["<6mo", "Under 6 months"],
                    ["6-12mo", "6–12 months"],
                    ["1-2yr", "1–2 years"],
                    ["2yr+", "2+ years"],
                  ] as const).map(([val, label]) => (
                    <AssessOption
                      key={val}
                      label={label}
                      selected={timeInBiz === val}
                      onClick={() => setTimeInBiz(val)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Step 4 — decision maker */}
            {step === 4 && (
              <div>
                <h2 className="as-qtitle">Are you the decision maker?</h2>
                <p className="as-hint">Can you make financial decisions for the business?</p>
                <div className="as-optgrid">
                  <AssessOption
                    label="Yes"
                    selected={decisionMaker === true}
                    onClick={() => setDecisionMaker(true)}
                  />
                  <AssessOption
                    label="No / shared"
                    selected={decisionMaker === false}
                    onClick={() => setDecisionMaker(false)}
                  />
                </div>
              </div>
            )}

            <AssessNav
              onBack={() => setStep((s) => Math.max(0, s - 1))}
              onNext={
                step < STEPS.length - 1
                  ? () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
                  : undefined
              }
              backDisabled={step === 0}
              nextDisabled={!canAdvance}
              nextHint="See your result →"
            />
          </AssessCard>

          {/* Result + gate */}
          <AssessCard>
            {/* LIVE teaser — always visible */}
            <div className="as-card-head">
              <SparklesIcon />
              <h2 className="as-card-title">Your result</h2>
            </div>

            <AssessVerdict tone={meta.tone}>
              <span className={`as-chip is-${meta.tone}`}>{meta.headline}</span>
              <p className="as-verdict-blurb">{meta.blurb}</p>
            </AssessVerdict>

            {unlocked ? (
              <>
                <div className="as-rowcard" style={{ marginTop: 16 }}>
                  <p className="as-verdict-cap" style={{ textAlign: "left" }}>
                    Recommended path
                  </p>
                  <p
                    className="as-t-go"
                    style={{ fontSize: 20, fontWeight: 700, margin: "2px 0 0", letterSpacing: "-.01em" }}
                  >
                    {pathTitle}
                  </p>
                  <p className="as-verdict-blurb" style={{ textAlign: "left", marginTop: 8 }}>
                    {pathBlurb}
                  </p>
                </div>

                <div className="as-rowcard" style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", margin: "0 0 12px" }}>
                    What happens next
                  </p>
                  <ol
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {[
                      "A debt-relief specialist calls you within 24 hours — confidential and judgment-free.",
                      "They review your positions, balances, and cash flow to confirm eligibility.",
                      "You get a clear, written plan with estimated payments before deciding anything.",
                      "If it's a fit, your specialist guides the setup. If not, you owe nothing.",
                    ].map((t, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          fontSize: 14,
                          lineHeight: 1.5,
                          color: "var(--lede)",
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: "rgba(22,217,146,.14)",
                            color: "var(--go-text)",
                            fontWeight: 700,
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {i + 1}
                        </span>
                        {t}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="as-success" style={{ marginTop: 16 }}>
                  <CheckCircleIcon />
                  <p>
                    You're all set, {form.contact_first_name || "there"}. Watch for a call from your
                    relief specialist within 24 hours.
                  </p>
                </div>

                <AssessNote>
                  This is an <strong>estimated eligibility indication</strong>, not an offer,
                  approval, or guarantee of relief or savings. Restructuring and an FDIC-bank
                  refinance are different programs, and restructuring is not the same as a
                  reverse-consolidation advance. Final eligibility is confirmed during your call.
                  There are <strong>no upfront fees</strong>.
                </AssessNote>

                <div>
                  <Link to="/" className="as-backlink">
                    ← Back to home
                  </Link>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 16 }}>
                <GateForm
                  form={form}
                  onSet={set}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  error={error}
                  heading="Get your full result"
                  blurb="Enter your info to unlock your recommended path and exactly what happens next. Free, confidential, no obligation."
                  submitIdle="Get my full result"
                  submitBusy="Checking…"
                  footnote={
                    <>Free, confidential, no upfront fees. Eligibility is estimated, not guaranteed.</>
                  }
                />
              </div>
            )}
          </AssessCard>
        </div>
      </AssessBody>
    </AssessLayout>
  );
}
