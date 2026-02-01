import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircleIcon, ArrowRightIcon } from '@heroicons/react/24/solid';
import { ShimmerButton } from '../ui/shimmer-button';
import { GradientText } from '../ui/glowing-text';
import supabase from '../../supabase';

const trustElements = [
  'No credit card required',
  'No obligation',
  'Funding in 24 hours',
];

const businessTypes = [
  'Retail',
  'Restaurant / Food Service',
  'Healthcare',
  'Construction',
  'Transportation',
  'Professional Services',
  'Manufacturing',
  'E-commerce',
  'Other',
];

const timeInBusinessOptions = [
  'Less than 6 months',
  '6 months - 1 year',
  '1 - 2 years',
  '2 - 5 years',
  '5+ years',
];

const monthlyRevenueOptions = [
  'Under $10,000',
  '$10,000 - $25,000',
  '$25,000 - $50,000',
  '$50,000 - $100,000',
  '$100,000 - $250,000',
  '$250,000+',
];

export default function ApplySection() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    businessName: '',
    ein: '',
    contactFirstName: '',
    contactLastName: '',
    email: '',
    phone: '',
    fundingAmount: 75000,
    businessType: '',
    timeInBusiness: '',
    monthlyRevenue: '',
    fundingPurpose: '',
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const { error: submitError } = await supabase
      .from('funding_applications')
      .insert({
        business_name: formData.businessName,
        ein: formData.ein || null,
        contact_first_name: formData.contactFirstName,
        contact_last_name: formData.contactLastName,
        email: formData.email,
        phone: formData.phone,
        funding_amount: formData.fundingAmount,
        business_type: formData.businessType,
        time_in_business: formData.timeInBusiness,
        monthly_revenue: formData.monthlyRevenue,
        funding_purpose: formData.fundingPurpose || null,
      });

    setIsSubmitting(false);

    if (submitError) {
      setError('Something went wrong. Please try again.');
      console.error(submitError);
      return;
    }

    setIsSubmitted(true);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  if (isSubmitted) {
    return (
      <section id="apply" className="py-24 lg:py-32 relative overflow-hidden">
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, #0A2342 0%, #0C516E 25%, #007EA7 50%, #0C516E 75%, #0A2342 100%)',
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
        <div className="container-max relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center max-w-2xl mx-auto"
          >
            <div className="w-20 h-20 bg-mint-green rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircleIcon className="w-10 h-10 text-midnight-blue" />
            </div>
            <h2 className="heading-2 text-white mb-4">You Did It. We're On It.</h2>
            <p className="text-white/80 text-lg">
              No more waiting. No more wondering. Our team is reviewing your application
              right now—and we'll reach out within 24 hours with real options.
              <span className="block mt-2 text-mint-green font-medium">You took the first step. We'll handle the rest.</span>
            </p>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section id="apply" className="py-24 lg:py-32 relative overflow-hidden">
      {/* Animated gradient background */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, #0A2342 0%, #0C516E 25%, #007EA7 50%, #0C516E 75%, #0A2342 100%)',
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

      {/* Animated orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-1/4 right-1/4 w-96 h-96 bg-mint-green/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            x: [0, 50, 0],
            y: [0, -30, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-ocean-blue/20 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            x: [0, -50, 0],
            y: [0, 30, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="container-max relative z-10">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
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

            <h2 className="heading-2 text-white mb-4">
              Your Application.{' '}
              <GradientText className="font-serif">Your Terms.</GradientText>
            </h2>
            <p className="text-white/80 text-lg">
              Five minutes. No credit impact. Real options from people who actually want to help.
            </p>
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl p-8 lg:p-12 shadow-2xl"
          >
            <div className="grid md:grid-cols-2 gap-6">
              {/* Business Name */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Business Name *
                </label>
                <input
                  type="text"
                  name="businessName"
                  value={formData.businessName}
                  onChange={handleChange}
                  required
                  className="input-field"
                  placeholder="Your Business Name"
                />
              </div>

              {/* EIN (Optional) */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  EIN <span className="text-text-secondary font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="ein"
                  value={formData.ein}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="XX-XXXXXXX"
                  maxLength={10}
                />
              </div>

              {/* First Name */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  First Name *
                </label>
                <input
                  type="text"
                  name="contactFirstName"
                  value={formData.contactFirstName}
                  onChange={handleChange}
                  required
                  className="input-field"
                  placeholder="John"
                />
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Last Name *
                </label>
                <input
                  type="text"
                  name="contactLastName"
                  value={formData.contactLastName}
                  onChange={handleChange}
                  required
                  className="input-field"
                  placeholder="Smith"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="input-field"
                  placeholder="john@business.com"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                  className="input-field"
                  placeholder="(555) 123-4567"
                />
              </div>

              {/* Funding Amount */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Funding Amount Needed *
                </label>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-ocean-blue">
                    {formatCurrency(formData.fundingAmount)}
                  </span>
                </div>
                <input
                  type="range"
                  name="fundingAmount"
                  min="25000"
                  max="3000000"
                  step="25000"
                  value={formData.fundingAmount}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      fundingAmount: Number(e.target.value),
                    }))
                  }
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-ocean-blue"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  <span>$25K</span>
                  <span>$3M</span>
                </div>
              </div>

              {/* Business Type */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Business Type *
                </label>
                <select
                  name="businessType"
                  value={formData.businessType}
                  onChange={handleChange}
                  required
                  className="input-field"
                >
                  <option value="">Select your industry</option>
                  {businessTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {/* Time in Business */}
              <div>
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Time in Business *
                </label>
                <select
                  name="timeInBusiness"
                  value={formData.timeInBusiness}
                  onChange={handleChange}
                  required
                  className="input-field"
                >
                  <option value="">Select duration</option>
                  {timeInBusinessOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {/* Monthly Revenue */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  Average Monthly Revenue *
                </label>
                <select
                  name="monthlyRevenue"
                  value={formData.monthlyRevenue}
                  onChange={handleChange}
                  required
                  className="input-field"
                >
                  <option value="">Select revenue range</option>
                  {monthlyRevenueOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {/* Funding Purpose */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-midnight-blue mb-2">
                  What will you use the funding for? (Optional)
                </label>
                <textarea
                  name="fundingPurpose"
                  value={formData.fundingPurpose}
                  onChange={handleChange}
                  rows={3}
                  className="input-field resize-none"
                  placeholder="e.g., Equipment purchase, inventory, expansion..."
                />
              </div>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="mt-8">
              <ShimmerButton
                type="submit"
                shimmerColor="#ffffff"
                shimmerSize="0.15em"
                shimmerDuration="2s"
                background="linear-gradient(135deg, #00D49D 0%, #00A896 100%)"
                className="w-full text-midnight-blue font-bold text-xl py-5"
                borderRadius="0.75rem"
                disabled={isSubmitting}
              >
                <span className="flex items-center justify-center gap-3">
                  {isSubmitting ? 'Submitting...' : 'Get My Funding Options'}
                  {!isSubmitting && (
                    <motion.span
                      animate={{ x: [0, 5, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <ArrowRightIcon className="w-5 h-5" />
                    </motion.span>
                  )}
                </span>
              </ShimmerButton>
            </div>

            {/* Trust Elements */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="flex flex-wrap justify-center gap-6 mt-8"
            >
              {trustElements.map((element, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-text-secondary"
                >
                  <CheckCircleIcon className="w-5 h-5 text-mint-green" />
                  <span className="text-sm font-medium">{element}</span>
                </div>
              ))}
            </motion.div>
          </motion.form>
        </div>
      </div>
    </section>
  );
}
