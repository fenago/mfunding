import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDownIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

interface FAQItem {
  question: string;
  answer: string;
  keywords?: string[]; // For internal SEO tracking
}

const faqs: FAQItem[] = [
  {
    question: "How fast can I get business funding?",
    answer: "Most business owners receive funding within 24-48 hours of approval. Our streamlined application process takes just 5 minutes, and you'll typically hear back within a few hours. We understand that when you need capital, you need it now—not next month.",
    keywords: ["fast business funding", "quick business loans", "same day funding"],
  },
  {
    question: "What credit score do I need for a merchant cash advance?",
    answer: "Unlike traditional bank loans, we focus on your business performance, not just your credit score. We work with business owners who have credit scores as low as 500. What matters most is your monthly revenue ($10K+ minimum) and time in business (6+ months). Your past credit struggles don't define your business's future.",
    keywords: ["merchant cash advance credit score", "bad credit business loan", "MCA requirements"],
  },
  {
    question: "Can I get business funding if the bank turned me down?",
    answer: "Yes! We specialize in helping business owners who have been declined by traditional banks. Our 93% approval rate means we find solutions when others can't. We look at your business's current performance and cash flow, not just your past credit history. A bank rejection is where most of our customers start.",
    keywords: ["business loan denied", "bank turned down", "alternative business financing"],
  },
  {
    question: "What documents do I need to apply?",
    answer: "Our application is simple. You'll need: 3 months of business bank statements, a valid ID, and basic business information. That's it. No tax returns, no lengthy financial statements, no waiting weeks for a decision. Most applications are completed in under 5 minutes.",
    keywords: ["business loan documents", "MCA application requirements"],
  },
  {
    question: "Will applying affect my credit score?",
    answer: "No. Checking your rate with us uses a soft credit pull, which does not impact your credit score. You can see your options with no obligation and no credit impact. We only do a hard pull if you accept an offer and move forward—and we'll always let you know first.",
    keywords: ["soft credit check", "no credit impact", "check business loan rate"],
  },
  {
    question: "How much funding can I qualify for?",
    answer: "Funding amounts range from $25,000 to $3,000,000 depending on your business revenue and the type of funding. Most small businesses qualify for $50,000 to $250,000. As a general rule, you can typically qualify for up to 100-150% of your average monthly revenue. Use our calculator above for an instant estimate.",
    keywords: ["business funding amount", "how much can I borrow", "MCA funding limits"],
  },
  {
    question: "What's the difference between an MCA and a business loan?",
    answer: "A Merchant Cash Advance (MCA) is not a loan—it's an advance on your future sales. You repay as a percentage of daily sales, so payments adjust with your business. When business is slow, you pay less. When it picks up, you're free faster. There's no fixed monthly payment, no collateral required, and no personal assets at risk.",
    keywords: ["MCA vs business loan", "merchant cash advance explained", "what is MCA"],
  },
  {
    question: "Do I need collateral for business funding?",
    answer: "No collateral is required for merchant cash advances or business lines of credit. Your home, car, and personal assets are never at risk. For equipment financing, the equipment itself serves as collateral—but that's the only type of funding where any collateral is involved.",
    keywords: ["unsecured business funding", "no collateral business loan", "business funding without collateral"],
  },
];

function FAQItem({ faq, isOpen, onClick, index }: {
  faq: FAQItem;
  isOpen: boolean;
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="border-b border-gray-200 dark:border-white/10 last:border-b-0"
    >
      <button
        onClick={onClick}
        className="w-full py-6 flex items-center justify-between text-left group"
        aria-expanded={isOpen}
      >
        <h3 className="text-lg font-semibold text-midnight-blue dark:text-white pr-8 group-hover:text-ocean-blue transition-colors">
          {faq.question}
        </h3>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0"
        >
          <ChevronDownIcon className={`w-5 h-5 transition-colors ${
            isOpen ? 'text-mint-green' : 'text-gray-400 group-hover:text-ocean-blue'
          }`} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="pb-6 text-text-secondary leading-relaxed pr-12">
              {faq.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0); // First one open by default

  return (
    <section id="faq" className="section-padding bg-background relative overflow-hidden">
      {/* Background decoration */}
      <motion.div
        className="absolute top-1/4 -right-32 w-[500px] h-[500px] bg-mint-green/5 rounded-full blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 -left-32 w-[400px] h-[400px] bg-ocean-blue/5 rounded-full blur-3xl"
        animate={{ scale: [1.2, 1, 1.2], opacity: [0.4, 0.2, 0.4] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="container-max relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ocean-blue/10 rounded-full text-ocean-blue text-sm font-medium mb-4"
          >
            <QuestionMarkCircleIcon className="w-4 h-4" />
            Common Questions
          </motion.span>

          <h2 className="heading-2 text-midnight-blue dark:text-white mb-4">
            Frequently Asked{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Questions
            </span>
          </h2>

          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Get answers to the most common questions about business funding.
            Still have questions? We're here to help.
          </p>
        </motion.div>

        {/* FAQ List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-3xl mx-auto bg-white dark:bg-midnight-blue/30 rounded-2xl border border-gray-100 dark:border-white/10 p-8 shadow-sm"
        >
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              faq={faq}
              index={index}
              isOpen={openIndex === index}
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mt-12"
        >
          <p className="text-text-secondary mb-4">
            Don't see your question? Our funding specialists are ready to help.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#apply"
              className="btn-primary inline-flex items-center gap-2"
            >
              Get Your Free Quote
              <motion.span
                animate={{ x: [0, 4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                →
              </motion.span>
            </a>
            <a
              href="tel:+18005550123"
              className="text-ocean-blue hover:text-mint-green transition-colors font-medium"
            >
              Or call us: (800) 555-0123
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
