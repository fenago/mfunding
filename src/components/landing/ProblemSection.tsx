import { motion } from 'framer-motion';
import { ClockIcon, DocumentTextIcon, CurrencyDollarIcon, CheckIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { useRef, useState, useEffect } from 'react';

const problems = [
  {
    icon: ClockIcon,
    title: 'The Bank Said No. Again.',
    description: 'You walked out of that office feeling like a ghost. All that paperwork. All that waiting. For nothing.',
    stat: '75',
    statSuffix: '%',
    statLabel: 'of small business loans get declined.',
    color: '#E11D48',
    backTitle: 'We Say Yes.',
    backItems: [
      '93% approval rate',
      'No credit score minimum',
      'Based on your cash flow',
      'Decision in hours, not weeks',
    ],
  },
  {
    icon: CurrencyDollarIcon,
    title: 'Payroll is Friday.',
    description: "Your guys have families. They're counting on you. That knot in your stomach? We understand it.",
    stat: '88',
    statSuffix: '%',
    statLabel: 'of businesses face cash flow gaps.',
    color: '#F59E0B',
    backTitle: 'Funds by Tomorrow.',
    backItems: [
      'Same-day approval possible',
      'Funds in 24-48 hours',
      'Flexible repayment terms',
      'No collateral required',
    ],
  },
  {
    icon: DocumentTextIcon,
    title: "Opportunities Don't Wait.",
    description: "That equipment deal. That big contract. Gone—because the bank moves at their pace, not yours.",
    stat: '25',
    statSuffix: '+',
    statLabel: 'hours wasted on bank applications.',
    color: '#6366F1',
    backTitle: '5-Minute Application.',
    backItems: [
      'Simple online form',
      'Just 3 months bank statements',
      'No lengthy paperwork',
      'Seize opportunities fast',
    ],
  },
];

// Animated number counter
function AnimatedStat({ value, suffix, color }: { value: string; suffix: string; color: string }) {
  const [count, setCount] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const numValue = parseInt(value, 10);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isInView) return;

    const duration = 1500;
    const steps = 30;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const timer = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * numValue));

      if (currentStep >= steps) {
        clearInterval(timer);
        setCount(numValue);
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [isInView, numValue]);

  return (
    <motion.span
      ref={ref}
      className="text-4xl font-bold tabular-nums"
      style={{ color }}
      initial={{ scale: 1 }}
      whileHover={{ scale: 1.05 }}
    >
      {count}
      <span className="text-3xl">{suffix}</span>
    </motion.span>
  );
}

// Static Problem → Solution Card (no click required — the answer is right there)
function ProblemCard({ problem, index }: { problem: typeof problems[0]; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.15 }}
      whileHover={{ y: -6 }}
      className="group bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-gray-100 dark:border-slate-600 overflow-hidden flex flex-col"
    >
      {/* Problem (top) */}
      <div className="p-8 pb-6 relative">
        <motion.div
          className="w-14 h-14 rounded-xl flex items-center justify-center mb-6"
          style={{ backgroundColor: `${problem.color}15` }}
          whileHover={{ scale: 1.1, rotate: 5 }}
        >
          <problem.icon className="w-7 h-7" style={{ color: problem.color }} />
        </motion.div>

        <h3 className="text-xl font-semibold text-heading mb-3">{problem.title}</h3>
        <p className="text-body leading-relaxed mb-6">{problem.description}</p>

        <div className="pt-5 border-t border-gray-200 dark:border-slate-600">
          <AnimatedStat value={problem.stat} suffix={problem.statSuffix} color={problem.color} />
          <p className="text-sm text-body mt-1">{problem.statLabel}</p>
        </div>
      </div>

      {/* Solution (bottom) — always visible, no flip */}
      <div
        className="mt-auto p-8 pt-6 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${problem.color} 0%, ${problem.color}dd 100%)` }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at center, white 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        />
        <div className="relative z-10">
          <h4 className="text-lg font-bold text-white mb-4">{problem.backTitle}</h4>
          <ul className="space-y-2.5 mb-6">
            {problem.backItems.map((item) => (
              <li key={item} className="flex items-center gap-3 text-white">
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <CheckIcon className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm">{item}</span>
              </li>
            ))}
          </ul>
          <a
            href="#apply"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-gray-900 font-semibold rounded-lg hover:bg-gray-100 transition-colors text-sm"
          >
            Get Started
            <ArrowRightIcon className="w-4 h-4" />
          </a>
        </div>
      </div>
    </motion.div>
  );
}

export default function ProblemSection() {
  return (
    <section className="section-padding bg-background relative overflow-hidden">
      {/* Background decoration */}
      <motion.div
        className="absolute top-0 right-0 w-96 h-96 bg-red-500/5 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 20, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          x: [0, -20, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="container-max relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-block px-4 py-2 bg-red-500/10 rounded-full text-red-600 dark:text-red-400 text-sm font-medium mb-4"
          >
            The Problem
          </motion.span>
          <h2 className="heading-2 text-heading mb-4">
            We Know What You're{' '}
            <motion.span
              className="relative inline-block"
              whileHover={{ scale: 1.02 }}
            >
              <span className="relative z-10 text-heading">Going Through.</span>
              <motion.span
                className="absolute bottom-0 left-0 w-full h-3 bg-red-500/20 -z-10"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5, duration: 0.5 }}
                style={{ transformOrigin: 'left' }}
              />
            </motion.span>
          </h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="text-text-secondary text-lg max-w-2xl mx-auto mb-4"
          >
            The sleepless nights. The worried looks from your family. The frustration of being treated like a number. We've seen it all—and we're here to change it.
          </motion.p>
        </motion.div>

        {/* Problems Grid */}
        <div className="grid md:grid-cols-3 gap-8 items-stretch">
          {problems.map((problem, index) => (
            <ProblemCard key={index} problem={problem} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
