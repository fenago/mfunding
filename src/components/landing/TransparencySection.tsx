import { motion } from 'framer-motion';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  HandThumbUpIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

/**
 * Radical honesty builds trust. Patterned after best-in-class lenders who lay out
 * the upsides AND the trade-offs plainly. Counterintuitively, naming the downsides
 * is what makes the upsides believable. Compliance: MCA = purchase of future
 * receivables, never called a "loan."
 */

const pros = [
  'Fast — funding in as little as 24–48 hours.',
  'Approval based on revenue, not just your credit score.',
  'No collateral required for most funding types.',
  'Payments flex with your sales (merchant cash advance).',
  'Use the capital however your business needs.',
];

const cons = [
  'Costs more than a traditional bank loan.',
  'Daily or weekly payments can tighten cash flow.',
  'Paying early doesn’t lower a fixed factor-rate fee.',
  'A merchant cash advance won’t build your business credit.',
];

const goodFit = [
  'You need working capital quickly.',
  'You have steady revenue or card sales.',
  'You’re covering a clear, short-term need or opportunity.',
  'A bank turned you down or can’t move fast enough.',
];

export default function TransparencySection() {
  return (
    <section id="is-it-right" className="section-padding bg-background relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-ocean-blue/10 rounded-full text-ocean-blue text-sm font-medium mb-4">
            <ShieldCheckIcon className="w-4 h-4" />
            The Honest Truth
          </span>
          <h2 className="heading-2 text-heading mb-4">
            Is This{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Right for You?
            </span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            No pressure, no spin. Here are the upsides and the trade-offs, side by side,
            so you can make the call that’s best for your business.
          </p>
        </motion.div>

        {/* Pros & Cons */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
          {/* Pros */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-mint-green/30 bg-mint-green/5 p-7"
          >
            <div className="flex items-center gap-2 mb-5">
              <HandThumbUpIcon className="w-6 h-6 text-mint-green" />
              <h3 className="text-xl font-bold text-heading">The Upsides</h3>
            </div>
            <ul className="space-y-3">
              {pros.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircleIcon className="w-5 h-5 text-mint-green flex-shrink-0 mt-0.5" />
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Cons */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-warning/30 bg-warning/5 p-7"
          >
            <div className="flex items-center gap-2 mb-5">
              <ExclamationTriangleIcon className="w-6 h-6 text-warning" />
              <h3 className="text-xl font-bold text-heading">The Trade-offs</h3>
            </div>
            <ul className="space-y-3">
              {cons.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="w-5 h-5 flex-shrink-0 mt-0.5 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                  </span>
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>

        {/* Good-fit checklist */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-4xl mx-auto rounded-2xl bg-deep-sea text-white p-8 md:p-10"
        >
          <h3 className="text-xl font-bold mb-2">A merchant cash advance makes sense when…</h3>
          <p className="text-white/70 text-sm mb-6">
            If most of these sound like you, it’s probably a strong fit.
          </p>
          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            {goodFit.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircleIcon className="w-5 h-5 text-mint-green flex-shrink-0 mt-0.5" />
                <span className="text-white/90 leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-6 border-t border-white/10">
            <p className="text-white/70 text-sm leading-relaxed">
              <span className="font-semibold text-white">Our promise:</span> we’ll show you the full,
              total cost in writing before you sign — and if a lower-cost option fits you better,
              we’ll tell you. There are never any upfront fees.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
