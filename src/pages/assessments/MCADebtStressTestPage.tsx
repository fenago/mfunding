import { useState } from "react";
import { Link } from "react-router-dom";
import {
  HeartIcon,
  CheckCircleIcon,
  ArrowTrendingDownIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
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
  AssessNav,
  AssessStat,
  AssessVerdict,
  AssessNote,
  GateForm,
  usd,
  pct,
  type ContactForm,
  EMPTY_CONTACT,
} from "../../components/landing/os/assess/AssessKit";

// Convert a per-period payment to an approximate monthly figure.
// ~21 business days / month for daily debits, ~4.33 weeks / month for weekly.
const toMonthly = (amount: number, freq: "daily" | "weekly") =>
  freq === "daily" ? amount * 21 : amount * 4.33;

type Danger = "Green" | "Yellow" | "Red";

const DANGER_META: Record<Danger, { label: string; tone: "go" | "amber" | "danger"; blurb: string }> = {
  Green: {
    label: "Manageable",
    tone: "go",
    blurb:
      "Your MCA payments are taking a relatively healthy share of revenue — but stacking can change that fast. It's still worth knowing your options.",
  },
  Yellow: {
    label: "Strained",
    tone: "amber",
    blurb:
      "Your advances are eating a meaningful chunk of your daily cash flow. Many businesses in this range benefit from restructuring before things tighten further.",
  },
  Red: {
    label: "Critical",
    tone: "danger",
    blurb:
      "Your MCA payments are consuming a dangerous share of revenue. This is the cash-flow squeeze that pushes owners to stack even more — relief options exist, and there's no judgment here.",
  },
};

const STEPS = ["Advances", "Balance", "Payment", "Revenue"] as const;

export default function MCADebtStressTestPage() {
  // Assessment inputs
  const [step, setStep] = useState(0);
  const [positions, setPositions] = useState(3);
  const [totalBalance, setTotalBalance] = useState(120000);
  const [payment, setPayment] = useState(1500);
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [monthlyRevenue, setMonthlyRevenue] = useState(60000);

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // ── Stress-test math ───────────────────────────────────────────────────────
  const currentMonthly = toMonthly(payment, frequency);
  const safeRevenue = Math.max(monthlyRevenue, 1);

  // Debit-to-revenue: share of monthly revenue going to MCA payments.
  const debitToRevenue = (currentMonthly / safeRevenue) * 100;
  // Debt-to-revenue: total balance vs. one month of revenue.
  const debtToRevenue = (totalBalance / safeRevenue) * 100;

  const danger: Danger =
    debitToRevenue < 20 ? "Green" : debitToRevenue < 35 ? "Yellow" : "Red";
  const meta = DANGER_META[danger];

  // Estimated restructured payment: 50%–75% lower than today.
  const newPaymentLow = currentMonthly * 0.25; // best case (75% reduction)
  const newPaymentHigh = currentMonthly * 0.5; // conservative (50% reduction)
  const monthlySavingsLow = currentMonthly - newPaymentHigh; // conservative
  const monthlySavingsHigh = currentMonthly - newPaymentLow; // best case

  // "Debt Freedom Date" — rough months-to-clear at current pace vs. restructured.
  // Current pace: balance divided by current monthly payment.
  const monthsNow = Math.max(1, Math.ceil(totalBalance / Math.max(currentMonthly, 1)));
  // Restructured pace uses the conservative (higher) new payment so the estimate is honest.
  const monthsNew = Math.max(1, Math.ceil(totalBalance / Math.max(newPaymentHigh, 1)));
  const fmtMonths = (m: number) =>
    m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`;

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
          total_balance: String(totalBalance),
          daily_debit: String(payment),
          current_funders: "",
          hardship_reason: `MCA Debt Stress Test — ${danger} (${meta.label}); ${pct(
            debitToRevenue
          )} of revenue to debits; est. savings ${usd(monthlySavingsLow)}-${usd(
            monthlySavingsHigh
          )}/mo`,
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

  return (
    <AssessLayout
      seo={
        <SEO
          title="MCA Debt Stress Test | Momentum Funding"
          description="Take the free MCA Debt Stress Test to see how much your merchant cash advances are straining your cash flow — and an estimated path to lower payments. No judgment, no upfront fees."
          keywords="MCA debt stress test, merchant cash advance cash flow, MCA debt relief, debt to revenue ratio, MCA restructuring"
        />
      }
    >
      <AssessHero
        badge="MCA Debt Stress Test"
        icon={<HeartIcon />}
        title={
          <>
            Is your MCA debt{" "}
            <span className="os-go">quietly crushing your cash flow?</span>
          </>
        }
        lede={
          <>
            Answer four quick questions to see your debt-to-revenue ratio and a danger level — then
            unlock an estimated restructured payment and your projected debt-freedom date.
            Judgment-free, confidential, and no upfront fees.
          </>
        }
      />

      <AssessBody>
        <div className="as-cols">
          {/* Steps / inputs */}
          <AssessCard>
            <AssessSteps steps={STEPS} current={step} />

            {/* Step 0 — positions */}
            {step === 0 && (
              <AssessSlider
                label="How many advances do you have?"
                value={positions}
                display={positions}
                min={1}
                max={10}
                step={1}
                onChange={setPositions}
                minLabel="1"
                maxLabel="10+"
                hint="Include every open MCA / position, even small ones."
              />
            )}

            {/* Step 1 — balance */}
            {step === 1 && (
              <AssessSlider
                label="What's your total balance owed?"
                value={totalBalance}
                display={usd(totalBalance)}
                min={10000}
                max={1000000}
                step={5000}
                onChange={setTotalBalance}
                minLabel="$10K"
                maxLabel="$1M"
                hint="The combined remaining payback across all positions."
              />
            )}

            {/* Step 2 — payment */}
            {step === 2 && (
              <div>
                <AssessSlider
                  label={`Combined ${frequency} payment`}
                  value={payment}
                  display={usd(payment)}
                  min={100}
                  max={frequency === "daily" ? 10000 : 30000}
                  step={50}
                  onChange={setPayment}
                  minLabel="$100"
                  maxLabel={frequency === "daily" ? "$10K/day" : "$30K/wk"}
                  hint="Total amount debited across all advances each period."
                />
                <p className="as-qlabel" style={{ marginTop: 22 }}>
                  Payment frequency
                </p>
                <div className="as-toggle">
                  {(["daily", "weekly"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={frequency === f ? "is-on" : ""}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3 — revenue */}
            {step === 3 && (
              <AssessSlider
                label="What's your monthly revenue?"
                value={monthlyRevenue}
                display={usd(monthlyRevenue)}
                min={5000}
                max={500000}
                step={5000}
                onChange={setMonthlyRevenue}
                minLabel="$5K"
                maxLabel="$500K"
                hint="Average gross monthly deposits / sales."
              />
            )}

            <AssessNav
              onBack={() => setStep((s) => Math.max(0, s - 1))}
              onNext={
                step < STEPS.length - 1
                  ? () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
                  : undefined
              }
              backDisabled={step === 0}
              nextHint="See your result →"
            />
          </AssessCard>

          {/* Result + gate */}
          <AssessCard>
            {/* LIVE teaser — always visible */}
            <div className="as-card-head">
              <ExclamationTriangleIcon />
              <h2 className="as-card-title">Your stress level</h2>
            </div>

            <AssessVerdict tone={meta.tone}>
              <span className={`as-chip is-${meta.tone}`}>
                {danger} · {meta.label}
              </span>
              <p className={`as-verdict-big as-t-${meta.tone}`}>{pct(debitToRevenue)}</p>
              <p className="as-verdict-sub">of monthly revenue going to MCA payments</p>
              <p className="as-verdict-blurb">{meta.blurb}</p>
            </AssessVerdict>

            <div className="as-statrow cols-2">
              <AssessStat value={pct(debtToRevenue)} label="Debt-to-revenue" />
              <AssessStat value={usd(currentMonthly)} label="Est. monthly to MCAs" />
            </div>

            {unlocked ? (
              <>
                <div className="as-card-head" style={{ marginTop: 8 }}>
                  <ArrowTrendingDownIcon />
                  <h2 className="as-card-title">Your estimated relief plan</h2>
                </div>

                <AssessVerdict tone="go">
                  <p className="as-verdict-cap">Estimated restructured monthly payment</p>
                  <p className="as-verdict-big as-t-go">
                    {usd(newPaymentLow)} – {usd(newPaymentHigh)}
                  </p>
                  <p className="as-verdict-sub">down from about {usd(currentMonthly)}/mo today</p>
                </AssessVerdict>

                <div className="as-statrow cols-2">
                  <AssessStat
                    value={`${usd(monthlySavingsLow)} – ${usd(monthlySavingsHigh)}`}
                    label="Est. monthly savings"
                  />
                  <AssessStat
                    value={fmtMonths(monthsNew)}
                    label={`Est. debt-freedom (vs. ${fmtMonths(monthsNow)})`}
                  />
                </div>

                <div
                  className="as-rowcard"
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}
                >
                  <CalendarDaysIcon
                    style={{ width: 22, height: 22, color: "var(--go-text)", flexShrink: 0 }}
                  />
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--lede)", margin: 0 }}>
                    At your current pace you'd be clear in roughly{" "}
                    <strong>{fmtMonths(monthsNow)}</strong>. Under an estimated restructuring plan, a
                    freer cash-flow target is around <strong>{fmtMonths(monthsNew)}</strong> — with
                    far smaller payments along the way.
                  </p>
                </div>

                <div className="as-success">
                  <CheckCircleIcon />
                  <p>
                    We've got it, {form.contact_first_name || "there"}. A debt-relief specialist will
                    reach out within 24 hours to review your {positions} position
                    {positions === 1 ? "" : "s"} and build a real plan — no pressure, no judgment.
                  </p>
                </div>

                <AssessNote>
                  These figures are <strong>estimates only</strong>, not an offer, approval, or a
                  guarantee of savings. Restructuring is not the same as a reverse-consolidation
                  advance, and not all businesses qualify. Actual results depend on your funders,
                  balances, and program eligibility. There are <strong>no upfront fees</strong>.
                </AssessNote>

                <Link to="/" className="as-backlink">
                  ← Back to home
                </Link>
              </>
            ) : (
              <GateForm
                form={form}
                onSet={set}
                onSubmit={handleSubmit}
                submitting={submitting}
                error={error}
                heading="Get your full plan"
                blurb="Enter your info to unlock your estimated restructured payment, monthly savings, and projected debt-freedom date. Free, confidential, no obligation."
                submitIdle="Get my full plan"
                submitBusy="Building your plan…"
                footnote="Free, confidential, no upfront fees. Results are estimates, not guarantees."
              />
            )}
          </AssessCard>
        </div>
      </AssessBody>
    </AssessLayout>
  );
}
