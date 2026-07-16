import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from '../components/seo/SEO';
import supabase from "../supabase";
import { PLAID_ENABLED } from "../config";
import PipelineFlow from "../components/shared/PipelineFlow";
import TcpaConsent from "../components/ui/TcpaConsent";
import { recordConsent } from "../lib/consent";
import { OS_CSS, useOSFonts, OSSection, Eyebrow } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";

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
  useOSFonts();
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

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{APPLY_CSS}</style>
      <SEO title="Apply for Business Funding" description="Apply for business funding in minutes. Check your rate with no credit impact. $5K–$3M, funding in 24–48 hours, 93% approval. No upfront fees." keywords="apply for business funding, business funding application, merchant cash advance application" />
      <ScrollToTop />
      <OSNav />

      <OSSection tone="ink">
        <div className="apply-wrap">
          {submitted ? (
            <div className="apply-card apply-success">
              <CheckCircleIcon className="apply-success-ico" />
              <h1 className="apply-h1">Application received.</h1>
              <p className="apply-sub">
                Thanks, {form.contact_first_name}. A funding specialist will reach out shortly to review your options
                and request your most recent business bank statements. No upfront fees, and checking your options has
                no impact on your credit.
              </p>
              <div className="apply-pipeline">
                <p className="apply-pipeline-label os-mono">HERE&rsquo;S WHAT HAPPENS NEXT</p>
                <PipelineFlow pipeline="mca" currentKey="new" />
              </div>
              <Link to="/" className="apply-back">← Back to home</Link>
            </div>
          ) : (
            <>
              <div className="apply-head">
                <Eyebrow>APPLY · ~5 MINUTES</Eyebrow>
                <h1 className="os-display apply-title">GET THE <span className="os-go">WORKING CAPITAL</span> YOUR BUSINESS NEEDS.</h1>
                <p className="apply-lede">
                  Fast funding — typically <strong>24–48 hours</strong>. No upfront fees. Checking your options
                  won&rsquo;t affect your credit.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="apply-card">
                <div className="apply-grid">
                  <label className="apply-field"><span className="apply-label">Business name *</span>
                    <input required value={form.business_name} onChange={(e) => set("business_name", e.target.value)} className="apply-input" /></label>
                  <label className="apply-field"><span className="apply-label">Business type *</span>
                    <select required value={form.business_type} onChange={(e) => set("business_type", e.target.value)} className="apply-input">
                      <option value="">Select…</option>{BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select></label>
                  <label className="apply-field"><span className="apply-label">First name *</span>
                    <input required value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} className="apply-input" /></label>
                  <label className="apply-field"><span className="apply-label">Last name *</span>
                    <input required value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} className="apply-input" /></label>
                  <label className="apply-field"><span className="apply-label">Email *</span>
                    <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="apply-input" /></label>
                  <label className="apply-field"><span className="apply-label">Phone *</span>
                    <input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="apply-input" /></label>
                  <label className="apply-field"><span className="apply-label">Time in business *</span>
                    <select required value={form.time_in_business} onChange={(e) => set("time_in_business", e.target.value)} className="apply-input">
                      <option value="">Select…</option>{TIB_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                    </select></label>
                  <label className="apply-field"><span className="apply-label">Monthly revenue *</span>
                    <select required value={form.monthly_revenue} onChange={(e) => set("monthly_revenue", e.target.value)} className="apply-input">
                      <option value="">Select…</option>{REVENUE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                    </select></label>
                  <label className="apply-field"><span className="apply-label">Funding amount needed *</span>
                    <input required value={form.funding_amount} onChange={(e) => set("funding_amount", e.target.value)} placeholder="$50,000" className="apply-input" /></label>
                  <label className="apply-field apply-field-full"><span className="apply-label">What will you use it for?</span>
                    <input value={form.funding_purpose} onChange={(e) => set("funding_purpose", e.target.value)} className="apply-input" /></label>
                </div>

                {/* Bank verification step — manual by default; Plaid only if enabled */}
                <div className="apply-bank">
                  <div className="apply-bank-top"><LockClosedIcon className="apply-bank-ico" /> Bank verification</div>
                  {PLAID_ENABLED ? (
                    <p className="apply-bank-note">After you submit, you can connect your bank in ~60 seconds for the fastest approval — or send statements manually.</p>
                  ) : (
                    <p className="apply-bank-note">After you submit, a specialist will request your 3 most recent business bank statements. Nothing to upload now.</p>
                  )}
                </div>

                <TcpaConsent checked={consent} onChange={setConsent} />

                {error && <p className="apply-error">{error}</p>}
                <button type="submit" disabled={submitting || !consent} className="os-cta-primary apply-submit">
                  {submitting ? "Submitting…" : "Submit application"} {!submitting && <span aria-hidden>→</span>}
                </button>
                <p className="apply-compliance os-mono">
                  This is not a loan application — MCA products are a purchase of future receivables.
                </p>
              </form>
            </>
          )}
        </div>
      </OSSection>

      <OSFooter />
    </div>
  );
}

const APPLY_CSS = `
.apply-wrap{max-width:720px;margin:0 auto}
.apply-head{text-align:center;margin-bottom:32px}
.apply-head .os-eyebrow{justify-content:center;display:inline-flex}
.apply-title{font-size:clamp(28px,4vw,44px);margin:0 auto 16px;max-width:16em}
.apply-lede{font-size:17px;line-height:1.6;color:var(--lede);margin:0 auto;max-width:34em}
.apply-lede strong{color:var(--tx);font-weight:600}

.apply-card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:16px;padding:28px;box-shadow:0 30px 60px -34px var(--shadow)}
.apply-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.apply-field{display:flex;flex-direction:column}
.apply-field-full{grid-column:1 / -1}
.apply-label{font-size:12px;letter-spacing:.02em;color:var(--muted);font-weight:500;margin-bottom:6px}
.apply-input{width:100%;padding:11px 13px;border-radius:9px;border:1px solid var(--hair);
  background:var(--ink2);color:var(--tx);font-size:14px;font-family:'Inter',sans-serif;outline:none;transition:border-color .15s}
.apply-input:focus{border-color:var(--go)}

.apply-bank{margin-top:18px;border:1px solid var(--hair);border-radius:11px;padding:16px;background:rgba(22,217,146,.035)}
.apply-bank-top{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--tx)}
.apply-bank-ico{width:16px;height:16px;color:var(--go-text)}
.apply-bank-note{font-size:13px;line-height:1.55;color:var(--muted);margin:6px 0 0}

.apply-error{font-size:13px;color:#ef4444;margin:14px 0 0}
.apply-submit{width:100%;justify-content:center;margin-top:18px;font-size:15px}
.apply-submit:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.apply-compliance{font-size:11px;color:var(--faint);text-align:center;margin:14px 0 0}

.apply-success{text-align:center}
.apply-success-ico{width:56px;height:56px;color:var(--go-text);margin:0 auto 14px}
.apply-h1{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:30px;color:var(--tx);margin:0 0 10px;letter-spacing:.01em}
.apply-sub{font-size:15px;line-height:1.65;color:var(--lede);max-width:40em;margin:0 auto}
.apply-pipeline{margin-top:28px;text-align:left}
.apply-pipeline-label{font-size:11px;letter-spacing:.14em;color:var(--faint);text-align:center;margin-bottom:12px}
.apply-back{display:inline-block;margin-top:22px;color:var(--go-text);text-decoration:none;font-size:14px}

@media (max-width:560px){.apply-grid{grid-template-columns:1fr}}
`;
