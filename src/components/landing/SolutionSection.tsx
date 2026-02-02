import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { ArrowRightIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { useEffect, useRef, useState } from 'react';

const bankProcess = [
  'Schedule appointment',
  'Gather 50+ documents',
  'Wait 2-4 weeks',
  'Credit review',
  'Collateral assessment',
  'Committee approval',
  'More paperwork',
  'Final review',
  'Maybe get funded...',
];

const momentumProcess = [
  { step: 'Apply Online', time: '5 min', done: true },
  { step: 'Review Offers', time: '24 hrs', done: true },
  { step: 'Get Funded', time: '24-48 hrs', done: true },
];

// Animated approval rate counter
function ApprovalCounter() {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          animate(count, 4, {
            duration: 2,
            ease: [0.4, 0, 0.2, 1],
          });
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [count, hasAnimated]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (latest) => {
      setDisplayValue(latest);
    });
    return unsubscribe;
  }, [rounded]);

  return (
    <motion.span
      ref={ref}
      className="text-mint-green font-bold"
      initial={{ scale: 1 }}
      whileHover={{ scale: 1.05 }}
    >
      {displayValue}x higher
    </motion.span>
  );
}

export default function SolutionSection() {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  return (
    <section className="section-padding bg-white dark:bg-background relative overflow-hidden">
      {/* Animated background orbs */}
      <motion.div
        className="absolute top-20 left-10 w-72 h-72 bg-mint-green/10 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 30, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-20 right-10 w-96 h-96 bg-ocean-blue/10 rounded-full blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          x: [0, -30, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="container-max relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left Column - Copy */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-medium mb-4"
            >
              The Solution
            </motion.span>

            <h2 className="heading-2 text-heading mb-6">
              We Say{' '}
              <motion.span
                className="inline-block text-mint-green"
                initial={{ scale: 1 }}
                whileHover={{ scale: 1.05, rotate: -2 }}
              >
                "Yes"
              </motion.span>{' '}
              When Banks Say{' '}
              <motion.span
                className="inline-block text-red-500 line-through decoration-2"
                initial={{ scale: 1 }}
                whileHover={{ scale: 0.95 }}
              >
                "No."
              </motion.span>
            </h2>

            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-text-secondary text-lg leading-relaxed mb-8"
            >
              We built Momentum for business owners like you—the contractors, the restaurant owners,
              the people who get their hands dirty every day. We don't care about your credit score
              from 2019. We look at your business{' '}
              <motion.span
                className="font-semibold text-heading relative inline-block"
                whileHover={{ scale: 1.02 }}
              >
                right now
                <motion.span
                  className="absolute bottom-0 left-0 w-full h-1 bg-mint-green/50"
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 }}
                  style={{ transformOrigin: 'left' }}
                />
              </motion.span>
              : your cash flow, your revenue, your fight. If your business is real, we'll find a way.
            </motion.p>

            {/* UVP Callout with enhanced animation */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              whileHover={{ scale: 1.02, borderColor: 'rgba(0,212,157,0.5)' }}
              className="bg-mint-green/10 border border-mint-green/30 rounded-xl p-6 relative overflow-hidden group"
            >
              {/* Animated gradient on hover */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-mint-green/10 to-teal/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              />

              <div className="relative z-10">
                <motion.p
                  className="text-lg font-semibold text-heading mb-2"
                  whileHover={{ x: 3 }}
                >
                  Your business tells a story. We actually read it.
                </motion.p>
                <p className="text-text-secondary">
                  Our approval rates are <ApprovalCounter /> than
                  traditional lenders because we look at what matters.
                </p>
              </div>
            </motion.div>
          </motion.div>

          {/* Right Column - Comparison Visual */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid gap-6"
          >
            {/* Bank Process - Before */}
            <motion.div
              className="bg-gray-50 dark:bg-midnight-blue/30 rounded-xl p-6 border border-gray-200 dark:border-white/10 relative overflow-hidden"
              whileHover={{ borderColor: 'rgba(239,68,68,0.3)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <motion.div
                  className="w-10 h-10 rounded-lg bg-error/10 flex items-center justify-center"
                  whileHover={{ scale: 1.1, rotate: -5 }}
                >
                  <XMarkIcon className="w-5 h-5 text-error" />
                </motion.div>
                <div>
                  <p className="font-semibold text-heading">The Bank Process</p>
                  <p className="text-sm text-body">Weeks to months</p>
                </div>
              </div>

              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  {bankProcess.map((step, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ scale: 1.05, backgroundColor: 'rgba(239,68,68,0.1)' }}
                      className="bg-white dark:bg-midnight-blue/50 px-3 py-1.5 rounded-md text-sm text-body border border-gray-200 dark:border-white/10 cursor-default transition-colors"
                    >
                      {step}
                    </motion.div>
                  ))}
                </div>

                {/* Animated tangled lines */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 400 100"
                  preserveAspectRatio="none"
                >
                  <motion.path
                    d="M0,50 Q100,10 150,50 T300,50 T400,50"
                    stroke="#EF4444"
                    strokeWidth="2"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: 0.3 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: 0.5 }}
                  />
                  <motion.path
                    d="M0,30 Q50,80 150,30 T300,70 T400,30"
                    stroke="#EF4444"
                    strokeWidth="2"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: 0.2 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: 0.7 }}
                  />
                </svg>
              </div>
            </motion.div>

            {/* Momentum Process - After */}
            <motion.div
              className="bg-mint-green/5 dark:bg-mint-green/10 rounded-xl p-6 border-2 border-mint-green/30 relative overflow-hidden"
              whileHover={{ scale: 1.02, borderColor: 'rgba(0,212,157,0.5)' }}
              transition={{ duration: 0.2 }}
            >
              {/* Glow effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-mint-green/10 via-transparent to-teal/10"
                animate={{
                  opacity: [0.3, 0.6, 0.3],
                }}
                transition={{ duration: 3, repeat: Infinity }}
              />

              <div className="flex items-center gap-3 mb-4 relative z-10">
                <motion.div
                  className="w-10 h-10 rounded-lg bg-mint-green/20 flex items-center justify-center"
                  animate={{
                    boxShadow: [
                      '0 0 0 0 rgba(0,212,157,0.4)',
                      '0 0 0 8px rgba(0,212,157,0)',
                      '0 0 0 0 rgba(0,212,157,0.4)',
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <CheckIcon className="w-5 h-5 text-mint-green" />
                </motion.div>
                <div>
                  <p className="font-semibold text-heading">The Momentum Process</p>
                  <motion.p
                    className="text-sm text-mint-green font-medium"
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    24-48 hours
                  </motion.p>
                </div>
              </div>

              <div className="flex items-center justify-between relative z-10">
                {momentumProcess.map((item, index) => (
                  <div key={index} className="flex items-center">
                    <motion.div
                      className="text-center"
                      onHoverStart={() => setHoveredStep(index)}
                      onHoverEnd={() => setHoveredStep(null)}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.2 }}
                      whileHover={{ scale: 1.1 }}
                    >
                      <motion.div
                        className="w-12 h-12 rounded-full bg-mint-green flex items-center justify-center mb-2 relative"
                        animate={
                          hoveredStep === index
                            ? { scale: 1.1, boxShadow: '0 0 20px rgba(0,212,157,0.5)' }
                            : { scale: 1, boxShadow: '0 0 0 rgba(0,212,157,0)' }
                        }
                      >
                        <span className="font-bold text-gray-900">{index + 1}</span>

                        {/* Pulse ring animation */}
                        {index === 2 && (
                          <motion.span
                            className="absolute inset-0 rounded-full border-2 border-mint-green"
                            animate={{
                              scale: [1, 1.5],
                              opacity: [0.5, 0],
                            }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          />
                        )}
                      </motion.div>
                      <p className="text-sm font-medium text-heading">{item.step}</p>
                      <p className="text-xs text-text-secondary">{item.time}</p>
                    </motion.div>

                    {index < momentumProcess.length - 1 && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 + index * 0.2 }}
                      >
                        <ArrowRightIcon className="w-5 h-5 text-mint-green mx-4" />
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
