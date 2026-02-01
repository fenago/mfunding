import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import Logo from '../components/ui/Logo';

export default function TermsOfServicePage() {
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
            Terms of Service
          </h1>

          <div className="prose prose-lg dark:prose-invert max-w-none">
            <p className="text-text-secondary dark:text-white/70 text-lg mb-8">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Agreement to Terms
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                By accessing or using Momentum Funding's services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Eligibility
              </h2>
              <p className="text-text-secondary dark:text-white/70 mb-4">
                To apply for funding through Momentum Funding, you must:
              </p>
              <ul className="list-disc pl-6 text-text-secondary dark:text-white/70 space-y-2">
                <li>Be at least 18 years of age</li>
                <li>Be a legal owner or authorized representative of the business</li>
                <li>Have a business operating in the United States</li>
                <li>Provide accurate and truthful information in your application</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Application Process
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                Submitting an application does not guarantee approval. All applications are subject to review and verification. Momentum Funding reserves the right to request additional documentation and to approve or deny applications at its sole discretion.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Funding Terms
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                If approved, specific funding terms including amounts, repayment schedules, and fees will be provided in a separate agreement. Terms may vary based on business qualifications and the type of funding product selected.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Limitation of Liability
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                Momentum Funding shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of our services or inability to obtain funding.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-midnight-blue dark:text-white mb-4">
                Contact
              </h2>
              <p className="text-text-secondary dark:text-white/70">
                For questions about these Terms of Service, please contact us through our application form.
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
