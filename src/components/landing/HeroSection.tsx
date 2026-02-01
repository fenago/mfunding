import { motion, useScroll, useTransform, useMotionValue, useSpring, animate } from 'framer-motion';
import { CheckCircleIcon, ArrowRightIcon } from '@heroicons/react/24/solid';
import { AuroraBackground } from '../ui/aurora-background';
import { ShimmerButton } from '../ui/shimmer-button';
import { MagneticButton } from '../ui/magnetic-button';
import { useRef, useEffect, useState } from 'react';

// Animated counter for the headline
function AnimatedAmount() {
  const [count, setCount] = useState(0);
  const targetAmount = 250000;

  useEffect(() => {
    const controls = animate(0, targetAmount, {
      duration: 2,
      delay: 0.5,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (value) => setCount(Math.round(value)),
    });

    return () => controls.stop();
  }, []);

  return (
    <motion.span
      className="tabular-nums"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      ${count.toLocaleString()}
    </motion.span>
  );
}

// Floating stat card
function FloatingStat({ value, label, delay, className }: { value: string; label: string; delay: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ scale: 1.05, y: -5 }}
      className={`bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 ${className}`}
    >
      <motion.p
        className="text-2xl lg:text-3xl font-bold text-mint-green"
        animate={{ scale: [1, 1.02, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {value}
      </motion.p>
      <p className="text-white/70 text-sm">{label}</p>
    </motion.div>
  );
}

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  const y = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  // Mouse tracking for spotlight
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothMouseX = useSpring(mouseX, { stiffness: 300, damping: 30 });
  const smoothMouseY = useSpring(mouseY, { stiffness: 300, damping: 30 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  return (
    <AuroraBackground className="min-h-screen" variant="intense" showParticles={true}>
      {/* Mouse spotlight */}
      <motion.div
        className="absolute w-[600px] h-[600px] pointer-events-none z-[1]"
        style={{
          left: smoothMouseX,
          top: smoothMouseY,
          x: '-50%',
          y: '-50%',
          background: 'radial-gradient(circle, rgba(0,212,157,0.12) 0%, transparent 50%)',
        }}
      />

      {/* Grid overlay with enhanced animation */}
      <motion.div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
        animate={{ opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Enhanced floating orbs */}
      <motion.div
        className="absolute top-20 right-[15%] w-72 h-72 bg-mint-green/25 rounded-full blur-3xl"
        style={{ y }}
        animate={{
          y: [0, -40, 0],
          scale: [1, 1.3, 1],
          rotate: [0, 180, 360],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-32 left-[5%] w-96 h-96 bg-ocean-blue/25 rounded-full blur-3xl"
        animate={{
          y: [0, 40, 0],
          scale: [1, 0.8, 1],
          rotate: [360, 180, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/2 right-[5%] w-56 h-56 bg-teal/20 rounded-full blur-3xl"
        animate={{
          y: [0, -50, 0],
          x: [0, 30, 0],
          scale: [1, 1.4, 1],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        style={{ opacity }}
        className="container-max relative z-10 pt-28 pb-16 lg:pt-36 lg:pb-24"
      >
        <div className="grid lg:grid-cols-[60%_40%] gap-8 lg:gap-12 items-center">
          {/* Left Column - Copy */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            {/* Pre-headline Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 mb-6 border border-white/20 hover:border-mint-green/40 transition-colors"
            >
              <motion.div
                className="w-2 h-2 rounded-full bg-mint-green"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-white/90 text-sm font-medium">
                93% Approval Rate • Funded in 24-48 Hours
              </span>
            </motion.div>

            {/* Main Headline - Value Driven */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white mb-6 leading-tight">
              <motion.span
                initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="block"
              >
                Get Up To
              </motion.span>
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, duration: 0.5, type: 'spring' }}
                className="block text-transparent bg-clip-text bg-gradient-to-r from-mint-green via-teal to-mint-green"
                style={{ backgroundSize: '200% 100%' }}
              >
                <AnimatedAmount />
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ delay: 0.7, duration: 0.6 }}
                className="block"
              >
                In 48 Hours.
              </motion.span>
            </h1>

            {/* Supporting headline */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              className="text-xl lg:text-2xl text-white/60 mb-4 font-light"
            >
              Banks said no?{' '}
              <span className="text-mint-green font-medium">We say yes.</span>
            </motion.p>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="text-white/70 text-lg leading-relaxed mb-8 max-w-xl"
            >
              While banks are still reviewing your paperwork, your competition is growing.
              Get the working capital your business needs—fast, simple, no BS.
            </motion.p>

            {/* Trust Stats Row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
              className="flex flex-wrap items-center gap-8 mb-8"
            >
              <div className="flex items-center gap-3">
                <motion.span
                  className="text-3xl font-bold text-mint-green"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  $2B+
                </motion.span>
                <span className="text-white/60 text-sm">Funded to<br/>small businesses</span>
              </div>
              <div className="w-px h-10 bg-white/20" />
              <div className="flex items-center gap-3">
                <motion.span
                  className="text-3xl font-bold text-mint-green"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
                >
                  15K+
                </motion.span>
                <span className="text-white/60 text-sm">Business owners<br/>funded</span>
              </div>
              <div className="w-px h-10 bg-white/20 hidden sm:block" />
              <div className="hidden sm:flex items-center gap-2">
                {[...Array(5)].map((_, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.2 + i * 0.05, type: 'spring' }}
                    className="text-mint-green text-lg"
                  >
                    ★
                  </motion.span>
                ))}
                <span className="text-white/60 text-sm ml-1">4.9/5</span>
              </div>
            </motion.div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
              className="flex flex-col sm:flex-row gap-4 mb-8"
            >
              <MagneticButton>
                <a href="#apply">
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="relative"
                  >
                    {/* Glow behind button */}
                    <motion.div
                      className="absolute inset-0 bg-mint-green rounded-xl blur-xl opacity-40"
                      animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <ShimmerButton
                      shimmerColor="#00D49D"
                      shimmerSize="0.15em"
                      background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
                      className="text-midnight-blue font-bold text-lg px-8 py-4 relative"
                    >
                      Check Your Rate — Free
                      <motion.span
                        className="ml-2 inline-block"
                        animate={{ x: [0, 6, 0] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <ArrowRightIcon className="w-5 h-5 inline" />
                      </motion.span>
                    </ShimmerButton>
                  </motion.div>
                </a>
              </MagneticButton>

              <MagneticButton>
                <motion.a
                  href="#features"
                  className="btn-secondary btn-large text-white border-white/30 hover:bg-white/10 hover:border-mint-green/50 transition-all duration-300 relative overflow-hidden group flex items-center gap-2"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="relative z-10">See Funding Options</span>
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-mint-green/10 to-teal/10"
                    initial={{ x: '-100%' }}
                    whileHover={{ x: '0%' }}
                    transition={{ duration: 0.3 }}
                  />
                </motion.a>
              </MagneticButton>
            </motion.div>

            {/* Micro-copy */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.4 }}
              className="flex flex-wrap items-center gap-6 text-white/60 text-sm"
            >
              {[
                { icon: '✓', text: "Won't affect your credit" },
                { icon: '✓', text: 'No obligation' },
                { icon: '✓', text: '5-minute application' },
              ].map((item, index) => (
                <motion.span
                  key={item.text}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.5 + index * 0.1 }}
                  whileHover={{ color: '#00D49D', x: 3 }}
                  className="flex items-center gap-2 cursor-default transition-colors"
                >
                  <span className="text-mint-green">{item.icon}</span>
                  {item.text}
                </motion.span>
              ))}
            </motion.div>
          </motion.div>

          {/* Right Column - Visual */}
          <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="hidden lg:block relative"
          >
            {/* Floating stat cards - positioned outside the main card */}
            <FloatingStat
              value="48hrs"
              label="Average funding time"
              delay={0.8}
              className="absolute -top-12 -left-12 z-30"
            />
            <FloatingStat
              value="93%"
              label="Approval rate"
              delay={1}
              className="absolute top-16 -right-16 z-30"
            />
            <FloatingStat
              value="$3M"
              label="Max funding"
              delay={1.2}
              className="absolute bottom-8 -left-16 z-30"
            />

            {/* Main visual card */}
            <motion.div
              className="relative bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 overflow-hidden"
              whileHover={{ scale: 1.02, borderColor: 'rgba(0, 212, 157, 0.3)' }}
              transition={{ duration: 0.3 }}
            >
              {/* Animated gradient border */}
              <motion.div
                className="absolute inset-0 rounded-3xl"
                style={{
                  background: 'linear-gradient(90deg, #00D49D, #007EA7, #00D49D)',
                  backgroundSize: '200% 100%',
                  padding: '1px',
                }}
                animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />

              {/* Inner content */}
              <div className="relative bg-midnight-blue/80 rounded-[22px] p-6">
                {/* Funding simulation */}
                <div className="text-center mb-6">
                  <motion.p
                    className="text-white/60 text-sm mb-2"
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    Estimated funding amount
                  </motion.p>
                  <motion.div
                    className="text-4xl font-bold text-white"
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    $75,000
                  </motion.div>
                </div>

                {/* Progress steps */}
                <div className="space-y-4">
                  {[
                    { step: 1, label: 'Application', status: 'complete', time: '5 min' },
                    { step: 2, label: 'Review', status: 'complete', time: '24 hrs' },
                    { step: 3, label: 'Funded', status: 'active', time: 'Tomorrow' },
                  ].map((item, index) => (
                    <motion.div
                      key={item.step}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 1 + index * 0.15 }}
                      className="flex items-center gap-4"
                    >
                      <motion.div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          item.status === 'active'
                            ? 'bg-mint-green'
                            : 'bg-mint-green/20 border border-mint-green/30'
                        }`}
                        animate={item.status === 'active' ? {
                          boxShadow: ['0 0 0 0 rgba(0,212,157,0.4)', '0 0 0 12px rgba(0,212,157,0)', '0 0 0 0 rgba(0,212,157,0.4)'],
                        } : {}}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        {item.status === 'complete' ? (
                          <CheckCircleIcon className="w-5 h-5 text-mint-green" />
                        ) : (
                          <span className="text-midnight-blue font-bold">{item.step}</span>
                        )}
                      </motion.div>
                      <div className="flex-1">
                        <p className="text-white font-medium">{item.label}</p>
                        <p className="text-white/50 text-sm">{item.time}</p>
                      </div>
                      {item.status === 'active' && (
                        <motion.div
                          className="px-3 py-1 rounded-full bg-mint-green/20 text-mint-green text-xs font-medium"
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          In Progress
                        </motion.div>
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Bottom CTA */}
                <motion.div
                  className="mt-6 pt-6 border-t border-white/10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.5 }}
                >
                  <p className="text-white/60 text-center text-sm">
                    Join <span className="text-mint-green font-medium">15,000+</span> business owners funded this year
                  </p>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </AuroraBackground>
  );
}
