import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon } from '@heroicons/react/24/solid';
import Navbar from '../../components/landing/Navbar';
import Footer from '../../components/landing/Footer';
import ScrollToTop from '../../components/ui/ScrollToTop';
import SEO from '../../components/seo/SEO';
import { getAllCREProducts } from '../../data/cre-products';

export default function RealEstateHubPage() {
  const products = getAllCREProducts();

  return (
    <>
      <SEO
        title="Commercial Real Estate Loans"
        description="Explore Momentum Funding's real estate financing: Hard Money Bridge Loans, Rental Investment Property Loans, Commercial Mortgages, and Ground Up Construction Loans. Close in as little as 2 weeks."
        keywords="commercial real estate loans, hard money bridge loan, rental property financing, commercial mortgage, construction loan, fix and flip loan, investment property loan, real estate financing"
      />
      <Navbar />
      <ScrollToTop />

      <main>
        {/* Hero Section */}
        <section className="relative bg-brand-gradient-hero overflow-hidden">
          <motion.div
            className="absolute top-20 right-[15%] w-80 h-80 bg-mint-green/15 rounded-full blur-3xl"
            animate={{ y: [0, -40, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-10 left-[5%] w-96 h-96 bg-ocean-blue/15 rounded-full blur-3xl"
            animate={{ y: [0, 30, 0], scale: [1, 0.9, 1] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />

          <div className="container-max relative z-10 pt-32 pb-16 lg:pt-40 lg:pb-24">
            <motion.span
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-block px-4 py-2 bg-white/10 rounded-full text-mint-green text-sm font-medium mb-6"
            >
              Commercial Real Estate
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="heading-1 text-white mb-6 max-w-3xl"
            >
              Real Estate{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
                Financing
              </span>{' '}
              That Closes When You Need It
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-white/80 mb-6 max-w-2xl"
            >
              From fix-and-flip bridge loans to long-term commercial mortgages — close in as little as 2 weeks with financing from $100K to $50M across all 50 states.
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-lg text-white/60 max-w-2xl"
            >
              Access an extensive network of 50+ private lenders through one application. We find the best terms and rates for your deal.
            </motion.p>
          </div>
        </section>

        {/* Products Grid */}
        <section className="section-padding bg-white dark:bg-gray-900 relative overflow-hidden">
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-mint-green/5 rounded-full blur-3xl"
            animate={{ scale: [1, 1.1, 1] }}
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
                Our Programs
              </span>
              <h2 className="heading-2 text-gray-900 dark:text-white mb-4">
                Choose the Right{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
                  Loan Program
                </span>{' '}
                for Your Deal
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                Click on any program below to see full details, estimate your financing, and start the application.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {products.map((product, index) => {
                const Icon = product.icon;
                return (
                  <motion.div
                    key={product.slug}
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <Link
                      to={`/real-estate/${product.slug}`}
                      className="group block bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 hover:border-mint-green/30 dark:hover:border-mint-green/30 transition-all duration-300 hover:shadow-xl hover:shadow-mint-green/5 h-full"
                    >
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
                        style={{ backgroundColor: `${product.color}15` }}
                      >
                        <Icon className="w-7 h-7" style={{ color: product.color }} />
                      </div>

                      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 group-hover:text-mint-green transition-colors">
                        {product.shortName}
                      </h3>

                      <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed mb-6">
                        {product.tagline}
                      </p>

                      <div className="space-y-2 mb-6">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500 dark:text-gray-400">Amount</span>
                          <span className="font-medium text-gray-900 dark:text-white">{product.hero.amountRange}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500 dark:text-gray-400">Time to Close</span>
                          <span className="font-medium text-gray-900 dark:text-white">{product.hero.approvalTime}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500 dark:text-gray-400">Rate</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {product.specs.find((s) => s.label.includes('Interest'))?.value || 'N/A'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-mint-green font-semibold text-sm group-hover:gap-3 transition-all">
                        Learn More
                        <ArrowRightIcon className="w-4 h-4" />
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
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
              Have a Deal? Let's Talk
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-xl text-white/70 mb-10 max-w-2xl mx-auto"
            >
              Submit your loan scenario and get a term sheet within 48 hours. No obligation, no credit impact.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Link
                to="/#apply"
                className="inline-flex items-center gap-2 bg-mint-green hover:bg-mint-green/90 text-midnight-blue font-bold text-lg px-10 py-4 rounded-xl transition-colors"
              >
                Submit Your Loan Scenario
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
              <span className="text-white/50 text-sm">All 50 States</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50 text-sm">$100K – $50M</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50 text-sm">Close in 2-6 Weeks</span>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
