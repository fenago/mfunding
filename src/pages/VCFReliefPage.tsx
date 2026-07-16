import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ScaleIcon,
  BanknotesIcon,
  ClockIcon,
  ShieldCheckIcon,
  HeartIcon,
  BuildingLibraryIcon,
} from "@heroicons/react/24/outline";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from '../components/seo/SEO';
import PipelineFlow from "../components/shared/PipelineFlow";
import supabase from "../supabase";
import TcpaConsent from "../components/ui/TcpaConsent";
import { recordConsent } from "../lib/consent";
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";

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

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{VCF_CSS}</style>
      <SEO title="MCA Debt Relief & Restructuring" description="Drowning in daily merchant cash advance payments? Momentum Funding helps small businesses restructure, consolidate, and reduce MCA debt. Free consultation, no upfront fees." keywords="MCA debt relief, merchant cash advance consolidation, restructure MCA, reduce daily payments, get out of MCA debt" />
      <ScrollToTop />
      <OSNav />

      {/* Hero */}
      <OSSection tone="ink">
        <div className="vcf-hero">
          <Eyebrow>MCA DEBT RELIEF</Eyebrow>
          <Display>
            DROWNING IN DAILY MCA PAYMENTS?<br /><span className="os-go">YOU HAVE OPTIONS.</span>
          </Display>
          <p className="vcf-lede">
            If multiple advances are stacking up and the daily debits are choking your cash flow, we can help
            you restructure your existing debt — or refinance it into one affordable bank loan. It&rsquo;s a free,
            judgment-free review, with no upfront fees and no obligation.
          </p>
          <div className="vcf-trust">
            {TRUST.map((t) => (
              <span key={t} className="os-chip"><span className="vcf-chip-check" aria-hidden>✓</span>{t}</span>
            ))}
          </div>
          <div className="vcf-hero-cta">
            <a href="#relief-form" className="os-cta-primary">Get my free relief review <span aria-hidden>→</span></a>
          </div>
        </div>
      </OSSection>

      {/* Stats band */}
      <OSSection tone="panel">
        <div className="vcf-stats">
          {STATS.map((s) => (
            <div key={s.label} className="vcf-stat">
              <p className="vcf-stat-v">{s.value}</p>
              <p className="vcf-stat-k">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="vcf-disclaimer">
          *Figures reflect our debt-relief partner&rsquo;s historical results and are not a guarantee. Outcomes
          depend on your situation; not all businesses qualify, and results vary. This is not legal, tax, or
          financial advice.
        </p>
      </OSSection>

      {/* Programs */}
      <OSSection tone="ink">
        <div className="money-secthead" style={{ margin: "0 auto 40px", textAlign: "center" }}>
          <Eyebrow>TWO WAYS OUT</Eyebrow>
          <Display>MATCHED TO <span className="os-go">YOUR REALITY.</span></Display>
          <p className="vcf-sect-sub">
            Every situation is different, so we match the solution to your reality — whether that&rsquo;s
            restructuring what you owe or refinancing it into one affordable bank loan.
          </p>
        </div>
        <div className="vcf-prog-grid">
          {PROGRAMS.map((p) => (
            <div key={p.title} className="os-card vcf-prog">
              <div className="vcf-prog-top">
                <span className="vcf-prog-ico"><p.icon className="vcf-prog-svg" /></span>
                <span className="vcf-prog-tag os-mono">{p.tag}</span>
              </div>
              <h3 className="vcf-prog-title">{p.title}</h3>
              <p className="vcf-prog-blurb">{p.blurb}</p>
              <ul className="vcf-prog-points">
                {p.points.map((pt) => (
                  <li key={pt}><span className="vcf-chip-check" aria-hidden>✓</span>{pt}</li>
                ))}
              </ul>
              <p className="vcf-prog-foot">{p.foot}</p>
            </div>
          ))}
        </div>
      </OSSection>

      {/* Why choose */}
      <OSSection tone="panel">
        <div className="money-secthead" style={{ margin: "0 auto 40px", textAlign: "center" }}>
          <Eyebrow>WHY US</Eyebrow>
          <Display>HONEST HELP, <span className="os-go">NO JUDGMENT.</span></Display>
          <p className="vcf-sect-sub">
            Backed by a family-run debt-relief firm with 30+ years of experience and over $100 million in
            business debt successfully restructured or refinanced.
          </p>
        </div>
        <div className="vcf-why-grid">
          {WHY.map((w) => (
            <div key={w.title} className="os-card vcf-why">
              <span className="vcf-why-ico"><w.icon className="vcf-why-svg" /></span>
              <h3 className="vcf-why-title">{w.title}</h3>
              <p className="vcf-why-body">{w.body}</p>
            </div>
          ))}
        </div>
      </OSSection>

      {/* Intake form / success */}
      <OSSection tone="ink" id="relief-form">
        <div className="vcf-form-wrap">
          {submitted ? (
            <div className="vcf-card vcf-success">
              <CheckCircleIcon className="vcf-success-ico" />
              <h2 className="vcf-success-h">We&rsquo;ve got it, {form.contact_first_name}.</h2>
              <p className="vcf-success-sub">
                A specialist will reach out to review your current advances and build a plan to lower your
                payments. No upfront fees, and the consultation is free.
              </p>
              <div className="vcf-pipeline">
                <p className="vcf-pipeline-label os-mono">HERE&rsquo;S WHAT HAPPENS NEXT</p>
                <PipelineFlow pipeline="vcf" currentKey="new_distressed" />
              </div>
              <Link to="/" className="vcf-back">← Back to home</Link>
            </div>
          ) : (
            <>
              <div className="money-secthead" style={{ margin: "0 auto 28px", textAlign: "center" }}>
                <Eyebrow>FREE RELIEF REVIEW</Eyebrow>
                <Display>START YOUR <span className="os-go">REVIEW.</span></Display>
                <p className="vcf-sect-sub">
                  Tell us your situation. It&rsquo;s confidential, judgment-free, and there&rsquo;s no obligation.
                  Our team responds within 24 hours.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="vcf-card">
                <div className="vcf-grid">
                  <label className="vcf-field"><span className="vcf-label">Business name</span>
                    <input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">First name *</span>
                    <input required value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">Last name</span>
                    <input value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">Email *</span>
                    <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">Phone *</span>
                    <input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label"># of active advances (MCAs)</span>
                    <input value={form.active_positions} onChange={(e) => set("active_positions", e.target.value)} placeholder="e.g. 3" className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">Total balance owed</span>
                    <input value={form.total_balance} onChange={(e) => set("total_balance", e.target.value)} placeholder="$" className="vcf-input" /></label>
                  <label className="vcf-field"><span className="vcf-label">Combined daily/weekly payment</span>
                    <input value={form.daily_debit} onChange={(e) => set("daily_debit", e.target.value)} placeholder="$" className="vcf-input" /></label>
                  <label className="vcf-field vcf-field-full"><span className="vcf-label">Who are your current funders?</span>
                    <input value={form.current_funders} onChange={(e) => set("current_funders", e.target.value)} className="vcf-input" /></label>
                  <label className="vcf-field vcf-field-full"><span className="vcf-label">What&rsquo;s making the payments hard right now?</span>
                    <textarea value={form.hardship_reason} onChange={(e) => set("hardship_reason", e.target.value)} className="vcf-input vcf-textarea" /></label>
                </div>

                <TcpaConsent checked={consent} onChange={setConsent} />

                {error && <p className="vcf-error">{error}</p>}
                <button type="submit" disabled={submitting || !consent} className="os-cta-primary vcf-submit">
                  {submitting ? "Submitting…" : "Get my free relief review"} {!submitting && <span aria-hidden>→</span>}
                </button>
                <p className="vcf-compliance">
                  <ShieldCheckIcon className="vcf-compliance-ico" />
                  Free consultation, no upfront fees. Debt-relief programs restructure or refinance your existing
                  advances; not all businesses qualify, and results vary by situation.
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

const VCF_CSS = `
.vcf-hero{max-width:44em}
.vcf-lede{font-size:18px;line-height:1.6;color:var(--lede);margin:0 0 22px;max-width:38em}
.vcf-trust{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:26px}
.vcf-chip-check{color:var(--go-text);font-weight:700}
.vcf-hero-cta{display:flex}

.vcf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;text-align:center}
.vcf-stat{border:1px solid var(--hair);border-radius:12px;padding:22px 14px;background:linear-gradient(180deg,var(--panel),var(--panel2))}
.vcf-stat-v{font-family:'Anton',sans-serif;font-weight:400;font-size:clamp(24px,2.6vw,32px);color:var(--go-text);margin:0;line-height:1;text-shadow:0 0 34px rgba(22,217,146,.22)}
.vcf-stat-k{font-size:12.5px;line-height:1.4;color:var(--muted);margin:10px 0 0}
.vcf-disclaimer{font-size:11px;line-height:1.7;color:var(--faint);max-width:56em;margin:22px auto 0;text-align:center}

.vcf-sect-sub{font-size:16px;line-height:1.6;color:var(--lede);max-width:38em;margin:16px auto 0}

.vcf-prog-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:1000px;margin:0 auto}
.vcf-prog{display:flex;flex-direction:column;padding:28px}
.vcf-prog-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.vcf-prog-ico{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;color:var(--go-text);background:rgba(22,217,146,.08);border:1px solid rgba(22,217,146,.22)}
.vcf-prog-svg{width:23px;height:23px}
.vcf-prog-tag{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--go-text);border:1px solid rgba(22,217,146,.3);border-radius:999px;padding:5px 11px;background:rgba(22,217,146,.06)}
.vcf-prog-title{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:23px;line-height:1.04;color:var(--tx);margin:0 0 10px;letter-spacing:.01em}
.vcf-prog-blurb{font-size:15px;line-height:1.6;color:var(--muted);margin:0 0 20px}
.vcf-prog-points{list-style:none;margin:0 0 20px;padding:0;display:flex;flex-direction:column;gap:11px}
.vcf-prog-points li{display:flex;gap:11px;font-size:14.5px;line-height:1.5;color:var(--lede)}
.vcf-prog-foot{margin:auto 0 0;padding-top:18px;border-top:1px solid var(--hair);font-size:13px;line-height:1.6;color:var(--muted)}

.vcf-why-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.vcf-why{display:flex;flex-direction:column}
.vcf-why-ico{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;color:var(--go-text);background:rgba(22,217,146,.08);border:1px solid rgba(22,217,146,.22)}
.vcf-why-svg{width:21px;height:21px}
.vcf-why-title{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:17px;color:var(--tx);margin:0 0 9px;letter-spacing:.01em}
.vcf-why-body{font-size:14px;line-height:1.6;color:var(--muted);margin:0}

.vcf-form-wrap{max-width:680px;margin:0 auto}
.vcf-card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);border-radius:16px;padding:28px;box-shadow:0 30px 60px -34px var(--shadow)}
.vcf-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.vcf-field{display:flex;flex-direction:column}
.vcf-field-full{grid-column:1 / -1}
.vcf-label{font-size:12px;letter-spacing:.02em;color:var(--muted);font-weight:500;margin-bottom:6px}
.vcf-input{width:100%;padding:11px 13px;border-radius:9px;border:1px solid var(--hair);background:var(--ink2);color:var(--tx);font-size:14px;font-family:'Inter',sans-serif;outline:none;transition:border-color .15s}
.vcf-input:focus{border-color:var(--go)}
.vcf-textarea{min-height:88px;resize:vertical}
.vcf-error{font-size:13px;color:#ef4444;margin:14px 0 0}
.vcf-submit{width:100%;justify-content:center;margin-top:18px;font-size:15px}
.vcf-submit:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.vcf-compliance{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.6;color:var(--faint);margin:14px 0 0}
.vcf-compliance-ico{width:15px;height:15px;flex:0 0 auto;margin-top:1px;color:var(--go-text)}

.vcf-success{text-align:center}
.vcf-success-ico{width:56px;height:56px;color:var(--go-text);margin:0 auto 14px}
.vcf-success-h{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:28px;color:var(--tx);margin:0 0 10px;letter-spacing:.01em}
.vcf-success-sub{font-size:15px;line-height:1.65;color:var(--lede);max-width:40em;margin:0 auto}
.vcf-pipeline{margin-top:26px;text-align:left}
.vcf-pipeline-label{font-size:11px;letter-spacing:.14em;color:var(--faint);text-align:center;margin-bottom:12px}
.vcf-back{display:inline-block;margin-top:22px;color:var(--go-text);text-decoration:none;font-size:14px}

@media (max-width:820px){.vcf-stats{grid-template-columns:1fr 1fr}.vcf-why-grid{grid-template-columns:1fr 1fr}}
@media (max-width:680px){.vcf-prog-grid{grid-template-columns:1fr}}
@media (max-width:560px){.vcf-grid{grid-template-columns:1fr}.vcf-why-grid{grid-template-columns:1fr}}
`;
