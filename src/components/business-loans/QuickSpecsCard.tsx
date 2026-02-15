import { motion } from 'framer-motion';
import { ProductSpec } from '../../data/products';

interface QuickSpecsCardProps {
  specs: ProductSpec[];
  color: string;
}

export default function QuickSpecsCard({ specs, color }: QuickSpecsCardProps) {
  return (
    <section className="section-padding bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Section Header */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-block px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-medium mb-4">
            Quick Overview
          </span>
          <h2 className="heading-2 text-gray-900 dark:text-white mb-4">
            Product Details at a{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Glance
            </span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            Key specifications and terms for this financing product.
          </p>
        </motion.div>

        {/* Specs Card */}
        <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 lg:p-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {specs.map((spec, index) => (
              <motion.div
                key={spec.label}
                className="flex items-start gap-3"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.1 * index }}
              >
                <span
                  className="mt-2 w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{spec.label}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">{spec.value}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
