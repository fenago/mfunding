// ContactPage — restyled to the "Momentum OS" dispatch-board design. The form and
// its submission path (contact-intake edge function → GHL) are UNCHANGED; only the
// presentation was reskinned to the OS system.
import { useState } from "react";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from "../components/seo/SEO";
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede, CTAPrimary } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";
import supabase from "../supabase";

const contactInfo = [
  { label: "PHONE", value: "(954) 737-5692", href: "tel:+19547375692", description: "Mon–Fri · 9am–6pm EST" },
  { label: "EMAIL", value: "sales@send.mfunding.net", href: "mailto:sales@send.mfunding.net", description: "We respond within 24 hours" },
  { label: "OFFICE", value: "7027 W Broward Blvd, Suite 744", href: null, description: "Plantation, FL 33317" },
  { label: "HOURS", value: "Mon – Fri · 9am – 6pm", href: null, description: "Eastern Standard Time" },
];

export default function ContactPage() {
  useOSFonts();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Route through the contact-intake function: it records the message AND pushes
    // the inquiry into GHL. We only show success if the message was actually saved.
    const { data, error: submitError } = await supabase.functions.invoke("contact-intake", {
      body: {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || null,
        subject: formData.subject,
        message: formData.message,
      },
    });

    setIsSubmitting(false);

    if (submitError || !data?.ok) {
      console.error("Contact form submission error:", submitError || data);
      setError(
        "Sorry — we couldn't send your message. Please call us at (954) 737-5692 or email sales@send.mfunding.net."
      );
      return;
    }

    setIsSubmitted(true);
  };

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{CONTACT_CSS}</style>
      <SEO title="Contact Us — Talk to a Funding Advisor" description="Contact Momentum Funding to discuss business funding options. Call (954) 737-5692 or email sales@send.mfunding.net. Mon–Fri, 9am–6pm EST. No upfront fees, no obligation." keywords="contact momentum funding, business funding advisor, talk to funding specialist" />
      <ScrollToTop />
      <OSNav />

      <OSSection tone="ink">
        <div className="ct-head">
          <Eyebrow>GET IN TOUCH</Eyebrow>
          <Display>
            WE'RE HERE<br /><span className="os-go">TO HELP.</span>
          </Display>
          <Lede>
            Question about funding? Need help with an application? Our team is ready to get you the{" "}
            <strong>capital your business needs.</strong>
          </Lede>
        </div>

        <div className="ct-grid">
          {/* Left: contact channels */}
          <div className="ct-left">
            <div className="ct-boardtop">
              <span>DIRECT LINES</span>
              <span className="ct-boardnote">NO UPFRONT FEES</span>
            </div>
            <div className="ct-channels" role="list">
              {contactInfo.map((item) => (
                <div className="ct-channel" role="listitem" key={item.label}>
                  <span className="ct-channel-label">{item.label}</span>
                  {item.href ? (
                    <a href={item.href} className="ct-channel-val ct-link">{item.value}</a>
                  ) : (
                    <span className="ct-channel-val">{item.value}</span>
                  )}
                  <span className="ct-channel-desc">{item.description}</span>
                </div>
              ))}
            </div>

            <div className="ct-apply">
              <p className="ct-apply-title">READY TO APPLY?</p>
              <p className="ct-apply-body">
                Skip the wait. Apply in 5 minutes and get funding options within 24 hours.
              </p>
              <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            </div>
          </div>

          {/* Right: message form */}
          <div className="ct-right">
            {isSubmitted ? (
              <div className="ct-formcard ct-success">
                <span className="ct-success-mark" aria-hidden>✓</span>
                <h3 className="ct-success-title">MESSAGE SENT</h3>
                <p className="ct-success-body">
                  Thanks for reaching out. Our team will get back to you within one business day.
                </p>
                <a href="/" className="ct-backlink">← Back to home</a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="ct-formcard">
                <h3 className="ct-form-title">SEND US A MESSAGE</h3>
                <div className="ct-row2">
                  <label className="ct-field">
                    <span className="ct-flabel">Full name *</span>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} required className="ct-input" placeholder="John Smith" />
                  </label>
                  <label className="ct-field">
                    <span className="ct-flabel">Email address *</span>
                    <input type="email" name="email" value={formData.email} onChange={handleChange} required className="ct-input" placeholder="john@business.com" />
                  </label>
                </div>
                <div className="ct-row2">
                  <label className="ct-field">
                    <span className="ct-flabel">Phone number</span>
                    <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="ct-input" placeholder="(555) 123-4567" />
                  </label>
                  <label className="ct-field">
                    <span className="ct-flabel">Subject *</span>
                    <select name="subject" value={formData.subject} onChange={handleChange} required className="ct-input ct-select">
                      <option value="">Select a topic</option>
                      <option value="General Inquiry">General Inquiry</option>
                      <option value="Funding Question">Funding Question</option>
                      <option value="Application Status">Application Status</option>
                      <option value="Partnership">Partnership Opportunity</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                </div>
                <label className="ct-field">
                  <span className="ct-flabel">Message *</span>
                  <textarea name="message" value={formData.message} onChange={handleChange} required rows={5} className="ct-input ct-textarea" placeholder="How can we help you?" />
                </label>

                {error && <div className="ct-error">{error}</div>}

                <button type="submit" className="ct-submit" disabled={isSubmitting}>
                  {isSubmitting ? "Sending…" : "Send message"}
                  <span aria-hidden>→</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </OSSection>

      <OSFooter />
    </div>
  );
}

const CONTACT_CSS = `
.ct-head{max-width:42em;margin-bottom:44px}
.ct-grid{display:grid;grid-template-columns:5fr 7fr;gap:40px;align-items:start}

.ct-boardtop{display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding:0 2px 12px;border-bottom:1px solid var(--hair);margin-bottom:2px}
.ct-boardnote{color:var(--faint)}
.ct-channels{display:grid;gap:1px;background:var(--hair);border:1px solid var(--hair);border-top:none}
.ct-channel{background:linear-gradient(180deg,var(--panel),var(--panel2));padding:18px 20px;display:flex;flex-direction:column;gap:3px}
.ct-channel-label{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--faint)}
.ct-channel-val{font-size:16px;font-weight:600;color:var(--tx)}
.ct-link{text-decoration:none;transition:color .15s}
.ct-link:hover{color:var(--go-text)}
.ct-channel-desc{font-family:'Space Mono',monospace;font-size:12px;color:var(--muted)}

.ct-apply{margin-top:20px;border:1px solid rgba(22,217,146,.28);border-radius:14px;
  background:rgba(22,217,146,.05);padding:22px}
.ct-apply-title{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.1em;color:var(--tx);margin:0 0 8px}
.ct-apply-body{font-size:14.5px;line-height:1.5;color:var(--lede);margin:0 0 18px}

/* form */
.ct-formcard{background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair);border-radius:16px;padding:30px}
.ct-form-title{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;letter-spacing:.1em;color:var(--tx);margin:0 0 22px}
.ct-row2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.ct-field{display:flex;flex-direction:column;gap:7px;margin-bottom:0}
.ct-flabel{font-size:13px;font-weight:500;color:var(--muted)}
.ct-input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--hair);
  background:var(--ink2);color:var(--tx);font-size:15px;font-family:'Inter',sans-serif;
  transition:border-color .15s,box-shadow .15s;outline:none}
.ct-input::placeholder{color:var(--faint)}
.ct-input:focus{border-color:var(--go-text);box-shadow:0 0 0 3px rgba(22,217,146,.12)}
.ct-textarea{resize:vertical;min-height:120px}
.ct-select{appearance:none;cursor:pointer;
  background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%238695A6' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position:right .8rem center;background-repeat:no-repeat;background-size:1.2em 1.2em;padding-right:2.4rem}
.ct-error{padding:14px 16px;border-radius:10px;background:rgba(220,38,38,.08);
  border:1px solid rgba(220,38,38,.32);color:#e0554f;font-size:14px;margin-bottom:16px}
.ct-submit{width:100%;margin-top:6px;background:var(--go);color:var(--on-green);font-weight:700;
  font-size:15px;padding:15px 24px;border:none;border-radius:10px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:10px;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5);transition:transform .15s,box-shadow .15s}
.ct-submit:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
.ct-submit:disabled{opacity:.65;cursor:not-allowed}

/* success */
.ct-success{text-align:center;padding:52px 30px}
.ct-success-mark{display:inline-grid;place-items:center;width:60px;height:60px;border-radius:50%;
  background:var(--go);color:var(--on-green);font-size:28px;font-weight:700;margin-bottom:22px}
.ct-success-title{font-family:'Anton',sans-serif;font-size:26px;letter-spacing:.01em;color:var(--tx);margin:0 0 12px}
.ct-success-body{font-size:15px;line-height:1.55;color:var(--lede);margin:0 0 20px;max-width:30em;margin-inline:auto}
.ct-backlink{color:var(--go-text);text-decoration:none;font-weight:600;font-size:14px}
.ct-backlink:hover{text-decoration:underline}

@media (max-width:920px){
  .ct-grid{grid-template-columns:1fr;gap:28px}
}
@media (max-width:560px){
  .ct-row2{grid-template-columns:1fr}
  .ct-boardtop{flex-direction:column;align-items:flex-start;gap:4px}
}
`;
