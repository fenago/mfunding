import { useState } from "react";
import { Link } from "react-router-dom";
import { PuzzlePieceIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
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

  const canAdvance =
    (step === 0 && speed) ||
    step === 1 ||
    (step === 2 && collateral) ||
    (step === 3 && creditBand) ||
    (step === 4 && useOfFunds);

  return (
    <AssessLayout
      seo={
        <SEO
          title="What Funding Fits Your Business? — Free Matcher"
          description="Answer 5 quick questions and get matched to the business funding product that fits best — MCA, line of credit, term funding, equipment financing, or SBA. No credit impact."
          keywords="business funding matcher, what funding is right for my business, MCA vs line of credit, best business financing option"
        />
      }
    >
      <AssessHero
        badge="Funding Matcher"
        icon={<PuzzlePieceIcon />}
        title={
          <>
            What funding <span className="os-go">fits your business?</span>
          </>
        }
        lede={
          <>
            Answer 5 quick questions and we'll match you to the funding product that fits best — from
            a merchant cash advance to a line of credit, term funding, equipment financing, or an SBA
            program. <strong>Free, no credit impact.</strong>
          </>
        }
      />

      <AssessBody>
        {!finished ? (
          <div className="as-narrow">
            <AssessCard>
              <AssessProgress step={step} total={TOTAL_STEPS} />

              {step === 0 && (
                <div>
                  <h2 className="as-qtitle">How fast do you need it?</h2>
                  {SPEED_OPTIONS.map((o) => (
                    <AssessOption
                      key={o}
                      label={o}
                      selected={speed === o}
                      onClick={() => setSpeed(o)}
                    />
                  ))}
                </div>
              )}

              {step === 1 && (
                <AssessSlider
                  label="How much do you need?"
                  value={amount}
                  display={usd(amount)}
                  min={5000}
                  max={500000}
                  step={5000}
                  onChange={setAmount}
                  minLabel="$5K"
                  maxLabel="$500K+"
                />
              )}

              {step === 2 && (
                <div>
                  <h2 className="as-qtitle">Do you have collateral available?</h2>
                  {COLLATERAL_OPTIONS.map((o) => (
                    <AssessOption
                      key={o}
                      label={o}
                      selected={collateral === o}
                      onClick={() => setCollateral(o)}
                    />
                  ))}
                </div>
              )}

              {step === 3 && (
                <div>
                  <h2 className="as-qtitle">Estimated credit band</h2>
                  {CREDIT_OPTIONS.map((o) => (
                    <AssessOption
                      key={o}
                      label={o}
                      selected={creditBand === o}
                      onClick={() => setCreditBand(o)}
                    />
                  ))}
                </div>
              )}

              {step === 4 && (
                <div>
                  <h2 className="as-qtitle">What's it for?</h2>
                  {USE_OPTIONS.map((o) => (
                    <AssessOption
                      key={o}
                      label={o}
                      selected={useOfFunds === o}
                      onClick={() => setUseOfFunds(o)}
                    />
                  ))}
                </div>
              )}

              <AssessNav
                onBack={() => setStep((s) => Math.max(0, s - 1))}
                onNext={() => setStep((s) => s + 1)}
                backDisabled={step === 0}
                nextDisabled={!canAdvance}
                nextLabel={step === TOTAL_STEPS - 1 ? "See my match" : "Next"}
              />
            </AssessCard>
          </div>
        ) : (
          <div className="as-cols">
            {/* Teaser / result */}
            <AssessCard>
              <div className="as-card-head">
                <PuzzlePieceIcon />
                <h2 className="as-card-title">Your best-fit funding</h2>
              </div>

              {unlocked ? (
                <>
                  <AssessVerdict tone="go">
                    <p className="as-verdict-cap">Recommended product</p>
                    <p className="as-verdict-big as-t-go">{best.key}</p>
                  </AssessVerdict>

                  <p className="as-hint" style={{ marginTop: 16 }}>
                    {PRODUCT_BLURB[best.key]}
                  </p>

                  <h3 className="as-card-title" style={{ fontSize: 16, margin: "18px 0 12px" }}>
                    Also worth considering
                  </h3>
                  <div className="as-stack">
                    {runnersUp.map((r) => (
                      <div key={r.key} className="as-rowcard">
                        <p className="as-slider-label" style={{ marginBottom: 6 }}>
                          {r.key}
                        </p>
                        <p className="as-hint" style={{ margin: 0 }}>
                          {PRODUCT_BLURB[r.key]}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <AssessVerdict tone="go" className="as-locked">
                    <p className="as-verdict-cap">Recommended product</p>
                    <p className="as-verdict-big as-t-go as-blur">Best-Fit Funding</p>
                  </AssessVerdict>
                  <p className="as-hint" style={{ marginTop: 14, textAlign: "center" }}>
                    We've matched your answers to a best-fit product plus two runner-ups. Enter your
                    info to reveal your recommendation →
                  </p>
                </>
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
                      out within 24 hours to walk through your {best.key} match and your{" "}
                      {usd(amount)} request — no credit impact to explore options.
                    </p>
                  </div>
                  <AssessNote>
                    This match is an <strong>estimate only</strong>, not an offer, approval, or
                    guarantee. A merchant cash advance is a purchase of future receivables, not a
                    loan. Final products and terms depend on underwriting and funder review.
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
                      ↺ Start over
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
                  heading="Reveal your match"
                  blurb="Enter your info to unlock your recommended funding product, why it fits, and two runner-ups. Free, no obligation, no credit impact."
                  submitIdle="Reveal my match"
                  submitBusy="Matching…"
                  footnote={<>No credit impact to check. Matches are estimates, not offers.</>}
                />
              )}
            </AssessCard>
          </div>
        )}
      </AssessBody>
    </AssessLayout>
  );
}
