import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import Navbar from '../components/landing/Navbar';
import Footer from '../components/landing/Footer';
import ScrollToTop from '../components/ui/ScrollToTop';
import SEO from '../components/seo/SEO';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import supabase from '../supabase';

export default function OptinPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [agreedToSms, setAgreedToSms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToSms) {
      setError("Please agree to the consent terms to proceed.");
      return;
    }
    
    setIsSubmitting(true);
    setError(null);

    // Save to database, maybe a specific optins table or contact_submissions
    const { error: submitError } = await supabase.from('contact_submissions').insert({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      subject: 'Communication Opt-In',
      message: 'User opted in to SMS and phone communication.',
    });

    setIsSubmitting(false);

    if (submitError) {
      console.error('Opt-in submission error:', submitError);
    }
    
    setIsSubmitted(true);
  };

  return (
    <>
      <SEO title="Get Funding Updates" description="Opt in for business funding updates from Momentum Funding." noIndex={true} />
      <Navbar />
      <ScrollToTop />
      <main className="min-h-screen py-24 bg-gray-50 dark:bg-gray-900">
        <div className="container-max max-w-3xl mx-auto px-4 mt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 md:p-12"
          >
            {isSubmitted ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-mint-green rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircleIcon className="w-8 h-8 text-midnight-blue" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                  Thank You for Subscribing!
                </h2>
                <p className="text-gray-600 dark:text-gray-300 mb-8 max-w-lg mx-auto">
                  You have successfully opted in to receive communications from mFunding. We look forward to connecting with you.
                </p>
                <Link
                  to="/"
                  className="bg-ocean-blue hover:bg-ocean-blue/90 text-white font-medium px-6 py-3 rounded-lg transition-colors inline-block"
                >
                  Return to Homepage
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center mb-10">
                  <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                    Stay Connected
                  </h1>
                  <p className="text-gray-600 dark:text-gray-300">
                    Opt-in to receive important funding updates, exclusive offers, and expert advice directly to your phone.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white transition-colors focus:ring-2 focus:ring-ocean-blue"
                        placeholder="John Doe"
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Email Address *
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          required
                          value={formData.email}
                          onChange={handleChange}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white transition-colors focus:ring-2 focus:ring-ocean-blue"
                          placeholder="john@example.com"
                        />
                      </div>
                      <div>
                        <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Mobile Phone Number *
                        </label>
                        <input
                          type="tel"
                          id="phone"
                          name="phone"
                          required
                          value={formData.phone}
                          onChange={handleChange}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white transition-colors focus:ring-2 focus:ring-ocean-blue"
                          placeholder="(555) 123-4567"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/50 p-6 rounded-xl border border-gray-100 dark:border-gray-700 mt-6 md:mt-8">
                    <label className="flex items-start gap-4 cursor-pointer group">
                      <div className="flex-shrink-0 mt-1">
                        <input
                          type="checkbox"
                          required
                          checked={agreedToSms}
                          onChange={(e) => setAgreedToSms(e.target.checked)}
                          className="w-5 h-5 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue cursor-pointer"
                        />
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                        <strong className="block text-sm mb-1 text-gray-900 dark:text-white font-semibold">
                          Communication Consent (TCPA Compliant)
                        </strong>
                        By checking this box and clicking "Subscribe", I provide my express written consent for mFunding or its representatives to contact me at the phone number provided above via phone calls, SMS/text messages, and pre-recorded or artificial voice messages regarding funding options and related marketing, using an automated telephone dialing system. I understand that my consent is not a condition of purchasing any goods or services, and I can opt-out at any time by replying STOP to any text. Message and data rates may apply. For more information, please review our <Link to="/privacy" className="text-ocean-blue hover:underline">Privacy Policy</Link> and <Link to="/terms" className="text-ocean-blue hover:underline">Terms of Service</Link>.
                      </div>
                    </label>
                  </div>

                  {error && (
                    <div className="text-red-600 text-sm font-medium bg-red-50 p-3 rounded-md border border-red-100">
                      {error}
                    </div>
                  )}

                  <div className="pt-4">
                    <ShimmerButton
                      type="submit"
                      shimmerColor="#ffffff"
                      shimmerSize="0.1em"
                      shimmerDuration="2s"
                      background="linear-gradient(135deg, #007EA7 0%, #0C516E 100%)"
                      className="w-full text-white font-bold text-lg py-4 transition-transform hover:scale-[1.02]"
                      borderRadius="0.75rem"
                      disabled={isSubmitting || !agreedToSms}
                    >
                      {isSubmitting ? 'Processing...' : 'Subscribe & Opt-In'}
                    </ShimmerButton>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      </main>
      <Footer />
    </>
  );
}
