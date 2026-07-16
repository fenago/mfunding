import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import supabase from '../supabase';
import TcpaConsent from '../components/ui/TcpaConsent';
import { recordConsent } from '../lib/consent';
import { OSSection, Eyebrow, Display, Lede } from '../components/landing/os/OSKit';
import { ToolShell, ToolPanel, Field } from '../components/landing/os/tools/ToolsKit';

export default function OptinPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [agreedToSms, setAgreedToSms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToSms) {
      setError("Please agree to the consent terms to proceed.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Persist the express-written consent (durable proof).
    await recordConsent({
      name: formData.name, email: formData.email, phone: formData.phone,
      source: "optin", page: "/optin",
    });

    // Route through contact-intake so the opt-in becomes a real GHL contact tagged
    // for SMS consent — i.e. it actually REACHES the SMS automation (audit #13).
    const { data, error: submitError } = await supabase.functions.invoke('contact-intake', {
      body: {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        subject: 'Communication Opt-In',
        message: 'User opted in to SMS and phone communication.',
        tcpa_consent: true,
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

                  <TcpaConsent checked={agreedToSms} onChange={setAgreedToSms} />

                  {error && <p className="ost-err">{error}</p>}

                  <button
                    type="submit"
                    className="os-cta-primary ost-submit"
                    disabled={isSubmitting || !agreedToSms}
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
