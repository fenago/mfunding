import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, LifebuoyIcon } from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import PipelineFlow from "../components/shared/PipelineFlow";
import supabase from "../supabase";

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

const TRUST = ["No upfront fees", "Free consultation", "We work with your current funders"];

export default function VCFReliefPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vcf-intake", { body: form });
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        {submitted ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center">
            <CheckCircleIcon className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">We've got it, {form.contact_first_name}.</h1>
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
            <div className="mb-8 text-center">
              <LifebuoyIcon className="w-12 h-12 text-ocean-blue mx-auto mb-3" />
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Drowning in daily MCA payments?</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-2">
                If you've got multiple advances stacking up, we can help consolidate and renegotiate them into one
                manageable arrangement. Tell us your situation — it's a free, no-obligation review.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
                {TRUST.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                    <CheckCircleIcon className="w-4 h-4 text-emerald-500" /> {t}
                  </span>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
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

              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" disabled={submitting}
                className="w-full py-3 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90 disabled:opacity-60">
                {submitting ? "Submitting…" : "Get my free relief review"}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Free consultation, no upfront fees. This is not a loan — our programs restructure your existing advances.
              </p>
            </form>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
