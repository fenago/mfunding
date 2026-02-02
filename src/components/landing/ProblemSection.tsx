import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { ClockIcon, DocumentTextIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

const problems = [
  {
    icon: ClockIcon,
    title: 'The Bank Said No. Again.',
    description: 'You walked out of that office feeling like a ghost. All that paperwork. All that waiting. For nothing.',
    stat: '75',
    statSuffix: '%',
    statLabel: 'of small business loans get declined.',
    color: '#E11D48', // Red
    gradient: 'from-red-500/20 to-red-600/10',
  },
  {
    icon: CurrencyDollarIcon,
    title: 'Payroll is Friday.',
    description: "Your guys have families. They're counting on you. That knot in your stomach? We understand it.",
    stat: '88',
    statSuffix: '%',
    statLabel: 'of businesses face cash flow gaps.',
    color: '#F59E0B', // Amber
    gradient: 'from-amber-500/20 to-amber-600/10',
  },
  {
    icon: DocumentTextIcon,
    title: "Opportunities Don't Wait.",
    description: "That equipment deal. That big contract. Gone—because the bank moves at their pace, not yours.",
    stat: '25',
    statSuffix: '+',
    statLabel: 'hours wasted on bank applications.',
    color: '#6366F1', // Indigo
    gradient: 'from-indigo-500/20 to-indigo-600/10',
  },
];

// 3D tilt card component
function TiltCard({ children, className, glowColor }: { children: React.ReactNode; className?: string; glowColor: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  const background = useMotionTemplate`
    radial-gradient(
      350px circle at ${mouseX}px ${mouseY}px,
      ${glowColor}15,
      transparent 80%
    )
  `;

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn('relative overflow-hidden', className)}
      style={{ transformStyle: 'preserve-3d' }}
      whileHover={{
        scale: 1.02,
        rotateX: 2,
        rotateY: -2,
        transition: { duration: 0.2 },
      }}
    >
      {/* Glow effect */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300"
        style={{ background, opacity: isHovered ? 1 : 0 }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

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
      // Ease out cubic
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
};

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
            className="text-text-secondary text-lg max-w-2xl mx-auto"
          >
            The sleepless nights. The worried looks from your family. The frustration of being treated like a number. We've seen it all—and we're here to change it.
          </motion.p>
        </motion.div>

        {/* Problems Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="grid md:grid-cols-3 gap-8"
        >
          {problems.map((problem, index) => (
            <motion.div key={index} variants={itemVariants}>
              <TiltCard
                className="problem-card rounded-2xl p-8 shadow-lg border border-gray-100 dark:border-slate-600 h-full"
                glowColor={problem.color}
              >
                {/* Gradient overlay */}
                <div className={cn('absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 rounded-2xl bg-gradient-to-br', problem.gradient)} />

                <div className="relative z-10">
                  {/* Icon with animated background */}
                  <motion.div
                    className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 relative overflow-hidden"
                    style={{ backgroundColor: `${problem.color}15` }}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ duration: 0.3 }}
                  >
                    <motion.div
                      className="absolute inset-0"
                      style={{ backgroundColor: problem.color }}
                      initial={{ scale: 0, opacity: 0 }}
                      whileHover={{ scale: 2, opacity: 0.2 }}
                      transition={{ duration: 0.4 }}
                    />
                    <problem.icon className="w-7 h-7 relative z-10" style={{ color: problem.color }} />
                  </motion.div>

                  {/* Title & Description */}
                  <motion.h3
                    className="text-xl font-semibold text-heading mb-3"
                    whileHover={{ x: 3 }}
                    transition={{ duration: 0.2 }}
                  >
                    {problem.title}
                  </motion.h3>
                  <p className="text-body mb-6 leading-relaxed">
                    {problem.description}
                  </p>

                  {/* Stat with animation */}
                  <div className="pt-6 border-t border-gray-200">
                    <div className="mb-2">
                      <AnimatedStat value={problem.stat} suffix={problem.statSuffix} color={problem.color} />
                    </div>
                    <p className="text-sm text-body">
                      {problem.statLabel}
                    </p>
                  </div>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
