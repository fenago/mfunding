import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BanknotesIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../../components/landing/Navbar";
import Footer from "../../components/landing/Footer";
import ScrollToTop from "../../components/ui/ScrollToTop";
import SEO from '../../components/seo/SEO';
import supabase from "../../supabase";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const TIME_OPTIONS = [
  "Less than 6 months",
  "6 months - 1 year",
  "1 - 2 years",
  "2 - 5 years",
  "5+ years",
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

export default function MCAFundingCalculatorPage() {
  // Calculator inputs
  const [monthlyRevenue, setMonthlyRevenue] = useState(50000);
  const [timeInBusiness, setTimeInBusiness] = useState("");
  const [industry, setIndustry] = useState("");

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Approvals run 50%–150% of average monthly sales.
  const low = monthlyRevenue * 0.5;
  const high = monthlyRevenue * 1.5;
  const estimate = monthlyRevenue; // ~100% midpoint, used for the saved lead amount

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
          amount_requested: Math.round(estimate),
          use_of_funds: "Working capital",
          lead_source: "calculator",
          lead_source_detail: `Funding calculator — est. ${usd(low)}–${usd(high)} on ${usd(monthlyRevenue)}/mo${industry ? `, ${industry}` : ""}${timeInBusiness ? `, ${timeInBusiness}` : ""}`,
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO title="How Much Business Funding Can I Get?" description="Estimate how much business funding you qualify for based on your monthly revenue. Free instant calculator — no credit impact." keywords="how much business funding can I get, business funding calculator, merchant cash advance amount calculator" />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <BanknotesIcon className="w-4 h-4" />
                Working Capital Calculator
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                How much working capital{" "}
                <span className="text-mint-green">can you get?</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Approvals typically run 50%–150% of your average monthly sales — no minimum credit
                score, all industries welcome, funded in as little as 24 hours. Tell us your revenue
                to see your estimated range.
              </p>
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section className="container-max py-16">
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto items-start">
            {/* Inputs */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-heading mb-6">Your business</h2>

              <div className="mb-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Average monthly revenue
                  </label>
                  <span className="text-mint-green font-bold tabular-nums">{usd(monthlyRevenue)}</span>
                </div>
                <input
                  type="range"
                  min={5000}
                  max={1000000}
                  step={5000}
                  value={monthlyRevenue}
                  onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-mint-green"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$5K</span>
                  <span>$1M</span>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  Time in business <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <select
                  value={timeInBusiness}
                  onChange={(e) => setTimeInBusiness(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select duration</option>
                  {TIME_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  Industry <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select industry</option>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Result + gate */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm">
              {unlocked ? (
                <>
                  <div className="flex items-center gap-2 mb-6">
                    <BoltIcon className="w-6 h-6 text-mint-green" />
                    <h2 className="text-2xl font-bold text-heading">Your estimated funding</h2>
                  </div>

                  <div className="rounded-xl bg-mint-green/10 p-6 mb-4 text-center">
                    <p className="text-sm text-text-secondary mb-1">Estimated advance range</p>
                    <p className="text-3xl font-bold text-mint-green tabular-nums">
                      {usd(low)} – {usd(high)}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      based on {usd(monthlyRevenue)}/mo in revenue
                    </p>
                  </div>

                  <div className="rounded-xl border border-mint-green/30 bg-mint-green/5 p-4 flex items-start gap-3 mb-4">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                    <p className="text-sm text-body">
                      Thanks, {form.contact_first_name || "there"}! A funding specialist will reach out
                      within 24 hours with real options matched to your business — no credit impact to
                      check your rate.
                    </p>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    This is an <strong>estimate only</strong>, not an offer, approval, or guarantee. A
                    merchant cash advance is a purchase of future receivables, not a loan. Final amounts
                    depend on underwriting and funder review.
                  </p>

                  <Link to="/" className="inline-block mt-5 text-ocean-blue hover:underline text-sm">
                    ← Back to home
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <LockClosedIcon className="w-6 h-6 text-ocean-blue" />
                    <h2 className="text-2xl font-bold text-heading">See your estimate</h2>
                  </div>
                  <p className="text-text-secondary mb-6">
                    Enter your info to unlock your estimated working-capital range and get matched with
                    funders. Free, no obligation, and checking won't affect your credit.
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
                      {submitting ? "Calculating…" : "Show my funding estimate →"}
                    </button>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                      No credit impact to check. Estimates only — not an offer or guarantee.
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
