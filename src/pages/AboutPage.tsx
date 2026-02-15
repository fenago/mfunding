import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ShieldCheckIcon,
  ClockIcon,
  UserGroupIcon,
  HeartIcon,
  CheckCircleIcon,
  BoltIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/outline';
import Navbar from '../components/landing/Navbar';
import Footer from '../components/landing/Footer';
import ScrollToTop from '../components/ui/ScrollToTop';

const values = [
  {
    icon: BoltIcon,
    title: 'Speed',
    description:
      'We know time is money. Our streamlined process gets you funded in as little as 24 hours — not weeks.',
  },
  {
    icon: HandThumbUpIcon,
    title: 'Simplicity',
    description:
      'No mountains of paperwork. No confusing fine print. We keep things clear, honest, and straightforward.',
  },
  {
    icon: HeartIcon,
    title: 'People First',
    description:
      "Behind every application is a real person with a real dream. We treat every business owner the way we'd want to be treated.",
  },
  {
    icon: ShieldCheckIcon,
    title: 'Transparency',
    description:
      "No hidden fees. No surprises. You'll always know exactly what you're getting and what it costs.",
  },
];

const stats = [
  { label: 'Businesses Funded', value: '2,500+' },
  { label: 'Capital Deployed', value: '$180M+' },
  { label: 'Average Funding Time', value: '24 hrs' },
  { label: 'Client Satisfaction', value: '97%' },
];

const whyUs = [
  'Approvals in as little as 24 hours',
  'Funding from $5K to $5M',
  'All credit types considered',
  'Dedicated funding advisor for every client',
  'No hidden fees or prepayment penalties',
  'Multiple product options tailored to your needs',
];

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <ScrollToTop />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-midnight-blue py-24 lg:py-32">
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-ocean-blue/10 rounded-full blur-3xl"
              animate={{ scale: [1, 1.2, 1], x: [0, 30, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-mint-green/10 rounded-full blur-3xl"
              animate={{ scale: [1.2, 1, 1.2], x: [0, -20, 0] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <div className="container-max relative z-10 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-5 py-2 mb-6 border border-white/20 text-white/90 text-sm font-medium">
                <UserGroupIcon className="w-4 h-4" />
                About Momentum Funding
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                Built for the Businesses That{' '}
                <span className="text-mint-green">Keep America Running</span>
              </h1>
              <p className="text-white/70 text-lg md:text-xl max-w-3xl mx-auto">
                We started Momentum Funding because we believe every hardworking business owner
                deserves fast, fair access to capital — without the runaround.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          <div className="container-max py-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center"
                >
                  <p className="text-3xl md:text-4xl font-bold text-ocean-blue mb-1">
                    {stat.value}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Our Story */}
        <section className="py-20 lg:py-28 bg-white dark:bg-gray-900">
          <div className="container-max">
            <div className="max-w-3xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <span className="inline-block bg-ocean-blue/10 text-ocean-blue text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                  Our Story
                </span>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-6">
                  We've Been Where You Are
                </h2>
                <div className="space-y-5 text-gray-600 dark:text-gray-300 text-lg leading-relaxed">
                  <p>
                    Momentum Funding was born from a simple frustration: too many good businesses
                    were being turned away by traditional banks. Not because they weren't profitable.
                    Not because they weren't growing. But because the system wasn't built for them.
                  </p>
                  <p>
                    We saw contractors losing jobs because they couldn't finance equipment. Restaurant
                    owners missing expansion opportunities because banks took 60 days to say "no."
                    Trucking companies watching loads go to competitors because they couldn't cover
                    fuel costs between invoices.
                  </p>
                  <p>
                    So we built something different. A funding company that moves at the speed of
                    real business. Where applications take minutes, not weeks. Where your revenue
                    matters more than a credit score. Where a real person answers the phone and
                    actually wants to help.
                  </p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    That's Momentum Funding. Fast, simple funding for the businesses that keep
                    America running.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Our Values */}
        <section className="py-20 lg:py-28 bg-gray-50 dark:bg-gray-800/50">
          <div className="container-max">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-14"
            >
              <span className="inline-block bg-mint-green/10 text-mint-green text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                Our Values
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
                What We Stand For
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {values.map((value, i) => (
                <motion.div
                  key={value.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-100 dark:border-gray-700"
                >
                  <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 flex items-center justify-center mb-4">
                    <value.icon className="w-6 h-6 text-ocean-blue" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                    {value.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Choose Us */}
        <section className="py-20 lg:py-28 bg-white dark:bg-gray-900">
          <div className="container-max">
            <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="inline-block bg-ocean-blue/10 text-ocean-blue text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                  Why Momentum
                </span>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                  Why Business Owners Choose Us
                </h2>
                <p className="text-gray-600 dark:text-gray-300 text-lg">
                  We're not a bank. We're not a faceless online portal. We're a team of real people
                  who understand what it takes to run a business — and we're here to help you keep
                  yours moving forward.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="space-y-4"
              >
                {whyUs.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 dark:text-gray-200 font-medium">{item}</span>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 lg:py-28 bg-midnight-blue relative overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-ocean-blue/10 rounded-full blur-3xl"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <div className="container-max relative z-10 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center justify-center gap-2 mb-4">
                <ClockIcon className="w-5 h-5 text-mint-green" />
                <span className="text-mint-green font-medium">5-minute application</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Ready to Get Funded?
              </h2>
              <p className="text-white/70 text-lg mb-8 max-w-2xl mx-auto">
                Join thousands of business owners who got the capital they needed — fast, simple,
                and on their terms.
              </p>
              <Link
                to="/#apply"
                className="inline-flex items-center gap-2 bg-mint-green text-midnight-blue font-bold px-8 py-4 rounded-xl hover:bg-mint-green/90 transition-colors text-lg"
              >
                Apply Now
              </Link>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
