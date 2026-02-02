import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { BoltIcon, CreditCardIcon, WrenchScrewdriverIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { ShimmerButton } from '../ui/shimmer-button';
import { MagneticButton } from '../ui/magnetic-button';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const fundingOptions = [
  {
    icon: BoltIcon,
    title: 'Merchant Cash Advance',
    tagline: 'Make Payroll. Every Time.',
    bestFor: 'When you need cash now—not next month.',
    description:
      "Get a lump sum of cash today, pay it back as a percentage of future sales. When business is slow, payments adjust. When it's good, you're free faster.",
    metric: '$5K - $1M',
    metricLabel: 'Funding range',
    speed: '24-48 hours',
    color: '#00D49D',
    gradient: 'from-mint-green/20 via-mint-green/10 to-transparent',
  },
  {
    icon: CreditCardIcon,
    title: 'Business Line of Credit',
    tagline: 'Your Safety Net for the Unexpected.',
    bestFor: "For the things you can't predict.",
    description:
      "Equipment breaks. Suppliers demand early payment. Opportunities appear. Draw what you need, when you need it. Only pay for what you use.",
    metric: 'Up to $1.25M',
    metricLabel: 'Credit available',
    speed: '1-3 days',
    color: '#007EA7',
    gradient: 'from-ocean-blue/20 via-ocean-blue/10 to-transparent',
  },
  {
    icon: WrenchScrewdriverIcon,
    title: 'Equipment Financing',
    tagline: 'The Tools to Grow.',
    bestFor: 'Ready to take on bigger jobs.',
    description:
      "That excavator. That delivery truck. The equipment that's been holding you back. Finance the full cost with predictable payments.",
    metric: 'Up to $3M',
    metricLabel: 'Equipment value',
    speed: '3-5 days',
    color: '#00A896',
    gradient: 'from-teal/20 via-teal/10 to-transparent',
  },
];

// 3D Tilt Card with spotlight effect
function FundingCard({ option, index }: { option: typeof fundingOptions[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  const spotlight = useMotionTemplate`
    radial-gradient(
      400px circle at ${mouseX}px ${mouseY}px,
      ${option.color}20,
      transparent 80%
    )
  `;

  const borderGradient = useMotionTemplate`
    radial-gradient(
      300px circle at ${mouseX}px ${mouseY}px,
      ${option.color}60,
      transparent 80%
    )
  `;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 50, rotateX: 10 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.15 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ transformStyle: 'preserve-3d', perspective: 1000 }}
      whileHover={{
        scale: 1.02,
        rotateX: 2,
        rotateY: -2,
        z: 50,
      }}
      className="relative group"
    >
      {/* Animated border */}
      <motion.div
        className="absolute -inset-[1px] rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: borderGradient }}
      />

      {/* Card */}
      <div className="relative bg-white dark:bg-midnight-blue/50 rounded-2xl p-8 border border-gray-100 dark:border-white/10 h-full overflow-hidden">
        {/* Spotlight effect */}
        <motion.div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: spotlight }}
        />

        {/* Background gradient */}
        <div className={cn('absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br', option.gradient)} />

        {/* Content */}
        <div className="relative z-10">
          {/* Icon with animated background */}
          <motion.div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 relative overflow-hidden"
            style={{ backgroundColor: `${option.color}15` }}
            whileHover={{ scale: 1.1, rotate: 5 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ backgroundColor: option.color }}
              initial={{ scale: 0, opacity: 0 }}
              animate={isHovered ? { scale: 2, opacity: 0.3 } : { scale: 0, opacity: 0 }}
              transition={{ duration: 0.4 }}
            />
            <option.icon className="w-8 h-8 relative z-10" style={{ color: option.color }} />
          </motion.div>

          {/* Tagline */}
          <motion.h3
            className="text-2xl font-bold text-midnight-blue dark:text-white mb-2"
            whileHover={{ x: 3 }}
          >
            {option.tagline}
          </motion.h3>

          {/* Product name */}
          <p className="text-sm font-medium mb-3" style={{ color: option.color }}>
            {option.title}
          </p>

          {/* Best For */}
          <motion.div
            className="rounded-lg px-4 py-2 mb-4 border"
            style={{
              backgroundColor: `${option.color}10`,
              borderColor: `${option.color}30`,
            }}
            whileHover={{ scale: 1.02 }}
          >
            <p className="text-sm text-midnight-blue dark:text-white">
              <span className="font-semibold" style={{ color: option.color }}>Best for:</span> {option.bestFor}
            </p>
          </motion.div>

          {/* Description */}
          <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
            {option.description}
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 pt-6 border-t border-gray-100 dark:border-white/10">
            <div>
              <motion.p
                className="text-2xl font-bold"
                style={{ color: option.color }}
                whileHover={{ scale: 1.05 }}
              >
                {option.metric}
              </motion.p>
              <p className="text-xs text-gray-600 dark:text-gray-300">{option.metricLabel}</p>
            </div>
            <div>
              <motion.p
                className="text-2xl font-bold"
                style={{ color: option.color }}
                whileHover={{ scale: 1.05 }}
              >
                {option.speed}
              </motion.p>
              <p className="text-xs text-gray-600 dark:text-gray-300">Funding speed</p>
            </div>
          </div>

          {/* Learn more link */}
          <motion.a
            href="#apply"
            className="inline-flex items-center gap-2 mt-6 text-sm font-medium transition-colors"
            style={{ color: option.color }}
            whileHover={{ x: 5 }}
          >
            Learn more
            <motion.span
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ArrowRightIcon className="w-4 h-4" />
            </motion.span>
          </motion.a>
        </div>
      </div>
    </motion.div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
    },
  },
};

export default function FeaturesSection() {
  return (
    <section id="features" className="section-padding bg-background relative overflow-hidden">
      {/* Background decoration */}
      <motion.div
        className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-mint-green/5 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 50, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-ocean-blue/5 rounded-full blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          x: [0, -50, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="container-max relative z-10">
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
            className="inline-block px-4 py-2 bg-ocean-blue/10 rounded-full text-ocean-blue text-sm font-medium mb-4"
          >
            Funding Solutions
          </motion.span>
          <h2 className="heading-2 text-midnight-blue dark:text-white mb-4">
            Three Ways to{' '}
            <motion.span
              className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal"
              animate={{
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              style={{ backgroundSize: '200% 100%' }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              Get Funded
            </motion.span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Different problems need different solutions. Tell us what's keeping you up at night,
            and we'll match you with the right funding.
          </p>
        </motion.div>

        {/* Cards Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="grid md:grid-cols-3 gap-8"
          style={{ perspective: 1000 }}
        >
          {fundingOptions.map((option, index) => (
            <FundingCard key={index} option={option} index={index} />
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mt-16"
        >
          <MagneticButton>
            <a href="#apply">
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="relative">
                {/* Glow */}
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
                  Find Your Funding Option
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

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6 }}
            className="text-text-secondary text-sm mt-4"
          >
            Not sure which is right for you? We'll help you decide. No pressure.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
