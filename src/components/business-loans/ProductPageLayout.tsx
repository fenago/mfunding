import { motion } from 'framer-motion';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import Navbar from '../landing/Navbar';
import Footer from '../landing/Footer';
import ProductHero from './ProductHero';
import QuickSpecsCard from './QuickSpecsCard';
import ProductBenefits from './ProductBenefits';
import LoanCalculator from './LoanCalculator';
import ProductDocuments from './ProductDocuments';
import ProductFAQSection from './ProductFAQ';
import ProductCTA from './ProductCTA';
import ScrollToTop from '../ui/ScrollToTop';
import type { LoanProduct } from '../../data/products';

interface ProductPageLayoutProps {
  product: LoanProduct;
}

export default function ProductPageLayout({ product }: ProductPageLayoutProps) {
  return (
    <>
      <Navbar />
      <ScrollToTop />
      <main>
        <ProductHero product={product} />
        <QuickSpecsCard specs={product.specs} color={product.color} />
        <ProductBenefits benefits={product.benefits} color={product.color} />
        <LoanCalculator defaultProduct={product.slug} />
        <ProductDocuments
          documents={product.documents}
          restrictions={product.restrictions}
        />
        {product.flyer && (
          <section className="py-16 bg-gray-50 dark:bg-gray-800/50">
            <div className="container-max">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="max-w-3xl mx-auto flex flex-col md:flex-row items-center gap-8 bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-lg"
              >
                <img
                  src={product.flyer.url}
                  alt={`${product.shortName} flyer`}
                  className="w-48 md:w-56 rounded-lg shadow-md border border-gray-200 dark:border-gray-600"
                />
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                    {product.shortName} Overview
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm mb-5">
                    Download our one-page overview with program details, benefits, and qualification requirements.
                  </p>
                  <a
                    href={product.flyer.url}
                    download
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: product.color }}
                  >
                    <ArrowDownTrayIcon className="w-5 h-5" />
                    {product.flyer.label}
                  </a>
                </div>
              </motion.div>
            </div>
          </section>
        )}
        <ProductFAQSection faqs={product.faqs} />
        <ProductCTA productName={product.name} />
      </main>
      <Footer />
    </>
  );
}
