import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon } from '@heroicons/react/24/solid';
import Navbar from '../../components/landing/Navbar';
import Footer from '../../components/landing/Footer';
import ProductCard from '../../components/business-loans/ProductCard';
import ScrollToTop from '../../components/ui/ScrollToTop';
import SEO, { generateFAQSchema, generateBreadcrumbSchema } from '../../components/seo/SEO';
import { getAllProducts } from '../../data/products';

const HUB_FAQS = [
  {
    question: 'What types of business funding does Momentum Funding offer?',
    answer:
      'Momentum Funding offers six core products: merchant cash advances, business lines of credit, equipment financing, SBA 7(a) loans, business term loans, and startup loans. We match each business with the option that fits its revenue, time in business, and goals.',
  },
  {
    question: 'How fast can I get business funding?',
    answer:
      'Most business owners are approved within hours and funded within 24 to 48 hours. Merchant cash advances and lines of credit are the fastest; SBA loans take longer because of additional underwriting, but offer lower costs and larger amounts.',
  },
  {
    question: 'Can I qualify with bad credit?',
    answer:
      'Yes. For products like merchant cash advances we focus on your business revenue and cash flow rather than your personal credit score, so business owners with credit scores as low as 500 can qualify. Stronger credit unlocks lower-cost products like term loans and SBA loans.',
  },
  {
    question: 'Is a merchant cash advance a loan?',
    answer:
      'No. A merchant cash advance is not a loan — it is the purchase of a portion of your future receivables. You receive working capital today and repay it as a percentage of your daily or weekly sales, so payments flex with your revenue.',
  },
  {
    question: 'Will checking my options affect my credit score?',
    answer:
      'No. Checking your funding options uses a soft inquiry that does not impact your credit score. A hard pull only happens if you move forward with a formal funder submission, and we tell you before that happens.',
  },
];

export default function BusinessLoansHubPage() {
  const products = getAllProducts();

  return (
    <>
      <SEO
        title="Business Loans & Funding Options"
        description="Explore Momentum Funding's 6 business financing products: Merchant Cash Advance, Equipment Financing, Startup Loans, SBA 7(a) Loans, Term Loans, and Lines of Credit. Get funded in as little as 24 hours."
        keywords="business loans, merchant cash advance, equipment financing, SBA loans, business term loan, line of credit, small business funding, fast business loans"
        canonical="https://mfunding.net/business-loans"
        structuredData={[
          generateBreadcrumbSchema([
            { name: 'Home', url: 'https://mfunding.net/' },
            { name: 'Business Loans', url: 'https://mfunding.net/business-loans' },
          ]),
          generateFAQSchema(HUB_FAQS),
        ]}
      />
      <Navbar />
      <ScrollToTop />

      <main>
        {/* Hero Section */}
        <section className="relative bg-brand-gradient-hero overflow-hidden">
          {/* Decorative orbs */}
          <motion.div
            className="absolute top-20 right-[15%] w-80 h-80 bg-mint-green/15 rounded-full blur-3xl"
            animate={{
              y: [0, -40, 0],
              scale: [1, 1.15, 1],
            }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-10 left-[5%] w-96 h-96 bg-ocean-blue/15 rounded-full blur-3xl"
            animate={{
              y: [0, 30, 0],
              scale: [1, 0.9, 1],
            }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />

          <div className="container-max relative z-10 pt-32 pb-16 lg:pt-40 lg:pb-24">
            <motion.span
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-block px-4 py-2 bg-white/10 rounded-full text-mint-green text-sm font-medium mb-6"
            >
              6 Products, One Mission
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="heading-1 text-white mb-6 max-w-3xl"
            >
              Business{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
                Funding
              </span>{' '}
              That Fits Your Situation
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-white/80 mb-6 max-w-2xl"
            >
              Every business is different. Whether you need same-day cash, long-term growth capital, or a safety net for slow months — we have a solution built for you.
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-lg text-white/60 max-w-2xl"
            >
              No bank runarounds. No weeks of waiting. Just straightforward capital from people who understand your business.
            </motion.p>
          </div>
        </section>

        {/* Products Grid */}
        <section className="section-padding bg-white dark:bg-gray-900 relative overflow-hidden">
          {/* Background orb */}
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-mint-green/5 rounded-full blur-3xl"
            animate={{
              scale: [1, 1.1, 1],
            }}
            transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          />

          <div className="container-max relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <span className="inline-block px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-medium mb-4">
                Our Products
              </span>
              <h2 className="heading-2 text-gray-900 dark:text-white mb-4">
                Choose the Right{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
                  Funding
                </span>{' '}
                for Your Business
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                Click on any product below to see full details, calculate payments, and start your application.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {products.map((product, index) => (
                <ProductCard key={product.slug} product={product} index={index} />
              ))}
            </div>
          </div>
        </section>

        {/* SEO content + FAQ (answer-first for AEO / AI Overviews) */}
        <section className="section-padding bg-gray-50 dark:bg-gray-950">
          <div className="container-max max-w-4xl">
            <h2 className="heading-2 text-gray-900 dark:text-white mb-6">
              How to Choose the Right Business Funding
            </h2>
            <div className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300">
              <p>
                The best business funding depends on three things: how fast you need the capital, how
                much you need, and the strength of your credit and revenue. If you need money the same
                day and have steady card or bank deposits, a <Link to="/business-loans/merchant-cash-advance">merchant
                cash advance</Link> or <Link to="/business-loans/line-of-credit">business line of credit</Link>{' '}
                is usually fastest. If you want the lowest cost and can wait a few weeks, an{' '}
                <Link to="/business-loans/sba-loans">SBA 7(a) loan</Link> or{' '}
                <Link to="/business-loans/term-loans">business term loan</Link> is often the better fit.
                To buy machinery, vehicles, or equipment, <Link to="/business-loans/equipment-financing">equipment
                financing</Link> lets the equipment itself serve as collateral.
              </p>
              <p>
                Momentum Funding is a funding marketplace, not a single lender. We submit your profile to
                a network of funders and lenders, then present you the strongest offers — so you compare
                real options instead of taking the first quote. There are no upfront fees; we are paid by
                the funder when your deal closes. Already carrying advances and feeling the daily payments?
                Our <Link to="/debt-relief">MCA debt relief</Link> program can help you restructure.
              </p>
            </div>

            <h2 className="heading-2 text-gray-900 dark:text-white mt-14 mb-6">
              Compare Business Funding Options
            </h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Speed</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Credit Needed</th>
                    <th className="px-4 py-3 font-semibold">Best For</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-gray-600 dark:text-gray-300">
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">Merchant Cash Advance</td>
                    <td className="px-4 py-3">Same day–48 hrs</td>
                    <td className="px-4 py-3">$5K–$5M</td>
                    <td className="px-4 py-3">None (revenue-based)</td>
                    <td className="px-4 py-3">Fast cash, lower credit</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">Line of Credit</td>
                    <td className="px-4 py-3">1–3 days</td>
                    <td className="px-4 py-3">$10K–$1.25M</td>
                    <td className="px-4 py-3">Fair+</td>
                    <td className="px-4 py-3">Flexible, recurring needs</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">Equipment Financing</td>
                    <td className="px-4 py-3">2–5 days</td>
                    <td className="px-4 py-3">Up to $3M</td>
                    <td className="px-4 py-3">Fair+</td>
                    <td className="px-4 py-3">Buying equipment/vehicles</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">Term Loan</td>
                    <td className="px-4 py-3">2–7 days</td>
                    <td className="px-4 py-3">$25K–$500K</td>
                    <td className="px-4 py-3">Good</td>
                    <td className="px-4 py-3">Predictable growth capital</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">SBA 7(a) Loan</td>
                    <td className="px-4 py-3">2–6 weeks</td>
                    <td className="px-4 py-3">Up to $5M</td>
                    <td className="px-4 py-3">Good–Excellent</td>
                    <td className="px-4 py-3">Lowest cost, largest amounts</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
              New to these terms? See the <Link to="/resources/glossary" className="text-ocean-blue hover:underline">business funding glossary</Link>.
            </p>

            <h2 className="heading-2 text-gray-900 dark:text-white mt-14 mb-6">
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              {HUB_FAQS.map((f) => (
                <div key={f.question} className="border-b border-gray-200 dark:border-gray-800 pb-5">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{f.question}</h3>
                  <p className="mt-2 text-gray-600 dark:text-gray-300">{f.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section
          className="py-20 lg:py-28"
          style={{
            background: 'linear-gradient(135deg, #0A2342 0%, #0C516E 50%, #007EA7 100%)',
          }}
        >
          <div className="container-max text-center">
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="heading-2 text-white mb-4"
            >
              Not Sure Which Product Is Right for You?
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-xl text-white/70 mb-10 max-w-2xl mx-auto"
            >
              Apply once, and our team will match you with the best option based on your business profile. 5-minute application, no credit impact.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Link
                to="/apply"
                className="inline-flex items-center gap-2 bg-mint-green hover:bg-mint-green/90 text-midnight-blue font-bold text-lg px-10 py-4 rounded-xl transition-colors"
              >
                Apply Now — Free & No Obligation
                <ArrowRightIcon className="w-5 h-5" />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-wrap items-center justify-center gap-6 mt-8"
            >
              <span className="text-white/50 text-sm">5-Minute Application</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50 text-sm">Won't Affect Credit</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50 text-sm">24-Hour Decision</span>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
