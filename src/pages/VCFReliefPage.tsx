import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  LifebuoyIcon,
  ScaleIcon,
  BanknotesIcon,
  ClockIcon,
  ShieldCheckIcon,
  HeartIcon,
  BuildingLibraryIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from '../components/seo/SEO';
import PipelineFlow from "../components/shared/PipelineFlow";
import supabase from "../supabase";
import TcpaConsent from "../components/ui/TcpaConsent";
import { recordConsent } from "../lib/consent";

interface FormState {
  business_name: string; contact_first_name: string; contact_last_name: string;
  email: string; phone: string;
  active_positions: string; total_balance: string; daily_debit: string;
  current_funders: string; hardship_reason: string;
}
const EMPTY: FormState = {
  business_name: "", contact_first_name: "", contact_last_name: "", email: "", phone: "",
  active_positions: "", total_balance: "", daily_debit: "", current_funders: "", hardship_reason: "",
};

// Trust badges — drawn from our debt-relief partner's real track record.
const TRUST = ["No upfront fees", "30+ years of experience", "$100M+ debt restructured", "Answers within 24 hours"];

// Headline proof points. These reflect our debt-relief partner's historical
// results — framed as ranges/typicals (never guarantees). See disclaimer below.
const STATS = [
  { value: "up to 50–75%", label: "Typical payment reduction*" },
  { value: "$100M+", label: "Business debt resolved to date" },
  { value: "30+ yrs", label: "Industry experience" },
  { value: "Most", label: "Qualified applicants accepted*" },
];

// Two flagship, white-labeled programs — what we actually offer.
const PROGRAMS = [
  {
    icon: ScaleIcon,
    tag: "No new loan",
    title: "MCA Debt Restructuring",
    blurb:
      "An attorney-led team renegotiates your existing advances directly with your funders — turning crushing daily debits into one realistic payment, with no new borrowing.",
    points: [
      "Many clients lower payments by 50–75% (results vary)",
      "No minimum credit score and no collateral required",
      "Built for $50,000+ in total business debt",
      "Most qualified applicants are accepted into the program",
      "No upfront, out-of-pocket fees",
      "Often no negative impact to business or personal credit",
    ],
    foot: "A customized offer and closing call typically within 24 hours.",
  },
  {
    icon: BuildingLibraryIcon,
    tag: "Refinance your MCAs",
    title: "FDIC Bank Term Loan & Line of Credit",
    blurb:
      "Replace high-cost MCA debits with one affordable, fixed monthly payment through a 10-year, FDIC-insured bank term loan. It's not an SBA loan or an MCA — and it's ideal for refinancing advances.",
    points: [
      "Affordable fixed monthly payments over a 10-year term",
      "No upfront fees",
      "Pre-approval in 48–72 hours with no impact to credit",
      "Light documentation; funds in about 2–3 weeks",
      "Up to $500,000 (higher amounts case-by-case)",
    ],
    foot: "Typical eligibility: 640+ FICO, 2+ years in business, $250K+ annual revenue with positive net income. Available in all 50 states. (Some industries excluded.)",
  },
];

// Why business owners trust the program.
const WHY = [
  { icon: BanknotesIcon, title: "No upfront fees", body: "You've paid enough. Program fees are built into your new, dramatically lower payments — nothing out of pocket to start." },
  { icon: ClockIcon, title: "Fast turnaround", body: "From the first call to a signed agreement in as little as 24 hours. When the pressure's on, speed matters." },
  { icon: ScaleIcon, title: "Both paths, not one", body: "Most firms offer a single option. We do both — restructuring and refinancing — so you're never forced down the wrong path." },
  { icon: HeartIcon, title: "Judgment-free, family-run", body: "Real conversations and honest advice — even when it's hard to hear — with zero pressure and no judgment." },
];

export default function VCFReliefPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  function set<K extends keyof FormState>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) { setError("Please provide consent to be contacted to continue."); return; }
    setError(null);
    setSubmitting(true);
    await recordConsent({
      name: `${form.contact_first_name} ${form.contact_last_name}`.trim(),
      email: form.email, phone: form.phone, source: "vcf-relief", page: "/debt-relief",
    });
    try {
      const { data, error } = await supabase.functions.invoke("vcf-intake", { body: { ...form, tcpa_consent: true } });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO title="MCA Debt Relief & Restructuring" description="Drowning in daily merchant cash advance payments? Momentum Funding helps small businesses restructure, consolidate, and reduce MCA debt. Free consultation, no upfront fees." keywords="MCA debt relief, merchant cash advance consolidation, restructure MCA, reduce daily payments, get out of MCA debt" />
      <Navbar />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white relative overflow-hidden">
          <div className="container-max py-16 lg:py-20 relative z-10">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <LifebuoyIcon className="w-4 h-4" />
                MCA Debt Relief
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Drowning in daily MCA payments?{" "}
                <span className="text-mint-green">You have options.</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed mb-8">
                If multiple advances are stacking up and the daily debits are choking your cash flow,
                we can help you restructure your existing debt — or refinance it into one affordable
                bank loan. It's a free, judgment-free review, with no upfront fees and no obligation.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-3 mb-8">
                {TRUST.map((t) => (
                  <span key={t} className="inline-flex items-center gap-2 text-sm text-white/90">
                    <CheckCircleIcon className="w-5 h-5 text-mint-green" /> {t}
                  </span>
                ))}
              </div>
              <a
                href="#relief-form"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90 transition-opacity"
              >
                Get my free relief review →
              </a>
            </div>
          </div>
        </section>

        {/* Stats band */}
        <section className="bg-deep-sea text-white">
          <div className="container-max py-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              {STATS.map((s) => (
                <div key={s.label}>
                  <p className="text-3xl lg:text-4xl font-bold text-mint-green">{s.value}</p>
                  <p className="text-white/70 text-sm mt-1">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="text-white/50 text-xs mt-6 max-w-3xl mx-auto text-center leading-relaxed">
              *Figures reflect our debt-relief partner's historical results and are not a guarantee.
              Outcomes depend on your situation; not all businesses qualify, and results vary. This is
              not legal, tax, or financial advice.
            </p>
          </div>
        </section>

        {/* Programs */}
        <section className="container-max py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-heading mb-3">Two Ways We Get You Out</h2>
            <p className="text-text-secondary text-lg max-w-2xl mx-auto">
              Every situation is different, so we match the solution to your reality — whether that's
              restructuring what you owe or refinancing it into one affordable bank loan.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {PROGRAMS.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-midnight-blue/30 p-8 shadow-sm flex flex-col"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 flex items-center justify-center">
                    <p.icon className="w-6 h-6 text-ocean-blue" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-mint-green bg-mint-green/10 rounded-full px-3 py-1">
                    {p.tag}
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-heading mb-2">{p.title}</h3>
                <p className="text-body leading-relaxed mb-6">{p.blurb}</p>
                <ul className="space-y-3 mb-6">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3">
                      <CheckCircleIcon className="w-5 h-5 text-mint-green flex-shrink-0 mt-0.5" />
                      <span className="text-body leading-snug">{pt}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-auto pt-4 border-t border-gray-100 dark:border-white/10 text-sm text-text-secondary leading-relaxed">
                  {p.foot}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Why choose */}
        <section className="bg-gray-50 dark:bg-gray-900">
          <div className="container-max py-16">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-heading mb-3">Honest Help, No Judgment</h2>
              <p className="text-text-secondary text-lg max-w-2xl mx-auto">
                Backed by a family-run debt-relief firm with 30+ years of experience and over
                $100 million in business debt successfully restructured or refinanced.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {WHY.map((w) => (
                <div key={w.title} className="rounded-2xl bg-white dark:bg-midnight-blue/30 border border-gray-100 dark:border-white/10 p-6">
                  <w.icon className="w-7 h-7 text-mint-green mb-4" />
                  <h3 className="font-bold text-heading mb-2">{w.title}</h3>
                  <p className="text-body text-sm leading-relaxed">{w.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Intake form / success */}
        <section id="relief-form" className="container-max py-16">
          <div className="max-w-2xl mx-auto">
            {submitted ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center">
                <CheckCircleIcon className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">We've got it, {form.contact_first_name}.</h2>
                <p className="text-gray-600 dark:text-gray-300">
                  A specialist will reach out to review your current advances and build a plan to lower your payments.
                  No upfront fees, and the consultation is free.
                </p>
                <div className="mt-8 text-left">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 text-center">Here's what happens next</p>
                  <PipelineFlow pipeline="vcf" currentKey="new_distressed" />
                </div>
                <Link to="/" className="inline-block mt-6 text-ocean-blue hover:underline">← Back to home</Link>
              </div>
            ) : (
              <>
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-bold text-heading mb-2">Start Your Free Relief Review</h2>
                  <p className="text-text-secondary">
                    Tell us your situation. It's confidential, judgment-free, and there's no obligation.
                    Our team responds within 24 hours.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4 shadow-sm">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Business name</span>
                      <input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">First name *</span>
                      <input required value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Last name</span>
                      <input value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Email *</span>
                      <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Phone *</span>
                      <input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300"># of active advances (MCAs)</span>
                      <input value={form.active_positions} onChange={(e) => set("active_positions", e.target.value)} placeholder="e.g. 3" className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Total balance owed</span>
                      <input value={form.total_balance} onChange={(e) => set("total_balance", e.target.value)} placeholder="$" className={inputCls} /></label>
                    <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Combined daily/weekly payment</span>
                      <input value={form.daily_debit} onChange={(e) => set("daily_debit", e.target.value)} placeholder="$" className={inputCls} /></label>
                    <label className="text-sm sm:col-span-2"><span className="text-gray-600 dark:text-gray-300">Who are your current funders?</span>
                      <input value={form.current_funders} onChange={(e) => set("current_funders", e.target.value)} className={inputCls} /></label>
                    <label className="text-sm sm:col-span-2"><span className="text-gray-600 dark:text-gray-300">What's making the payments hard right now?</span>
                      <textarea value={form.hardship_reason} onChange={(e) => set("hardship_reason", e.target.value)} className={`${inputCls} h-20`} /></label>
                  </div>

                  <TcpaConsent checked={consent} onChange={setConsent} />

                  {error && <p className="text-sm text-red-500">{error}</p>}
                  <button type="submit" disabled={submitting || !consent}
                    className="w-full py-3 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90 disabled:opacity-60">
                    {submitting ? "Submitting…" : "Get my free relief review"}
                  </button>
                  <p className="text-xs text-gray-400 text-center leading-relaxed">
                    <ShieldCheckIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    Free consultation, no upfront fees. Debt-relief programs restructure or refinance your
                    existing advances; not all businesses qualify, and results vary by situation.
                  </p>
                </form>
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
