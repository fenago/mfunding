import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon } from '@heroicons/react/24/solid';
import Navbar from '../../components/landing/Navbar';
import Footer from '../../components/landing/Footer';
import ProductCard from '../../components/business-loans/ProductCard';
import ScrollToTop from '../../components/ui/ScrollToTop';
import SEO from '../../components/seo/SEO';
import { getAllProducts } from '../../data/products';

export default function BusinessLoansHubPage() {
  const products = getAllProducts();

  return (
    <>
      <SEO
        title="Business Loans & Funding Options"
        description="Explore Momentum Funding's 6 business financing products: Merchant Cash Advance, Equipment Financing, Startup Loans, SBA 7(a) Loans, Term Loans, and Lines of Credit. Get funded in as little as 24 hours."
        keywords="business loans, merchant cash advance, equipment financing, SBA loans, business term loan, line of credit, small business funding, fast business loans"
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
                to="/#apply"
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
