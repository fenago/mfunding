// TermsOfServicePage — restyled to the Momentum OS design. Legal copy is VERBATIM;
// only presentation (typography/layout) changed. Shell + reading styles live in
// OSLegalShell; the text below is unchanged from the prior version.
import SEO from '../components/seo/SEO';
import { OSLegalShell, LegalSection, LegalP, LegalList } from '../components/landing/os/content/OSLegalShell';

export default function TermsOfServicePage() {
  return (
    <>
      <SEO title="Terms of Service" description="Momentum Funding terms of service." />
      <OSLegalShell
        eyebrow="LEGAL · TERMS"
        title="Terms of Service"
        lastUpdated={<>Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>}
      >
        <LegalSection heading="Agreement to Terms">
          <LegalP>
            These services and the Momentum Funding brand are provided by <strong>Agentic Voice Inc.</strong> (d/b/a Momentum Funding). By accessing or using Momentum Funding's services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Eligibility">
          <LegalP>To apply for funding through Momentum Funding, you must:</LegalP>
          <LegalList>
            <li>Be at least 18 years of age</li>
            <li>Be a legal owner or authorized representative of the business</li>
            <li>Have a business operating in the United States</li>
            <li>Provide accurate and truthful information in your application</li>
          </LegalList>
        </LegalSection>

        <LegalSection heading="Application Process">
          <LegalP>
            Submitting an application does not guarantee approval. All applications are subject to review and verification. Momentum Funding reserves the right to request additional documentation and to approve or deny applications at its sole discretion.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Funding Terms">
          <LegalP>
            If approved, specific funding terms including amounts, repayment schedules, and fees will be provided in a separate agreement. Terms may vary based on business qualifications and the type of funding product selected.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Limitation of Liability">
          <LegalP>
            Momentum Funding shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of our services or inability to obtain funding.
          </LegalP>
        </LegalSection>

        <LegalSection heading="Contact">
          <LegalP>
            For questions about these Terms of Service, please contact us through our application form.
          </LegalP>
        </LegalSection>
      </OSLegalShell>
    </>
  );
}
