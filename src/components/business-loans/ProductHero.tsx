import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon, ClockIcon, CurrencyDollarIcon } from '@heroicons/react/24/solid';
import type { LoanProduct } from '../../data/products';

interface ProductHeroProps {
  product: LoanProduct;
}

export default function ProductHero({ product }: ProductHeroProps) {
  const { hero } = product;

  // Split headline around the highlight word to wrap it in a gradient span
  const highlightIndex = hero.headline.indexOf(hero.highlightWord);
  const beforeHighlight = highlightIndex >= 0 ? hero.headline.slice(0, highlightIndex) : hero.headline;
  const afterHighlight =
    highlightIndex >= 0 ? hero.headline.slice(highlightIndex + hero.highlightWord.length) : '';

  return (
    <section className="relative bg-brand-gradient-hero overflow-hidden">
      {/* ── Floating decorative orbs ── */}
      <motion.div
        className="absolute top-16 right-[10%] w-72 h-72 bg-mint-green/20 rounded-full blur-3xl"
        animate={{
          y: [0, -30, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-24 left-[5%] w-80 h-80 bg-ocean-blue/20 rounded-full blur-3xl"
        animate={{
          y: [0, 30, 0],
          scale: [1, 0.85, 1],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/2 right-[3%] w-48 h-48 bg-teal/15 rounded-full blur-3xl"
        animate={{
          y: [0, -40, 0],
          x: [0, 20, 0],
          scale: [1, 1.3, 1],
        }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ── Content ── */}
      <div className="container-max relative z-10 pt-32 pb-16 lg:pt-40 lg:pb-24">
        {/* Badge */}
        <motion.span
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-block px-4 py-2 bg-white/10 rounded-full text-mint-green text-sm font-medium mb-6"
        >
          {hero.badge}
        </motion.span>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="heading-1 text-white mb-6"
        >
          {highlightIndex >= 0 ? (
            <>
              {beforeHighlight}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
                {hero.highlightWord}
              </span>
              {afterHighlight}
            </>
          ) : (
            hero.headline
          )}
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-xl text-white/80 mb-4 max-w-2xl"
        >
          {hero.subheadline}
        </motion.p>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-lg text-white/60 mb-10 max-w-2xl"
        >
          {hero.description}
        </motion.p>

        {/* Trust indicator pills */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex flex-wrap gap-4 mb-10"
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-white text-sm border border-white/10">
            <ClockIcon className="w-4 h-4 text-mint-green" />
            Approval in {hero.approvalTime}
          </span>
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-white text-sm border border-white/10">
            <CurrencyDollarIcon className="w-4 h-4 text-mint-green" />
            {hero.amountRange}
          </span>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <Link
            to="/#apply"
            className="inline-flex items-center gap-2 bg-mint-green hover:bg-mint-green/90 text-midnight-blue font-bold text-lg px-8 py-4 rounded-xl transition-colors"
          >
            Check Your Rate — Free
            <ArrowRightIcon className="w-5 h-5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
