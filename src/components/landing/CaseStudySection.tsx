import { motion } from 'framer-motion';
import { StarIcon } from '@heroicons/react/24/solid';
import { InfiniteSliderWithFade } from '../ui/infinite-slider';

const caseStudy = {
  headline: 'From Sleepless Nights to Sleeping Sound',
  results: [
    { label: 'Funded in', value: '48', suffix: ' Hours' },
    { label: 'Made Payroll', value: 'On Time', isText: true },
    { label: 'Profit Margin', value: '15', suffix: '% Secured' },
  ],
  beforeQuote: "The ceiling has cracks. I've been staring at them for hours. Every line a worry, every split a bill I can't pay.",
  afterQuote: "For the first time in months, I can take a full, deep breath. The weight is gone. I'm not just a guy trying to survive anymore—I'm the man in charge.",
  author: 'Mike C.',
  role: 'Construction Business Owner',
};

const testimonials = [
  {
    quote:
      "For the first time in months, I can take a full, deep breath without that familiar tightness in my chest.",
    author: 'Sarah M.',
    role: 'Restaurant Owner',
    rating: 5,
  },
  {
    quote:
      "I'm not just a guy trying to survive anymore. I'm thinking about growth. About the future.",
    author: 'James T.',
    role: 'Auto Shop Owner',
    rating: 5,
  },
  {
    quote:
      "The weight is gone. The anxiety has been replaced by quiet confidence.",
    author: 'Linda K.',
    role: 'Retail Store Owner',
    rating: 5,
  },
  {
    quote:
      "They understood my business when banks just saw numbers. That human touch made all the difference.",
    author: 'Robert P.',
    role: 'Landscaping Business',
    rating: 5,
  },
  {
    quote:
      "Fast, simple, and they kept me informed every step of the way. This is how business should be done.",
    author: 'Maria G.',
    role: 'Bakery Owner',
    rating: 5,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function CaseStudySection() {
  return (
    <section id="case-study" className="section-padding bg-deep-sea relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -right-40 w-96 h-96 bg-mint-green/10 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-40 -left-40 w-96 h-96 bg-ocean-blue/10 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.2, 0.1, 0.2],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="container-max relative z-10">
        {/* Main Case Study */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.p
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-block px-4 py-2 bg-mint-green/20 rounded-full text-mint-green text-sm font-semibold mb-6"
          >
            SUCCESS STORY
          </motion.p>
          <h2 className="heading-2 text-white mb-8 max-w-3xl mx-auto">
            {caseStudy.headline}
          </h2>

          {/* Key Results with animated counters */}
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="flex flex-wrap justify-center gap-8 lg:gap-16 mb-12"
          >
            {caseStudy.results.map((result, index) => (
              <motion.div
                key={index}
                variants={itemVariants}
                whileHover={{ scale: 1.05, y: -5 }}
                className="text-center group cursor-default"
              >
                <motion.div
                  className="text-3xl lg:text-5xl font-bold text-mint-green mb-1"
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + index * 0.1, duration: 0.5, type: 'spring' }}
                >
                  {result.isText ? (
                    result.value
                  ) : (
                    <>
                      <span className="tabular-nums">{result.value}</span>
                      <span className="text-2xl lg:text-3xl">{result.suffix}</span>
                    </>
                  )}
                </motion.div>
                <p className="text-white/70 text-sm group-hover:text-white/90 transition-colors">
                  {result.label}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {/* Before/After Quotes */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="max-w-4xl mx-auto relative"
          >
            <div className="grid md:grid-cols-2 gap-6">
              {/* Before Quote */}
              <motion.div
                className="relative glass-dark rounded-2xl p-6 border border-red-500/20"
                whileHover={{ scale: 1.02 }}
              >
                <div className="text-xs font-semibold text-red-400/80 uppercase tracking-wider mb-3">Before Momentum</div>
                <blockquote className="text-white/80 italic leading-relaxed text-lg">
                  "{caseStudy.beforeQuote}"
                </blockquote>
              </motion.div>

              {/* After Quote */}
              <motion.div
                className="relative rounded-2xl p-6 border-2 border-mint-green/30 bg-mint-green/5"
                whileHover={{ scale: 1.02 }}
              >
                <motion.div
                  className="absolute -inset-2 bg-gradient-to-r from-mint-green/20 via-teal/20 to-mint-green/20 rounded-2xl blur-xl -z-10"
                  animate={{ opacity: [0.3, 0.5, 0.3] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="text-xs font-semibold text-mint-green uppercase tracking-wider mb-3">After Momentum</div>
                <blockquote className="text-white italic leading-relaxed text-lg">
                  "{caseStudy.afterQuote}"
                </blockquote>
              </motion.div>
            </div>

            {/* Author */}
            <div className="flex items-center justify-center gap-3 mt-8">
              <motion.div
                className="w-12 h-12 rounded-full bg-gradient-to-br from-mint-green to-teal flex items-center justify-center"
                whileHover={{ scale: 1.1, rotate: 5 }}
              >
                <span className="text-midnight-blue font-bold">
                  {caseStudy.author.charAt(0)}
                </span>
              </motion.div>
              <div className="text-left">
                <p className="text-white font-medium">{caseStudy.author}</p>
                <p className="text-white/60 text-sm">{caseStudy.role}</p>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Infinite scrolling testimonials */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <InfiniteSliderWithFade duration={35} gap={24} fadeWidth={100}>
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={index}
                whileHover={{ scale: 1.02, y: -5 }}
                className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/10 w-80 flex-shrink-0 hover:bg-white/15 hover:border-mint-green/30 transition-all duration-300"
              >
                {/* Rating */}
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                    >
                      <StarIcon className="w-5 h-5 text-mint-green" />
                    </motion.div>
                  ))}
                </div>

                {/* Quote */}
                <p className="text-white/90 mb-6 leading-relaxed">
                  "{testimonial.quote}"
                </p>

                {/* Author */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-ocean-blue to-teal flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {testimonial.author.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {testimonial.author}
                    </p>
                    <p className="text-white/60 text-xs">{testimonial.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </InfiniteSliderWithFade>
        </motion.div>
      </div>
    </section>
  );
}
