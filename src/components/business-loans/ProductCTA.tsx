import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ProductCTAProps {
  productName: string;
}

export default function ProductCTA({ productName }: ProductCTAProps) {
  return (
    <section
      className="py-20 lg:py-28"
      style={{
        background: 'linear-gradient(135deg, #0A2342 0%, #0C516E 50%, #007EA7 100%)',
      }}
    >
      <div className="container-max text-center">
        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="heading-2 text-white mb-4"
        >
          Ready to Get Funded?
        </motion.h2>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-xl text-white/70 mb-10 max-w-2xl mx-auto"
        >
          Apply in 5 minutes. No credit impact. No obligation.
        </motion.p>

        {/* Primary CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Link
            to="/#apply"
            className="inline-block bg-mint-green hover:bg-mint-green/90 text-midnight-blue font-bold text-lg px-10 py-4 rounded-xl transition-colors"
          >
            Apply for {productName}
          </Link>
        </motion.div>

        {/* Trust Pills */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-wrap items-center justify-center gap-6 mt-8"
        >
          <span className="text-white/50 text-sm">5-Minute Application</span>
          <span className="text-white/30">|</span>
          <span className="text-white/50 text-sm">Won't Affect Credit</span>
          <span className="text-white/30">|</span>
          <span className="text-white/50 text-sm">24-Hour Decision</span>
        </motion.div>
      </div>
    </section>
  );
}
