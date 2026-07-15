import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import Logo from '../components/ui/Logo';
import SEO from '../components/seo/SEO';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-midnight-blue">
      <SEO title="Privacy Policy" description="Momentum Funding privacy policy — how we collect, use, and protect your information." />
      {/* Header */}
      <header className="bg-midnight-blue py-6">
        <div className="container-max flex items-center justify-between">
          <Link to="/">
            <Logo variant="full" size="md" theme="dark" />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container-max py-16 lg:py-24">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-midnight-blue dark:text-white mb-8">
            Privacy Policy
          </h1>

          <div className="prose prose-lg dark:prose-invert max-w-none">
            <p className="text-text-secondary dark:text-white/70 text-lg mb-8">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>

            <p className="text-text-secondary dark:text-white/70 mb-8">
              This website (mfunding.net) and the Momentum Funding brand are operated by{' '}
              <strong>Agentic Voice Inc.</strong> (d/b/a Momentum Funding). In this policy, &ldquo;we,&rdquo;
              &ldquo;us,&rdquo; and &ldquo;Momentum Funding&rdquo; refer to Agentic Voice Inc.
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Information We Collect
              </h2>
              <p className="text-text-secondary dark:text-white/70 mb-4">
                When you apply for funding through Momentum Funding, we collect information necessary to process your application, including:
              </p>
              <ul className="list-disc pl-6 text-text-secondary dark:text-white/70 space-y-2">
                <li>Business name and contact information</li>
                <li>Personal information (name, email, phone number)</li>
                <li>Business financial information (revenue, time in business)</li>
                <li>EIN (if provided)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                How We Use Your Information
              </h2>
              <p className="text-text-secondary dark:text-white/70 mb-4">
                We use the information we collect to:
              </p>
              <ul className="list-disc pl-6 text-text-secondary dark:text-white/70 space-y-2">
                <li>Process and evaluate your funding application</li>
                <li>Communicate with you about your application status</li>
                <li>Provide customer support</li>
                <li>Improve our services</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                SMS / Text Messaging
              </h2>
              <p className="text-text-secondary dark:text-white/70 mb-4">
                If you provide your mobile number and give consent, Agentic Voice Inc. (d/b/a Momentum
                Funding) may send you SMS/text messages about your funding request — such as application
                updates, document requests, appointment reminders, and related funding offers.
              </p>
              <ul className="list-disc pl-6 text-text-secondary dark:text-white/70 space-y-2">
                <li>Consenting to receive text messages is <strong>not a condition</strong> of applying for or receiving funding.</li>
                <li>Message frequency varies. Message and data rates may apply.</li>
                <li>You can opt out at any time by replying <strong>STOP</strong>; reply <strong>HELP</strong> for help.</li>
                <li>
                  <strong>
                    We do not sell, rent, or share your mobile phone number or SMS opt-in information with any
                    third parties or affiliates for their own marketing or promotional purposes.
                  </strong>
                </li>
              </ul>
              <p className="text-text-secondary dark:text-white/70 mt-4">
                To submit your application to funders on your behalf, we share the business and application
                details you provide with our funding partners — a service you request by applying. Your mobile
                number and text-messaging consent, however, are used only by us to communicate with you and are
                never shared with third parties for their marketing.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Information Security
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                We implement industry-standard security measures to protect your personal and business information. All data is encrypted in transit and at rest. We never sell your information to third parties.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Contact Us
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                If you have questions about this Privacy Policy, please contact us through our application form or reach out to our support team.
              </p>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-midnight-blue py-8 mt-auto">
        <div className="container-max text-center">
          <p className="text-white/40 text-sm">
            &copy; {new Date().getFullYear()} Agentic Voice Inc. d/b/a Momentum Funding. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
