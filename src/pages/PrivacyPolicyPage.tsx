import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import Logo from '../components/ui/Logo';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-midnight-blue">
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
            &copy; {new Date().getFullYear()} Momentum Funding. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
