import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef, useState } from 'react';
import {
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  BanknotesIcon,
  CheckIcon,
  ArrowRightIcon,
  ClockIcon,
  ShieldCheckIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { ShimmerButton } from '../ui/shimmer-button';
import { MagneticButton } from '../ui/magnetic-button';

const steps = [
  {
    icon: ClipboardDocumentCheckIcon,
    step: '01',
    title: 'Simple Online Application',
    shortTitle: 'Apply',
    description: "Fill out our 5-minute application. It's free and won't affect your credit score.",
    backTitle: 'What You Need',
    backItems: [
      'Business name & info',
      'Last 3 months bank statements',
      'Basic owner information',
      'No collateral required',
    ],
    color: '#00D49D',
    highlight: '5 mins',
    highlightIcon: ClockIcon,
  },
  {
    icon: MagnifyingGlassIcon,
    step: '02',
    title: 'Review Your Offers',
    shortTitle: 'Review',
    description: 'Our system analyzes your business health and presents clear, transparent offers within hours.',
    backTitle: 'What We Look At',
    backItems: [
      'Monthly revenue trends',
      'Cash flow patterns',
      'Business age & industry',
      'NOT your credit score',
    ],
    color: '#00A896',
    highlight: 'Hours',
    highlightIcon: MagnifyingGlassIcon,
  },
  {
    icon: BanknotesIcon,
    step: '03',
    title: 'Get Funded',
    shortTitle: 'Funded',
    description: 'Accept your offer, and the funds will be in your bank account in as little as 24 hours.',
    backTitle: 'What You Get',
    backItems: [
      'Funds in your account',
      'Clear repayment terms',
      'Dedicated support team',
      'No hidden fees',
    ],
    color: '#007EA7',
    highlight: '24 hrs',
    highlightIcon: BanknotesIcon,
  },
];

// Flip Card Component
function FlipCard({ step, index }: { step: typeof steps[0]; index: number }) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.15 }}
      className="relative h-[400px] cursor-pointer group"
      style={{ perspective: 1000 }}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      {/* Card container */}
      <motion.div
        className="relative w-full h-full"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, type: 'spring', stiffness: 100 }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front of card */}
        <div
          className="absolute inset-0 bg-white dark:bg-midnight-blue/50 rounded-2xl p-8 border border-gray-100 dark:border-white/10 overflow-hidden"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Animated gradient on hover */}
          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              background: `linear-gradient(135deg, ${step.color}10 0%, transparent 60%)`,
            }}
          />

          {/* Step number bubble */}
          <motion.div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-6 relative"
            style={{ backgroundColor: `${step.color}15`, border: `2px solid ${step.color}30` }}
            whileHover={{ scale: 1.1, rotate: 10 }}
          >
            <motion.span
              className="text-lg font-bold"
              style={{ color: step.color }}
            >
              {step.step}
            </motion.span>
            {/* Pulse effect */}
            <motion.div
              className="absolute inset-0 rounded-full"
              animate={{
                boxShadow: [
                  `0 0 0 0 ${step.color}40`,
                  `0 0 0 12px ${step.color}00`,
                  `0 0 0 0 ${step.color}40`,
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
            />
          </motion.div>

          {/* Icon */}
          <motion.div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 relative overflow-hidden"
            style={{ backgroundColor: `${step.color}10` }}
            whileHover={{ scale: 1.1, rotate: 5 }}
          >
            <step.icon className="w-8 h-8" style={{ color: step.color }} />
          </motion.div>

          {/* Title */}
          <h3 className="text-xl font-semibold text-midnight-blue dark:text-white mb-3">
            {step.title}
          </h3>

          {/* Description */}
          <p className="text-body leading-relaxed mb-6">
            {step.description}
          </p>

          {/* Highlight badge */}
          <motion.div
            className="inline-flex px-4 py-2 rounded-full text-sm font-semibold items-center gap-2"
            style={{ backgroundColor: `${step.color}10`, color: step.color }}
            whileHover={{ scale: 1.05 }}
          >
            <CheckIcon className="w-4 h-4" />
            {step.highlight}
          </motion.div>

          {/* Click to flip hint */}
          <motion.div
            className="absolute bottom-4 right-4 text-xs text-body flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            animate={{ x: [0, 5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            Click to see details
            <ArrowRightIcon className="w-3 h-3" />
          </motion.div>
        </div>

        {/* Back of card */}
        <div
          className="absolute inset-0 rounded-2xl p-8 overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: `linear-gradient(135deg, ${step.color} 0%, ${step.color}dd 100%)`,
          }}
        >
          {/* Pattern overlay */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `radial-gradient(circle at center, white 1px, transparent 1px)`,
              backgroundSize: '20px 20px',
            }}
          />

          <div className="relative z-10 h-full flex flex-col">
            {/* Back title */}
            <h3 className="text-2xl font-bold text-white mb-6">
              {step.backTitle}
            </h3>

            {/* Items list */}
            <ul className="space-y-4 flex-1">
              {step.backItems.map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={isFlipped ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3 text-white"
                >
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <CheckIcon className="w-4 h-4 text-white" />
                  </div>
                  {item}
                </motion.li>
              ))}
            </ul>

            {/* Click to flip back */}
            <motion.div
              className="text-white/70 text-sm flex items-center gap-2 mt-4"
              animate={{ x: [0, -5, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ArrowRightIcon className="w-4 h-4 rotate-180" />
              Click to go back
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function HowItWorksSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  const lineWidth = useTransform(scrollYProgress, [0.2, 0.8], ['0%', '100%']);

  return (
    <section id="how-it-works" className="section-padding bg-white dark:bg-background relative overflow-hidden" ref={containerRef}>
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-mint-green/5"
          style={{
            x: useTransform(scrollYProgress, [0, 1], [100, -100]),
          }}
        />
        <motion.div
          className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-ocean-blue/5"
          style={{
            x: useTransform(scrollYProgress, [0, 1], [-100, 100]),
          }}
        />
      </div>

      <div className="container-max relative z-10">
        <div className="max-w-5xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-semibold mb-4"
            >
              The Process
            </motion.span>
            <h2 className="heading-2 text-midnight-blue dark:text-white mb-4">
              How It{' '}
              <motion.span
                className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal"
                animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                style={{ backgroundSize: '200% 100%' }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                Works
              </motion.span>
            </h2>
            <p className="text-text-secondary text-lg max-w-xl mx-auto mb-4">
              Get funded in three simple steps. No complicated paperwork, no endless waiting.
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-sm text-mint-green font-medium"
            >
              Click any card to see more details
            </motion.p>
          </motion.div>

          {/* Animated progress line - desktop */}
          <div className="hidden lg:block relative mb-8">
            <div className="absolute top-0 left-[16%] right-[16%] h-1 bg-gray-100 dark:bg-white/10 rounded-full">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-mint-green via-teal to-ocean-blue rounded-full"
                style={{ width: lineWidth }}
              />
            </div>
          </div>

          {/* Flip Cards Grid */}
          <div className="grid lg:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <FlipCard key={index} step={step} index={index} />
            ))}
          </div>

          {/* Fee Structure */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-20"
          >
            <motion.div
              className="relative rounded-3xl overflow-hidden"
              whileHover={{ scale: 1.01 }}
              transition={{ duration: 0.3 }}
            >
              {/* Animated gradient background */}
              <motion.div
                className="absolute inset-0"
                animate={{
                  background: [
                    'linear-gradient(135deg, #F0FDF9 0%, #ECFEFF 50%, #F0FDF4 100%)',
                    'linear-gradient(135deg, #ECFEFF 0%, #F0FDF4 50%, #F0FDF9 100%)',
                    'linear-gradient(135deg, #F0FDF9 0%, #ECFEFF 50%, #F0FDF4 100%)',
                  ],
                }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              />

              {/* Grid pattern */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `radial-gradient(circle at center, rgba(0, 168, 150, 0.15) 1px, transparent 1px)`,
                  backgroundSize: '20px 20px',
                }}
              />

              <div className="relative p-10">
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <motion.div
                    className="w-20 h-20 rounded-2xl bg-gradient-to-br from-mint-green/20 to-teal/20 flex items-center justify-center flex-shrink-0"
                    whileHover={{ scale: 1.1, rotate: 10 }}
                    animate={{
                      boxShadow: [
                        '0 0 0 0 rgba(0,212,157,0.3)',
                        '0 0 0 15px rgba(0,212,157,0)',
                        '0 0 0 0 rgba(0,212,157,0.3)',
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <ShieldCheckIcon className="w-10 h-10 text-teal" />
                  </motion.div>

                  <div className="text-center md:text-left flex-1">
                    <h3 className="text-2xl font-semibold text-midnight-blue mb-3">
                      Transparent Pricing, No Surprises
                    </h3>
                    <p className="text-body leading-relaxed">
                      Our fees are built into the total repayment amount. There are no hidden costs or
                      application fees. You'll know the full cost of your funding upfront before you commit.
                    </p>
                  </div>

                  {/* Trust badges */}
                  <div className="flex flex-wrap justify-center gap-3">
                    {[
                      { icon: CheckIcon, text: 'No Hidden Fees' },
                      { icon: DocumentCheckIcon, text: 'Clear Terms' },
                      { icon: ShieldCheckIcon, text: 'Upfront Pricing' },
                    ].map((badge, i) => (
                      <motion.span
                        key={badge.text}
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.5 + i * 0.1 }}
                        whileHover={{ scale: 1.05, y: -2 }}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 border border-teal/20 text-sm font-medium text-teal shadow-sm"
                      >
                        <badge.icon className="w-4 h-4" />
                        {badge.text}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="text-center mt-12"
          >
            <MagneticButton>
              <a href="#apply">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="relative">
                  <motion.div
                    className="absolute inset-0 bg-mint-green rounded-xl blur-xl opacity-30"
                    animate={{ opacity: [0.2, 0.4, 0.2], scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <ShimmerButton
                    shimmerColor="#00D49D"
                    background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
                    className="text-midnight-blue font-bold text-lg relative"
                  >
                    Start Your Application — It's Free
                    <motion.span
                      className="ml-2"
                      animate={{ x: [0, 5, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      →
                    </motion.span>
                  </ShimmerButton>
                </motion.div>
              </a>
            </MagneticButton>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
