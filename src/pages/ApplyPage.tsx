import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from '../components/seo/SEO';
import supabase from "../supabase";
import { PLAID_ENABLED } from "../config";
import PipelineFlow from "../components/shared/PipelineFlow";
import TcpaConsent from "../components/ui/TcpaConsent";
import { recordConsent } from "../lib/consent";

const BUSINESS_TYPES = ["Retail", "Restaurant", "Construction", "Trucking", "Healthcare", "Auto", "Services", "Other"];
const TIB_OPTIONS = ["6-12 months", "1-2 years", "2-5 years", "5+ years"];
const REVENUE_OPTIONS = ["$10k-$25k", "$25k-$50k", "$50k-$100k", "$100k+"];

interface FormState {
  business_name: string; contact_first_name: string; contact_last_name: string;
  email: string; phone: string; funding_amount: string;
  business_type: string; time_in_business: string; monthly_revenue: string; funding_purpose: string;
}

const EMPTY: FormState = {
  business_name: "", contact_first_name: "", contact_last_name: "", email: "", phone: "",
  funding_amount: "", business_type: "", time_in_business: "", monthly_revenue: "", funding_purpose: "",
};

export default function ApplyPage() {
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
    // Record TCPA express-written consent (durable proof) before submitting.
    await recordConsent({
      name: `${form.contact_first_name} ${form.contact_last_name}`.trim(),
      email: form.email, phone: form.phone, source: "apply", page: "/apply",
    });
    try {
      // Route through mca-intake so the lead lands in GHL (contact + MCA-pipeline
      // opportunity at New Lead) and fires Speed-to-Lead — same path as the homepage
      // ApplySection. Previously this inserted into funding_applications, which nothing
      // consumed, so /apply leads never reached the CRM or pipeline.
      const { data, error } = await supabase.functions.invoke("mca-intake", {
        body: {
          business_name: form.business_name,
          contact_first_name: form.contact_first_name,
          contact_last_name: form.contact_last_name,
          email: form.email,
          phone: form.phone,
          amount_requested: form.funding_amount,
          use_of_funds: form.funding_purpose || "Working capital",
          lead_source: "website_apply",
          tcpa_consent: true,
          lead_source_detail: [
            form.business_type && `Industry: ${form.business_type}`,
            form.time_in_business && `TIB: ${form.time_in_business}`,
            form.monthly_revenue && `Rev: ${form.monthly_revenue}`,
          ].filter(Boolean).join(" · ") || null,
        },
      });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || "Something went wrong.");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <SEO title="Apply for Business Funding" description="Apply for business funding in minutes. Check your rate with no credit impact. $5K–$3M, funding in 24–48 hours, 93% approval. No upfront fees." keywords="apply for business funding, business funding application, merchant cash advance application" />
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        {submitted ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center">
            <CheckCircleIcon className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Application received!</h1>
            <p className="text-gray-600 dark:text-gray-300">
              Thanks, {form.contact_first_name}. A funding specialist will reach out shortly to review your options and
              request your most recent business bank statements. No upfront fees, and checking your options has no impact on your credit.
            </p>
            <div className="mt-8 text-left">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 text-center">Here’s what happens next</p>
              <PipelineFlow pipeline="mca" currentKey="new" />
            </div>
            <Link to="/" className="inline-block mt-6 text-ocean-blue hover:underline">← Back to home</Link>
          </div>
        ) : (
          <>
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Get the working capital your business needs</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-2">Fast funding — typically 24–48 hours. No upfront fees. Checking your options won’t affect your credit.</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Business name *</span>
                  <input required value={form.business_name} onChange={(e) => set("business_name", e.target.value)} className={inputCls} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Business type *</span>
                  <select required value={form.business_type} onChange={(e) => set("business_type", e.target.value)} className={inputCls}>
                    <option value="">Select…</option>{BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">First name *</span>
                  <input required value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} className={inputCls} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Last name *</span>
                  <input required value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} className={inputCls} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Email *</span>
                  <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Phone *</span>
                  <input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Time in business *</span>
                  <select required value={form.time_in_business} onChange={(e) => set("time_in_business", e.target.value)} className={inputCls}>
                    <option value="">Select…</option>{TIB_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </select></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Monthly revenue *</span>
                  <select required value={form.monthly_revenue} onChange={(e) => set("monthly_revenue", e.target.value)} className={inputCls}>
                    <option value="">Select…</option>{REVENUE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </select></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Funding amount needed *</span>
                  <input required value={form.funding_amount} onChange={(e) => set("funding_amount", e.target.value)} placeholder="$50,000" className={inputCls} /></label>
                <label className="text-sm sm:col-span-2"><span className="text-gray-600 dark:text-gray-300">What will you use it for?</span>
                  <input value={form.funding_purpose} onChange={(e) => set("funding_purpose", e.target.value)} className={inputCls} /></label>
              </div>

              {/* Bank verification step — manual by default; Plaid only if enabled */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/40">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  <LockClosedIcon className="w-4 h-4" /> Bank verification
                </div>
                {PLAID_ENABLED ? (
                  <p className="text-sm text-gray-500 mt-1">After you submit, you can connect your bank in ~60 seconds for the fastest approval — or send statements manually.</p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">After you submit, a specialist will request your 3 most recent business bank statements. Nothing to upload now.</p>
                )}
              </div>

              <TcpaConsent checked={consent} onChange={setConsent} />

              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" disabled={submitting || !consent}
                className="w-full py-3 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90 disabled:opacity-60">
                {submitting ? "Submitting…" : "Submit application"}
              </button>
              <p className="text-xs text-gray-400 text-center">
                This is not a loan application — MCA products are a purchase of future receivables.
              </p>
            </form>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
