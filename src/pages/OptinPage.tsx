import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import supabase from '../supabase';
import SmsConsentCheckbox from '../components/ui/SmsConsentCheckbox';
import { recordConsent, SMS_ACCOUNT_CONSENT_TEXT, SMS_MARKETING_CONSENT_TEXT } from '../lib/consent';
import { OSSection, Eyebrow, Display, Lede } from '../components/landing/os/OSKit';
import { ToolShell, ToolPanel, Field } from '../components/landing/os/tools/ToolsKit';

export default function OptinPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  // Toll-free / A2P 10DLC compliance: a SEPARATE opt-in per message use case.
  const [agreedAccount, setAgreedAccount] = useState(false);   // account/customer-care texts
  const [agreedMarketing, setAgreedMarketing] = useState(false); // marketing/promotional texts
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedAccount && !agreedMarketing) {
      setError("Please check at least one consent option to opt in.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Persist each opt-in SEPARATELY — one durable proof row per use case, storing
    // the exact wording the user saw for that message type.
    if (agreedAccount) {
      await recordConsent({
        name: formData.name, email: formData.email, phone: formData.phone,
        source: "optin:account", page: "/optin", consentText: SMS_ACCOUNT_CONSENT_TEXT,
      });
    }
    if (agreedMarketing) {
      await recordConsent({
        name: formData.name, email: formData.email, phone: formData.phone,
        source: "optin:marketing", page: "/optin", consentText: SMS_MARKETING_CONSENT_TEXT,
      });
    }

    // Route through contact-intake so the opt-in becomes a real GHL contact tagged
    // per use case — i.e. it actually REACHES the right SMS automations.
    const { data, error: submitError } = await supabase.functions.invoke('contact-intake', {
      body: {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        subject: 'Communication Opt-In',
        message: `SMS opt-in — account: ${agreedAccount ? 'yes' : 'no'}, marketing: ${agreedMarketing ? 'yes' : 'no'}.`,
        tcpa_consent: agreedAccount,
        sms_account_consent: agreedAccount,
        sms_marketing_consent: agreedMarketing,
      },
    });

    setIsSubmitting(false);

    if (submitError || !data?.ok) {
      console.error('Opt-in submission error:', submitError || data);
      setError("Sorry — we couldn't complete your opt-in. Please try again or call (954) 737-5692.");
      return;
    }

    setIsSubmitted(true);
  };

  return (
    <ToolShell>
      <SEO title="Get Funding Updates" description="Opt in for business funding updates from Momentum Funding." noIndex={true} />

      <OSSection tone="panel">
        <div className="ost-optin">
          <ToolPanel>
            {isSubmitted ? (
              <div className="ost-optin-done">
                <div className="ost-optin-badge">
                  <CheckCircleIcon />
                </div>
                <Display>You're on the list.</Display>
                <Lede>
                  You've successfully opted in to receive communications from Momentum Funding. We
                  look forward to connecting with you.
                </Lede>
                <Link to="/" className="os-cta-ghost">Return to homepage</Link>
              </div>
            ) : (
              <>
                <div className="ost-optin-head">
                  <Eyebrow>STAY CONNECTED</Eyebrow>
                  <Display>
                    FUNDING UPDATES, <span className="os-go">STRAIGHT TO YOU.</span>
                  </Display>
                  <Lede>
                    Opt in to receive important funding updates, exclusive offers, and expert advice
                    directly to your phone.
                  </Lede>
                </div>

                <form onSubmit={handleSubmit} className="ost-fullform">
                  <Field
                    label="Full name *"
                    id="name"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                  />
                  <div className="ost-formgrid">
                    <Field
                      label="Email address *"
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="john@example.com"
                    />
                    <Field
                      label="Mobile phone number *"
                      id="phone"
                      name="phone"
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 mt-2">
                    Choose which text messages you want. Each is a separate opt-in.
                  </p>
                  <div className="flex flex-col gap-3">
                    <SmsConsentCheckbox
                      id="sms-account"
                      title="Account &amp; application updates"
                      checked={agreedAccount}
                      onChange={setAgreedAccount}
                      description={
                        <>Texts about <strong>your funding request</strong> — application status,
                        document and verification requests, and account/customer-care updates.</>
                      }
                    />
                    <SmsConsentCheckbox
                      id="sms-marketing"
                      title="Offers &amp; promotions"
                      optional
                      checked={agreedMarketing}
                      onChange={setAgreedMarketing}
                      description={
                        <>Marketing texts with <strong>special offers, promotions, and funding
                        tips</strong>.</>
                      }
                    />
                  </div>

                  {error && <p className="ost-err">{error}</p>}

                  <button
                    type="submit"
                    className="os-cta-primary ost-submit"
                    disabled={isSubmitting || (!agreedAccount && !agreedMarketing)}
                  >
                    {isSubmitting ? 'Processing…' : 'Subscribe & opt in →'}
                  </button>
                </form>
              </>
            )}
          </ToolPanel>
        </div>
      </OSSection>
    </ToolShell>
  );
}
