import { motion, useMotionValue, useTransform } from 'framer-motion';
import { CheckCircleIcon, ArrowRightIcon, ClockIcon } from '@heroicons/react/24/solid';
import { ShimmerButton } from '../ui/shimmer-button';
import { MagneticButton } from '../ui/magnetic-button';
import { GradientText } from '../ui/glowing-text';
import { useRef, useState, useEffect } from 'react';

const trustElements = [
  { text: 'No credit card required', icon: CheckCircleIcon },
  { text: 'No obligation', icon: CheckCircleIcon },
  { text: 'Funding in 24 hours', icon: ClockIcon },
];

// Urgency countdown component
function UrgencyTimer() {
  const [timeLeft, setTimeLeft] = useState({ hours: 23, minutes: 59, seconds: 59 });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) {
          return { ...prev, seconds: prev.seconds - 1 };
        } else if (prev.minutes > 0) {
          return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        } else if (prev.hours > 0) {
          return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        }
        return { hours: 23, minutes: 59, seconds: 59 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      className="inline-flex items-center gap-3 bg-white/5 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/10"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5 }}
    >
      <motion.span
        className="w-2 h-2 rounded-full bg-mint-green"
        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
      />
      <span className="text-white/70 text-sm">Same-day funding ends in:</span>
      <span className="font-mono text-mint-green font-bold">
        {String(timeLeft.hours).padStart(2, '0')}:
        {String(timeLeft.minutes).padStart(2, '0')}:
        {String(timeLeft.seconds).padStart(2, '0')}
      </span>
    </motion.div>
  );
}

export default function FinalCTASection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  const spotlightX = useTransform(mouseX, (val) => `${val}px`);
  const spotlightY = useTransform(mouseY, (val) => `${val}px`);

  return (
    <section
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="py-24 lg:py-32 relative overflow-hidden"
    >
      {/* Animated gradient background */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #0A2342 0%, #0C516E 25%, #007EA7 50%, #0C516E 75%, #0A2342 100%)',
          backgroundSize: '400% 400%',
        }}
        animate={{
          backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Mouse spotlight effect */}
      <motion.div
        className="absolute w-[500px] h-[500px] pointer-events-none"
        style={{
          left: spotlightX,
          top: spotlightY,
          x: '-50%',
          y: '-50%',
          background: 'radial-gradient(circle, rgba(0,212,157,0.15) 0%, transparent 60%)',
        }}
      />

      {/* Animated orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-1/4 right-1/4 w-96 h-96 bg-mint-green/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.4, 1],
            x: [0, 60, 0],
            y: [0, -40, 0],
            rotate: [0, 180, 360],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-ocean-blue/20 rounded-full blur-3xl"
          animate={{
            scale: [1.3, 1, 1.3],
            x: [0, -60, 0],
            y: [0, 40, 0],
            rotate: [360, 180, 0],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-teal/10 rounded-full blur-3xl"
          animate={{
            scale: [0.8, 1.2, 0.8],
            opacity: [0.1, 0.3, 0.1],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Animated particle field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-mint-green/40"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0.2, 0.8, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 3 + Math.random() * 3,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      {/* Grid pattern */}
      <motion.div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at center, rgba(0,212,157,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '30px 30px',
        }}
        animate={{
          opacity: [0.05, 0.15, 0.05],
        }}
        transition={{ duration: 4, repeat: Infinity }}
      />

      <div className="container-max relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          {/* Urgency Timer */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-8"
          >
            <UrgencyTimer />
          </motion.div>

          {/* Headline with split text animation */}
          <h2 className="heading-2 text-white mb-6">
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="inline-block"
            >
              You've Made It
            </motion.span>{' '}
            <motion.span
              initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
              whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <GradientText className="font-serif">This Far.</GradientText>
            </motion.span>
          </h2>

          {/* Supporting Text with staggered reveal */}
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-white/80 text-lg lg:text-xl mb-10"
          >
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
            >
              Every day you wait costs you.
            </motion.span>{' '}
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="text-white/60"
            >
              Not just money—peace of mind.
            </motion.span>{' '}
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 }}
            >
              Your family. Your crew. They're counting on you.
            </motion.span>{' '}
            <motion.span
              initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
              whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              viewport={{ once: true }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="text-white font-semibold"
            >
              Let's fix this together.
            </motion.span>
          </motion.p>

          {/* CTA Button with enhanced effects */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="mb-10"
          >
            <MagneticButton strength={0.15}>
              <a href="#apply">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="relative"
                >
                  {/* Glow effect behind button */}
                  <motion.div
                    className="absolute inset-0 bg-mint-green rounded-xl blur-xl"
                    animate={{
                      opacity: [0.3, 0.6, 0.3],
                      scale: [1, 1.1, 1],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />

                  <ShimmerButton
                    shimmerColor="#ffffff"
                    shimmerSize="0.2em"
                    shimmerDuration="1.5s"
                    background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
                    className="text-midnight-blue font-bold text-xl px-12 py-6 relative"
                    borderRadius="0.75rem"
                  >
                    <span className="flex items-center gap-3">
                      Take the Next Step
                      <motion.span
                        animate={{ x: [0, 8, 0] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <ArrowRightIcon className="w-6 h-6" />
                      </motion.span>
                    </span>
                  </ShimmerButton>
                </motion.div>
              </a>
            </MagneticButton>
          </motion.div>

          {/* Trust Elements */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 }}
            className="flex flex-wrap justify-center gap-8"
          >
            {trustElements.map((element, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 + index * 0.1 }}
                whileHover={{ scale: 1.08, y: -3 }}
                className="flex items-center gap-2 text-white/70 hover:text-white transition-all cursor-default group"
              >
                <motion.div
                  whileHover={{ rotate: 360, scale: 1.2 }}
                  transition={{ duration: 0.5 }}
                  className="relative"
                >
                  <element.icon className="w-5 h-5 text-mint-green" />
                  <motion.div
                    className="absolute inset-0 bg-mint-green rounded-full blur-md opacity-0 group-hover:opacity-50 transition-opacity"
                  />
                </motion.div>
                <span className="text-sm font-medium">{element.text}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Floating decorative elements */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-6">
            {[...Array(7)].map((_, i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-mint-green/40"
                animate={{
                  y: [0, -25, 0],
                  opacity: [0.3, 1, 0.3],
                  scale: [1, 1.5, 1],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  delay: i * 0.15,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
