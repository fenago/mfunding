import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, UserGroupIcon, BanknotesIcon, ClockIcon } from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import supabase from "../supabase";

const PARTNER_TYPES = [
  { value: "cpa", label: "CPA / Accountant" },
  { value: "bookkeeper", label: "Bookkeeper" },
  { value: "real_estate_agent", label: "Real Estate Agent" },
  { value: "equipment_vendor", label: "Equipment Vendor" },
  { value: "attorney", label: "Attorney" },
  { value: "other", label: "Other" },
];

const PERKS = [
  { icon: BanknotesIcon, title: "$100 per funded deal", body: "Earn a gift card for every referral we fund — no cap." },
  { icon: ClockIcon, title: "We do the work", body: "Send the intro; our team handles qualifying, packaging, and closing." },
  { icon: UserGroupIcon, title: "Your clients, cared for", body: "Fast, transparent funding that reflects well on you." },
];

interface FormState { name: string; company: string; partner_type: string; email: string; phone: string; notes: string }
const EMPTY: FormState = { name: "", company: "", partner_type: "cpa", email: "", phone: "", notes: "" };

export default function PartnersPage() {
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
      const { data, error } = await supabase.functions.invoke("partner-signup", { body: form });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const input = "mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ocean-blue outline-none";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        {submitted ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center">
            <CheckCircleIcon className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Thanks, {form.name.split(" ")[0]}!</h1>
            <p className="text-gray-600 dark:text-gray-300">We'll review your application and reach out to get you set up as a referral partner.</p>
            <Link to="/" className="inline-block mt-6 text-ocean-blue hover:underline">← Back to home</Link>
          </div>
        ) : (
          <>
            <div className="mb-8 text-center">
              <UserGroupIcon className="w-12 h-12 text-ocean-blue mx-auto mb-3" />
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Become a referral partner</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-2">
                CPAs, bookkeepers, RE agents, and vendors: send us clients who need capital and earn for every funded deal.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              {PERKS.map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.title} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                    <Icon className="w-7 h-7 text-ocean-blue mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.body}</p>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Your name *</span>
                  <input required value={form.name} onChange={(e) => set("name", e.target.value)} className={input} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Company</span>
                  <input value={form.company} onChange={(e) => set("company", e.target.value)} className={input} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Email *</span>
                  <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={input} /></label>
                <label className="text-sm"><span className="text-gray-600 dark:text-gray-300">Phone</span>
                  <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={input} /></label>
                <label className="text-sm sm:col-span-2"><span className="text-gray-600 dark:text-gray-300">I'm a…</span>
                  <select value={form.partner_type} onChange={(e) => set("partner_type", e.target.value)} className={input}>
                    {PARTNER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></label>
                <label className="text-sm sm:col-span-2"><span className="text-gray-600 dark:text-gray-300">Anything else?</span>
                  <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={`${input} h-20`} /></label>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" disabled={submitting} className="w-full py-3 rounded-lg bg-ocean-blue text-white font-semibold hover:opacity-90 disabled:opacity-60">
                {submitting ? "Submitting…" : "Apply to partner"}
              </button>
            </form>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
