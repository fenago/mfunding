// PartnersPage — restyled to the "Momentum OS" dispatch-board design. The referral
// signup form and its submission path (partner-signup edge function) are UNCHANGED;
// only the presentation was reskinned to the OS system.
import { useState } from "react";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from "../components/seo/SEO";
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";
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
  { code: "01", title: "$100 per funded deal", body: "Earn a gift card for every referral we fund — no cap." },
  { code: "02", title: "We do the work", body: "Send the intro; our team handles qualifying, packaging, and closing." },
  { code: "03", title: "Your clients, cared for", body: "Fast, transparent funding that reflects well on you." },
];

interface FormState { name: string; company: string; partner_type: string; email: string; phone: string; notes: string }
const EMPTY: FormState = { name: "", company: "", partner_type: "cpa", email: "", phone: "", notes: "" };

export default function PartnersPage() {
  useOSFonts();
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

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{PARTNERS_CSS}</style>
      <SEO title="Referral Partner Program — Earn Per Funded Deal" description="CPAs, bookkeepers, real estate agents and vendors: refer clients who need capital and earn $100 per funded deal. Join the Momentum Funding referral partner program." keywords="funding referral partner program, ISO partner program, refer clients for business funding, earn referral commission" />
      <ScrollToTop />
      <OSNav />
      <OSSection tone="ink">
          {submitted ? (
            <div className="pt-success">
              <span className="pt-success-mark" aria-hidden>✓</span>
              <h1 className="pt-success-title">THANKS, {form.name.split(" ")[0]?.toUpperCase()}.</h1>
              <p className="pt-success-body">
                We'll review your application and reach out to get you set up as a referral partner.
              </p>
              <a href="/" className="pt-backlink">← Back to home</a>
            </div>
          ) : (
            <div className="pt-wrap">
              <div className="pt-head">
                <Eyebrow>REFERRAL PARTNERS</Eyebrow>
                <Display>
                  SEND THE INTRO.<br /><span className="os-go">EARN THE CHECK.</span>
                </Display>
                <Lede>
                  CPAs, bookkeepers, RE agents, and vendors: send us clients who need capital and{" "}
                  <strong>earn for every funded deal.</strong>
                </Lede>
              </div>

              <div className="pt-perks">
                {PERKS.map((p) => (
                  <div className="pt-perk" key={p.code}>
                    <span className="pt-perk-code">{p.code}</span>
                    <p className="pt-perk-title">{p.title}</p>
                    <p className="pt-perk-body">{p.body}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="pt-formcard">
                <h2 className="pt-form-title">APPLY TO PARTNER</h2>
                <div className="pt-row2">
                  <label className="pt-field">
                    <span className="pt-flabel">Your name *</span>
                    <input required value={form.name} onChange={(e) => set("name", e.target.value)} className="pt-input" />
                  </label>
                  <label className="pt-field">
                    <span className="pt-flabel">Company</span>
                    <input value={form.company} onChange={(e) => set("company", e.target.value)} className="pt-input" />
                  </label>
                  <label className="pt-field">
                    <span className="pt-flabel">Email *</span>
                    <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="pt-input" />
                  </label>
                  <label className="pt-field">
                    <span className="pt-flabel">Phone</span>
                    <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="pt-input" />
                  </label>
                  <label className="pt-field pt-span2">
                    <span className="pt-flabel">I'm a…</span>
                    <select value={form.partner_type} onChange={(e) => set("partner_type", e.target.value)} className="pt-input pt-select">
                      {PARTNER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="pt-field pt-span2">
                    <span className="pt-flabel">Anything else?</span>
                    <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="pt-input pt-textarea" />
                  </label>
                </div>
                {error && <p className="pt-error">{error}</p>}
                <button type="submit" disabled={submitting} className="pt-submit">
                  {submitting ? "Submitting…" : "Apply to partner"}
                  <span aria-hidden>→</span>
                </button>
              </form>

              <p className="pt-fine os-mono">
                MFunding is a brand of Agentic Voice Inc. Referral compensation is paid on funded deals only.
              </p>
            </div>
          )}
      </OSSection>
      <OSFooter />
    </div>
  );
}

const PARTNERS_CSS = `
.pt-wrap{max-width:720px;margin:0 auto}
.pt-head{text-align:center;margin-bottom:36px}
.pt-head .os-eyebrow,.pt-head .os-lede{margin-inline:auto}
.pt-head .os-lede{max-width:40em}

.pt-perks{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:26px}
.pt-perk{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:14px;padding:22px 20px}
.pt-perk-code{font-family:'Anton',sans-serif;font-size:28px;line-height:1;color:var(--go-text);
  text-shadow:0 0 30px rgba(22,217,146,.22)}
.pt-perk-title{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;letter-spacing:.03em;color:var(--tx);margin:14px 0 8px}
.pt-perk-body{font-size:13.5px;line-height:1.5;color:var(--lede);margin:0}

.pt-formcard{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:16px;padding:28px}
.pt-form-title{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;letter-spacing:.1em;color:var(--tx);margin:0 0 20px}
.pt-row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pt-field{display:flex;flex-direction:column;gap:7px}
.pt-span2{grid-column:1 / -1}
.pt-flabel{font-size:13px;font-weight:500;color:var(--muted)}
.pt-input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--hair);
  background:var(--ink2);color:var(--tx);font-size:15px;font-family:'Inter',sans-serif;
  transition:border-color .15s,box-shadow .15s;outline:none}
.pt-input::placeholder{color:var(--faint)}
.pt-input:focus{border-color:var(--go-text);box-shadow:0 0 0 3px rgba(22,217,146,.12)}
.pt-textarea{resize:vertical;min-height:80px}
.pt-select{appearance:none;cursor:pointer;
  background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%238695A6' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position:right .8rem center;background-repeat:no-repeat;background-size:1.2em 1.2em;padding-right:2.4rem}
.pt-error{color:#e0554f;font-size:14px;margin:16px 0 0}
.pt-submit{width:100%;margin-top:18px;background:var(--go);color:var(--on-green);font-weight:700;
  font-size:15px;padding:15px 24px;border:none;border-radius:10px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:10px;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5);transition:transform .15s,box-shadow .15s}
.pt-submit:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
.pt-submit:disabled{opacity:.65;cursor:not-allowed}
.pt-fine{text-align:center;font-size:12px;letter-spacing:.03em;color:var(--faint);margin:22px 0 0}

/* success */
.pt-success{text-align:center;max-width:520px;margin:0 auto;padding:40px 20px}
.pt-success-mark{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:50%;
  background:var(--go);color:var(--on-green);font-size:30px;font-weight:700;margin-bottom:22px}
.pt-success-title{font-family:'Anton',sans-serif;font-size:30px;letter-spacing:.01em;color:var(--tx);margin:0 0 12px}
.pt-success-body{font-size:16px;line-height:1.55;color:var(--lede);margin:0 0 20px}
.pt-backlink{color:var(--go-text);text-decoration:none;font-weight:600;font-size:14px}
.pt-backlink:hover{text-decoration:underline}

@media (max-width:640px){
  .pt-perks{grid-template-columns:1fr}
  .pt-row2{grid-template-columns:1fr}
}
`;
