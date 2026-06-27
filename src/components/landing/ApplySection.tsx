import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import { ShimmerButton } from '../ui/shimmer-button';
import { GradientText } from '../ui/glowing-text';

const trustElements = [
  'No upfront fees',
  "Won't affect your credit",
  'Funding in 24–48 hours',
];

// CTA band — the full application now lives at /apply (embedded GoHighLevel form).
// This replaced the old inline form so there is a single source of truth for applications.
export default function ApplySection() {
  return (
    <section id="apply" className="py-24 lg:py-32 relative overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg, #0a1d37 0%, #12305a 100%)' }}
      />
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-1/4 right-1/4 w-96 h-96 bg-mint-green/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-ocean-blue/20 rounded-full blur-3xl"
          animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
      </div>

      <div className="container-max relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-5 py-2 mb-8 border border-white/20"
          >
            <motion.span
              className="w-2 h-2 rounded-full bg-mint-green"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-white/90 text-sm font-medium">
              Limited time: Same-day funding available
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="heading-2 text-white mb-4"
          >
            Your Application.{' '}
            <GradientText className="font-serif">Your Terms.</GradientText>
          </motion.h2>

          <p className="text-white/80 text-lg mb-8">
            About 3 minutes. No credit impact. Real options from people who actually want to help.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center gap-6"
          >
            <Link to="/apply" aria-label="Apply for funding">
              <ShimmerButton className="px-10 py-4 text-lg font-semibold">
                <span className="inline-flex items-center gap-2">
                  Apply for Funding <ArrowRightIcon className="w-5 h-5" />
                </span>
              </ShimmerButton>
            </Link>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              {trustElements.map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-white/80 text-sm">
                  <CheckCircleIcon className="w-4 h-4 text-mint-green" /> {t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
