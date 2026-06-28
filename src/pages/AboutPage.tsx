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
  ArrowRightIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Navbar from '../components/landing/Navbar';
import Footer from '../components/landing/Footer';
import ScrollToTop from '../components/ui/ScrollToTop';

const values = [
  {
    icon: BoltIcon,
    title: 'Speed',
    color: 'ocean-blue',
    description:
      'We know time is money. Our streamlined process gets you funded in as little as 24 hours — not weeks.',
  },
  {
    icon: HandThumbUpIcon,
    title: 'Simplicity',
    color: 'mint-green',
    description:
      'No mountains of paperwork. No confusing fine print. We keep things clear, honest, and straightforward.',
  },
  {
    icon: HeartIcon,
    title: 'People First',
    color: 'ocean-blue',
    description:
      "Behind every application is a real person with a real dream. We treat every business owner the way we'd want to be treated.",
  },
  {
    icon: ShieldCheckIcon,
    title: 'Transparency',
    color: 'mint-green',
    description:
      "No hidden fees. No surprises. You'll always know exactly what you're getting and what it costs.",
  },
];

const stats = [
  { label: 'Businesses Funded', value: '2,500+', color: 'text-ocean-blue' },
  { label: 'Capital Deployed', value: '$180M+', color: 'text-mint-green' },
  { label: 'Average Funding Time', value: '24 hrs', color: 'text-ocean-blue' },
  { label: 'Client Satisfaction', value: '97%', color: 'text-mint-green' },
];

const whyUs = [
  'Approvals in as little as 24 hours',
  'Funding from $5K to $5M',
  'All credit types considered',
  'Dedicated funding advisor for every client',
  'No hidden fees or prepayment penalties',
  'Multiple product options tailored to your needs',
];

const team = [
  {
    name: 'Dr. E. Lee',
    role: 'Founder, Board Chair & CEO',
    image: '/team/dr-lee.png',
    bio: 'With over two decades of experience in financial services and business strategy, Dr. Lee founded Momentum Funding to bridge the gap between hardworking business owners and the capital they need to grow.',
  },
  {
    name: 'Stephanie Decker',
    role: 'VP of Sales',
    image: '/team/stephanie-decker.jpg',
    bio: "Stephanie leads our sales team with a client-first approach, ensuring every business owner gets personalized funding solutions that match their unique needs and goals.",
  },
  {
    name: 'Carlos Marquez',
    role: 'VP of Operations',
    image: '/team/carlos-marquez.png',
    bio: "Carlos oversees the day-to-day operations that make our 24-hour funding promise possible, streamlining processes so business owners spend less time waiting and more time growing.",
  },
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
                deserves <span className="text-white font-semibold">fast, fair access to capital</span> — without the runaround.
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
                  <p className={`text-3xl md:text-4xl font-bold mb-1 ${stat.color}`}>
                    {stat.value}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Our Story — with color callouts */}
        <section className="py-20 lg:py-28 bg-white dark:bg-gray-900">
          <div className="container-max">
            <div className="max-w-4xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <span className="inline-block bg-ocean-blue/10 text-ocean-blue text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                  Our Story
                </span>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-8">
                  We've Been Where You Are
                </h2>
              </motion.div>

              <div className="space-y-8">
                {/* Paragraph 1 with left border accent */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="border-l-4 border-ocean-blue pl-6"
                >
                  <p className="text-gray-600 dark:text-gray-300 text-lg leading-relaxed">
                    Momentum Funding was born from a simple frustration:{' '}
                    <span className="text-ocean-blue font-semibold">
                      too many good businesses were being turned away by traditional banks.
                    </span>{' '}
                    Not because they weren't profitable. Not because they weren't growing. But because the system wasn't built for them.
                  </p>
                </motion.div>

                {/* Highlighted callout box */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="bg-gradient-to-r from-ocean-blue/5 to-mint-green/5 dark:from-ocean-blue/10 dark:to-mint-green/10 rounded-2xl p-8 border border-ocean-blue/10 dark:border-ocean-blue/20"
                >
                  <p className="text-gray-700 dark:text-gray-200 text-lg leading-relaxed">
                    We saw <span className="text-ocean-blue font-semibold">contractors losing jobs</span> because they couldn't finance equipment.{' '}
                    <span className="text-ocean-blue font-semibold">Restaurant owners missing expansion opportunities</span> because banks took 60 days to say "no."{' '}
                    <span className="text-ocean-blue font-semibold">Trucking companies watching loads go to competitors</span> because they couldn't cover fuel costs between invoices.
                  </p>
                </motion.div>

                {/* Paragraph 3 with right border accent */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="border-r-4 border-mint-green pr-6 text-right"
                >
                  <p className="text-gray-600 dark:text-gray-300 text-lg leading-relaxed">
                    So we built something different. A funding company that{' '}
                    <span className="text-mint-green font-semibold">moves at the speed of real business.</span>{' '}
                    Where applications take <span className="font-semibold text-gray-900 dark:text-white">minutes, not weeks.</span>{' '}
                    Where your revenue matters more than a credit score. Where a real person answers the phone and actually wants to help.
                  </p>
                </motion.div>

                {/* Bold closing statement with gradient background */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  className="bg-gradient-to-r from-midnight-blue to-ocean-blue rounded-2xl p-8 text-center"
                >
                  <SparklesIcon className="w-8 h-8 text-mint-green mx-auto mb-3" />
                  <p className="text-xl md:text-2xl font-bold text-white">
                    That's Momentum Funding.{' '}
                    <span className="text-mint-green">Fast, simple funding</span> for the businesses that keep America running.
                  </p>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* Leadership Team */}
        <section className="py-20 lg:py-28 bg-gray-50 dark:bg-gray-800/50 relative overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-ocean-blue/5 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-mint-green/5 rounded-full blur-3xl" />
          </div>
          <div className="container-max relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-14"
            >
              <span className="inline-block bg-ocean-blue/10 text-ocean-blue text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                Our Leadership
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                Meet the Team Behind <span className="text-ocean-blue">Your Funding</span>
              </h2>
              <p className="text-gray-600 dark:text-gray-300 text-lg max-w-2xl mx-auto">
                Real people who understand real business — and are committed to getting you the capital you need.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {team.map((member, i) => (
                <motion.div
                  key={member.name}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 shadow-lg hover:shadow-xl transition-shadow group"
                >
                  {/* Photo */}
                  <div className="relative h-72 bg-gradient-to-br from-midnight-blue via-ocean-blue to-midnight-blue overflow-hidden">
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-full h-full object-cover object-top"
                      onError={(e) => {
                        // Hide broken image and show initials fallback
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    {/* Initials fallback (hidden by default) */}
                    <div
                      className="absolute inset-0 items-center justify-center hidden"
                    >
                      <div className="text-center">
                        <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-sm border-2 border-white/20 flex items-center justify-center mx-auto mb-3">
                          <span className="text-3xl font-bold text-white">
                            {member.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')}
                          </span>
                        </div>
                        <p className="text-white/60 text-sm">Photo coming soon</p>
                      </div>
                    </div>
                    {/* Gradient overlay at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>

                  {/* Info */}
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                      {member.name}
                    </h3>
                    <p className="text-ocean-blue font-semibold text-sm mb-3">
                      {member.role}
                    </p>
                    <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                      {member.bio}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Our Values */}
        <section className="py-20 lg:py-28 bg-white dark:bg-gray-900">
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
                What We <span className="text-mint-green">Stand For</span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {values.map((value, i) => {
                const isGreen = value.color === 'mint-green';
                return (
                  <motion.div
                    key={value.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className={`rounded-2xl p-8 border transition-shadow hover:shadow-lg ${
                      isGreen
                        ? 'bg-gradient-to-br from-mint-green/5 to-white dark:from-mint-green/10 dark:to-gray-800 border-mint-green/20 dark:border-mint-green/20'
                        : 'bg-gradient-to-br from-ocean-blue/5 to-white dark:from-ocean-blue/10 dark:to-gray-800 border-ocean-blue/20 dark:border-ocean-blue/20'
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                        isGreen ? 'bg-mint-green/10' : 'bg-ocean-blue/10'
                      }`}
                    >
                      <value.icon
                        className={`w-6 h-6 ${isGreen ? 'text-mint-green' : 'text-ocean-blue'}`}
                      />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                      {value.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300">{value.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Why Choose Us */}
        <section className="py-20 lg:py-28 bg-gray-50 dark:bg-gray-800/50">
          <div className="container-max">
            <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="inline-block bg-ocean-blue/10 text-ocean-blue text-sm font-semibold rounded-full px-4 py-1.5 mb-4">
                  Why Momentum
                </span>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                  Why Business Owners{' '}
                  <span className="text-ocean-blue">Choose Us</span>
                </h2>
                <p className="text-gray-600 dark:text-gray-300 text-lg mb-6">
                  We're not a bank. We're not a faceless online portal. We're a{' '}
                  <span className="text-ocean-blue font-semibold">team of real people</span>{' '}
                  who understand what it takes to run a business — and we're here to help you keep
                  yours moving forward.
                </p>
                <Link
                  to="/#apply"
                  className="inline-flex items-center gap-2 bg-ocean-blue text-white font-semibold px-6 py-3 rounded-xl hover:bg-ocean-blue/90 transition-colors"
                >
                  Get Started Today
                  <ArrowRightIcon className="w-4 h-4" />
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="space-y-4"
              >
                {whyUs.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-start gap-3 bg-white dark:bg-gray-800 rounded-xl px-5 py-4 border border-gray-100 dark:border-gray-700 shadow-sm"
                  >
                    <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 dark:text-gray-200 font-medium">{item}</span>
                  </motion.div>
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
            <motion.div
              className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-mint-green/5 rounded-full blur-3xl"
              animate={{ scale: [1.2, 1, 1.2] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
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
                Ready to Get <span className="text-mint-green">Funded?</span>
              </h2>
              <p className="text-white/70 text-lg mb-8 max-w-2xl mx-auto">
                Join <span className="text-white font-semibold">thousands of business owners</span> who got the capital they needed — fast, simple,
                and on their terms.
              </p>
              <Link
                to="/#apply"
                className="inline-flex items-center gap-2 bg-mint-green text-midnight-blue font-bold px-8 py-4 rounded-xl hover:bg-mint-green/90 transition-colors text-lg"
              >
                Apply Now
                <ArrowRightIcon className="w-5 h-5" />
              </Link>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
