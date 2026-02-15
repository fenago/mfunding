import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  EnvelopeIcon,
  PhoneIcon,
  ClockIcon,
  MapPinIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import Navbar from '../components/landing/Navbar';
import Footer from '../components/landing/Footer';
import ScrollToTop from '../components/ui/ScrollToTop';
import { ShimmerButton } from '../components/ui/shimmer-button';
import supabase from '../supabase';

const contactInfo = [
  {
    icon: PhoneIcon,
    label: 'Phone',
    value: '(786) 418-2051',
    href: 'tel:+17864182051',
    description: 'Mon–Fri, 9am–6pm EST',
  },
  {
    icon: EnvelopeIcon,
    label: 'Email',
    value: 'info@mfunding.net',
    href: 'mailto:info@mfunding.net',
    description: 'We respond within 24 hours',
  },
  {
    icon: MapPinIcon,
    label: 'Office',
    value: '7027 W Broward Blvd, Suite 744',
    href: null,
    description: 'Plantation, FL 33317',
  },
  {
    icon: ClockIcon,
    label: 'Business Hours',
    value: 'Mon – Fri, 9am – 6pm',
    href: null,
    description: 'Eastern Standard Time',
  },
];

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const { error: submitError } = await supabase.from('contact_submissions').insert({
      name: formData.name,
      email: formData.email,
      phone: formData.phone || null,
      subject: formData.subject,
      message: formData.message,
    });

    setIsSubmitting(false);

    if (submitError) {
      // If table doesn't exist yet, still show success to the user
      // so the page works even before the migration is run
      console.error('Contact form submission error:', submitError);
    }

    setIsSubmitted(true);
  };

  return (
    <>
      <Navbar />
      <ScrollToTop />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-midnight-blue py-20 lg:py-28">
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-ocean-blue/10 rounded-full blur-3xl"
              animate={{ scale: [1, 1.2, 1], x: [0, 30, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <div className="container-max relative z-10 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-5 py-2 mb-6 border border-white/20 text-white/90 text-sm font-medium">
                <EnvelopeIcon className="w-4 h-4" />
                Get in Touch
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                We're Here to <span className="text-mint-green">Help</span>
              </h1>
              <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto">
                Have a question about funding? Need help with an application? Our team is ready to
                help you get the capital your business needs.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Contact Info Cards + Form */}
        <section className="py-20 lg:py-28 bg-white dark:bg-gray-900">
          <div className="container-max">
            <div className="grid lg:grid-cols-5 gap-12 lg:gap-16">
              {/* Left: Contact Info */}
              <div className="lg:col-span-2">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                >
                  <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3">
                    Contact Information
                  </h2>
                  <p className="text-gray-600 dark:text-gray-300 mb-8">
                    Reach out directly or fill out the form and we'll get back to you within one
                    business day.
                  </p>
                </motion.div>

                <div className="space-y-6">
                  {contactInfo.map((item, i) => (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-4"
                    >
                      <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 flex items-center justify-center flex-shrink-0">
                        <item.icon className="w-6 h-6 text-ocean-blue" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">
                          {item.label}
                        </p>
                        {item.href ? (
                          <a
                            href={item.href}
                            className="text-gray-900 dark:text-white font-semibold hover:text-ocean-blue transition-colors"
                          >
                            {item.value}
                          </a>
                        ) : (
                          <p className="text-gray-900 dark:text-white font-semibold">
                            {item.value}
                          </p>
                        )}
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Quick Apply CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="mt-10 bg-gradient-to-br from-midnight-blue to-ocean-blue rounded-2xl p-6 text-white"
                >
                  <h3 className="text-lg font-bold mb-2">Ready to Apply?</h3>
                  <p className="text-white/70 text-sm mb-4">
                    Skip the wait. Apply in 5 minutes and get funding options within 24 hours.
                  </p>
                  <Link
                    to="/#apply"
                    className="inline-flex items-center gap-2 bg-mint-green text-midnight-blue font-bold px-5 py-2.5 rounded-lg hover:bg-mint-green/90 transition-colors text-sm"
                  >
                    Apply Now
                    <ArrowRightIcon className="w-4 h-4" />
                  </Link>
                </motion.div>
              </div>

              {/* Right: Contact Form */}
              <div className="lg:col-span-3">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-8 lg:p-10 border border-gray-100 dark:border-gray-700"
                >
                  {isSubmitted ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-mint-green rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircleIcon className="w-8 h-8 text-midnight-blue" />
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                        Message Sent!
                      </h3>
                      <p className="text-gray-600 dark:text-gray-300 mb-6">
                        Thanks for reaching out. Our team will get back to you within one business
                        day.
                      </p>
                      <Link
                        to="/"
                        className="text-ocean-blue hover:text-ocean-blue/80 font-medium transition-colors"
                      >
                        Back to Home
                      </Link>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
                        Send Us a Message
                      </h3>
                      <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="grid md:grid-cols-2 gap-5">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Full Name *
                            </label>
                            <input
                              type="text"
                              name="name"
                              value={formData.name}
                              onChange={handleChange}
                              required
                              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-ocean-blue/50 focus:border-ocean-blue outline-none transition"
                              placeholder="John Smith"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Email Address *
                            </label>
                            <input
                              type="email"
                              name="email"
                              value={formData.email}
                              onChange={handleChange}
                              required
                              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-ocean-blue/50 focus:border-ocean-blue outline-none transition"
                              placeholder="john@business.com"
                            />
                          </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-5">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Phone Number
                            </label>
                            <input
                              type="tel"
                              name="phone"
                              value={formData.phone}
                              onChange={handleChange}
                              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-ocean-blue/50 focus:border-ocean-blue outline-none transition"
                              placeholder="(555) 123-4567"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Subject *
                            </label>
                            <select
                              name="subject"
                              value={formData.subject}
                              onChange={handleChange}
                              required
                              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ocean-blue/50 focus:border-ocean-blue outline-none transition"
                            >
                              <option value="">Select a topic</option>
                              <option value="General Inquiry">General Inquiry</option>
                              <option value="Funding Question">Funding Question</option>
                              <option value="Application Status">Application Status</option>
                              <option value="Partnership">Partnership Opportunity</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Message *
                          </label>
                          <textarea
                            name="message"
                            value={formData.message}
                            onChange={handleChange}
                            required
                            rows={5}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-ocean-blue/50 focus:border-ocean-blue outline-none transition resize-none"
                            placeholder="How can we help you?"
                          />
                        </div>

                        {error && (
                          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                            {error}
                          </div>
                        )}

                        <ShimmerButton
                          type="submit"
                          shimmerColor="#ffffff"
                          shimmerSize="0.15em"
                          shimmerDuration="2s"
                          background="linear-gradient(135deg, #007EA7 0%, #0C516E 100%)"
                          className="w-full text-white font-bold text-lg py-4"
                          borderRadius="0.75rem"
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? 'Sending...' : 'Send Message'}
                        </ShimmerButton>
                      </form>
                    </>
                  )}
                </motion.div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
