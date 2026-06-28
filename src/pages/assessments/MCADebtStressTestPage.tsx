import { useState } from "react";
import { Link } from "react-router-dom";
import {
  HeartIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ArrowTrendingDownIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";

// ── Money helpers ──────────────────────────────────────────────────────────
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const pct = (n: number) => `${Math.round(n)}%`;

// Convert a per-period payment to an approximate monthly figure.
// ~21 business days / month for daily debits, ~4.33 weeks / month for weekly.
const toMonthly = (amount: number, freq: "daily" | "weekly") =>
  freq === "daily" ? amount * 21 : amount * 4.33;

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

type Danger = "Green" | "Yellow" | "Red";

const DANGER_META: Record<
  Danger,
  { label: string; chip: string; ring: string; text: string; blurb: string }
> = {
  Green: {
    label: "Manageable",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    ring: "border-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    blurb:
      "Your MCA payments are taking a relatively healthy share of revenue — but stacking can change that fast. It's still worth knowing your options.",
  },
  Yellow: {
    label: "Strained",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    ring: "border-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    blurb:
      "Your advances are eating a meaningful chunk of your daily cash flow. Many businesses in this range benefit from restructuring before things tighten further.",
  },
  Red: {
    label: "Critical",
    chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    ring: "border-red-400",
    text: "text-red-600 dark:text-red-400",
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

  const inputCls =
    "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="MCA Debt Stress Test | Momentum Funding"
        description="Take the free MCA Debt Stress Test to see how much your merchant cash advances are straining your cash flow — and an estimated path to lower payments. No judgment, no upfront fees."
        keywords="MCA debt stress test, merchant cash advance cash flow, MCA debt relief, debt to revenue ratio, MCA restructuring"
      />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <HeartIcon className="w-4 h-4" />
                MCA Debt Stress Test
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Is your MCA debt{" "}
                <span className="text-mint-green">quietly crushing your cash flow?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Answer four quick questions to see your debt-to-revenue ratio and a danger level —
                then unlock an estimated restructured payment and your projected debt-freedom date.
                Judgment-free, confidential, and no upfront fees.
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
              <div className="flex items-center gap-2 mb-6">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex-1">
                    <div
                      className={`h-1.5 rounded-full transition-colors ${
                        i <= step ? "bg-mint-green" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                    <span
                      className={`mt-1 block text-[11px] font-medium ${
                        i <= step ? "text-mint-green" : "text-text-secondary"
                      }`}
                    >
                      {s}
                    </span>
                  </div>
                ))}
              </div>

              {/* Step 0 — positions */}
              {step === 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    How many advances do you have?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Include every open MCA / position, even small ones.
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Number of advances / positions
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

              {/* Step 1 — balance */}
              {step === 1 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    What's your total balance owed?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    The combined remaining payback across all positions.
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Total balance owed
                    </label>
                    <span className="text-mint-green font-bold tabular-nums">
                      {usd(totalBalance)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10000}
                    max={1000000}
                    step={5000}
                    value={totalBalance}
                    onChange={(e) => setTotalBalance(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$10K</span>
                    <span>$1M</span>
                  </div>
                </div>
              )}

              {/* Step 2 — payment */}
              {step === 2 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    What are your combined payments?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Total amount debited across all advances each period.
                  </p>

                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Combined {frequency} payment
                    </label>
                    <span className="text-mint-green font-bold tabular-nums">{usd(payment)}</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={frequency === "daily" ? 10000 : 30000}
                    step={50}
                    value={payment}
                    onChange={(e) => setPayment(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$100</span>
                    <span>{frequency === "daily" ? "$10K/day" : "$30K/wk"}</span>
                  </div>

                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 mt-6">
                    Payment frequency
                  </label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 w-fit">
                    {(["daily", "weekly"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFrequency(f)}
                        className={`px-6 py-2 text-sm font-semibold capitalize transition-colors ${
                          frequency === f
                            ? "bg-mint-green text-midnight-blue"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3 — revenue */}
              {step === 3 && (
                <div>
                  <h2 className="text-2xl font-bold text-heading mb-2">
                    What's your monthly revenue?
                  </h2>
                  <p className="text-text-secondary mb-6 text-sm">
                    Average gross monthly deposits / sales.
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Monthly revenue
                    </label>
                    <span className="text-mint-green font-bold tabular-nums">
                      {usd(monthlyRevenue)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5000}
                    max={500000}
                    step={5000}
                    value={monthlyRevenue}
                    onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                  />
                  <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>$5K</span>
                    <span>$500K</span>
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
                    className="px-6 py-2.5 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90"
                  >
                    Next →
                  </button>
                ) : (
                  <span className="text-sm text-mint-green font-semibold">
                    See your result →
                  </span>
                )}
              </div>
            </div>

            {/* Result + gate */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {/* LIVE teaser — always visible */}
              <div className="flex items-center gap-2 mb-4">
                <ExclamationTriangleIcon className={`w-6 h-6 ${meta.text}`} />
                <h2 className="text-2xl font-bold text-heading">Your stress level</h2>
              </div>

              <div className={`rounded-xl border-2 ${meta.ring} p-5 mb-5 text-center`}>
                <span
                  className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 ${meta.chip}`}
                >
                  {danger} · {meta.label}
                </span>
                <p className="text-3xl font-bold tabular-nums text-heading">
                  {pct(debitToRevenue)}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  of monthly revenue going to MCA payments
                </p>
                <p className="text-sm text-body mt-3">{meta.blurb}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                    {pct(debtToRevenue)}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">Debt-to-revenue</p>
                </div>
                <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                    {usd(currentMonthly)}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">Est. monthly to MCAs</p>
                </div>
              </div>

              {unlocked ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <ArrowTrendingDownIcon className="w-6 h-6 text-mint-green" />
                    <h3 className="text-xl font-bold text-heading">Your estimated relief plan</h3>
                  </div>

                  <div className="rounded-xl bg-mint-green/10 p-5 mb-4 text-center">
                    <p className="text-sm text-text-secondary mb-1">
                      Estimated restructured monthly payment
                    </p>
                    <p className="text-3xl font-bold text-mint-green tabular-nums">
                      {usd(newPaymentLow)} – {usd(newPaymentHigh)}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      down from about {usd(currentMonthly)}/mo today
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {usd(monthlySavingsLow)} – {usd(monthlySavingsHigh)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">Est. monthly savings</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-4 text-center">
                      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                        {fmtMonths(monthsNew)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Est. debt-freedom (vs. {fmtMonths(monthsNow)})
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-deep-sea/5 dark:bg-deep-sea/20 p-4 flex items-start gap-3 mb-4">
                    <CalendarDaysIcon className="w-6 h-6 text-ocean-blue flex-shrink-0" />
                    <p className="text-sm text-body">
                      At your current pace you'd be clear in roughly{" "}
                      <strong>{fmtMonths(monthsNow)}</strong>. Under an estimated restructuring plan,
                      a freer cash-flow target is around <strong>{fmtMonths(monthsNew)}</strong> — with
                      far smaller payments along the way.
                    </p>
                  </div>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      We've got it, {form.contact_first_name || "there"}. A debt-relief specialist
                      will reach out within 24 hours to review your {positions} position
                      {positions === 1 ? "" : "s"} and build a real plan — no pressure, no judgment.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed mt-5">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    These figures are <strong>estimates only</strong>, not an offer, approval, or a
                    guarantee of savings. Restructuring is not the same as a reverse-consolidation
                    advance, and not all businesses qualify. Actual results depend on your funders,
                    balances, and program eligibility. There are <strong>no upfront fees</strong>.
                  </p>

                  <Link to="/" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h3 className="text-xl font-bold text-heading">Get your full plan</h3>
                  </div>
                  <p className="text-text-secondary mb-6 text-sm">
                    Enter your info to unlock your estimated restructured payment, monthly savings,
                    and projected debt-freedom date. Free, confidential, no obligation.
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
                      {submitting ? "Building your plan…" : "Get my full plan →"}
                    </button>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      Free, confidential, no upfront fees. Results are estimates, not guarantees.
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
