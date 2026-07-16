// PrivacyPolicyPage — restyled to the Momentum OS design. Legal copy is VERBATIM;
// only presentation (typography/layout) changed. Shell + reading styles live in
// OSLegalShell; the text below is unchanged from the prior version.
import SEO from '../components/seo/SEO';
import { OSLegalShell, LegalSection, LegalP, LegalList } from '../components/landing/os/content/OSLegalShell';

export default function PrivacyPolicyPage() {
  return (
    <>
      <SEO title="Privacy Policy" description="Momentum Funding privacy policy — how we collect, use, and protect your information." />
      <OSLegalShell
        eyebrow="LEGAL · PRIVACY"
        title="Privacy Policy"
        lastUpdated={<>Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>}
      >
        <p className="oslegal-intro">
          This website (mfunding.net) and the Momentum Funding brand are operated by{' '}
          <strong>Agentic Voice Inc.</strong> (d/b/a Momentum Funding). In this policy, &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; and &ldquo;Momentum Funding&rdquo; refer to Agentic Voice Inc.
        </p>

        <LegalSection heading="Information We Collect">
          <LegalP>
            When you apply for funding through Momentum Funding, we collect information necessary to process your application, including:
          </LegalP>
          <LegalList>
            <li>Business name and contact information</li>
            <li>Personal information (name, email, phone number)</li>
            <li>Business financial information (revenue, time in business)</li>
            <li>EIN (if provided)</li>
          </LegalList>
        </LegalSection>

        <LegalSection heading="How We Use Your Information">
          <LegalP>We use the information we collect to:</LegalP>
          <LegalList>
            <li>Process and evaluate your funding application</li>
            <li>Communicate with you about your application status</li>
            <li>Provide customer support</li>
            <li>Improve our services</li>
          </LegalList>
        </LegalSection>

        <LegalSection heading="SMS / Text Messaging">
          <LegalP>
            If you provide your mobile number and give consent, Agentic Voice Inc. (d/b/a Momentum
            Funding) may send you SMS/text messages about your funding request — such as application
            updates, document requests, appointment reminders, and related funding offers.
          </LegalP>
          <LegalList>
            <li>Consenting to receive text messages is <strong>not a condition</strong> of applying for or receiving funding.</li>
            <li>Message frequency varies. Message and data rates may apply.</li>
            <li>You can opt out at any time by replying <strong>STOP</strong>; reply <strong>HELP</strong> for help.</li>
            <li>
              <strong>
                We do not sell, rent, or share your mobile phone number or SMS opt-in information with any
                third parties or affiliates for their own marketing or promotional purposes.
              </strong>
            </li>
          </LegalList>
          <LegalP>
            To submit your application to funders on your behalf, we share the business and application
            details you provide with our funding partners — a service you request by applying. Your mobile
            number and text-messaging consent, however, are used only by us to communicate with you and are
            never shared with third parties for their marketing.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Information Security">
          <LegalP>
            We implement industry-standard security measures to protect your personal and business information. All data is encrypted in transit and at rest. We never sell your information to third parties.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Contact Us">
          <LegalP>
            If you have questions about this Privacy Policy, please contact us through our application form or reach out to our support team.
          </LegalP>
        </LegalSection>
      </OSLegalShell>
    </>
  );
}
