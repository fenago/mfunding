import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import type { LoanProduct } from '../../data/products';

interface ProductCardProps {
  product: LoanProduct;
  index: number;
}

export default function ProductCard({ product, index }: ProductCardProps) {
  const Icon = product.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <Link
        to={`/business-loans/${product.slug}`}
        className="group block bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 hover:border-mint-green/30 dark:hover:border-mint-green/30 transition-all duration-300 hover:shadow-xl hover:shadow-mint-green/5 h-full"
      >
        {/* Icon */}
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
          style={{ backgroundColor: `${product.color}15` }}
        >
          <Icon className="w-7 h-7" style={{ color: product.color }} />
        </div>

        {/* Name */}
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 group-hover:text-mint-green transition-colors">
          {product.shortName}
        </h3>

        {/* Tagline */}
        <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed mb-6">
          {product.tagline}
        </p>

        {/* Quick Stats */}
        <div className="space-y-2 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Amount</span>
            <span className="font-medium text-gray-900 dark:text-white">{product.hero.amountRange}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Approval</span>
            <span className="font-medium text-gray-900 dark:text-white">{product.hero.approvalTime}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Credit Score</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {product.specs.find((s) => s.label.includes('Credit'))?.value || 'N/A'}
            </span>
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-2 text-mint-green font-semibold text-sm group-hover:gap-3 transition-all">
          Learn More
          <ArrowRightIcon className="w-4 h-4" />
        </div>
      </Link>
    </motion.div>
  );
}
