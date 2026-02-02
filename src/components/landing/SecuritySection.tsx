import { motion } from 'framer-motion';
import {
  ShieldCheckIcon,
  LockClosedIcon,
  ServerIcon,
  FingerPrintIcon,
} from '@heroicons/react/24/outline';

const integrations = [
  { name: 'Plaid', description: 'Secure bank verification' },
  { name: 'Yodlee', description: 'Financial data aggregation' },
];

const securityFeatures = [
  { icon: LockClosedIcon, label: '256-bit encryption' },
  { icon: ServerIcon, label: 'Secure data centers' },
  { icon: FingerPrintIcon, label: 'Strict privacy controls' },
];

const certifications = [
  { name: 'SOC 2', label: 'Type II Certified' },
  { name: 'GDPR', label: 'Compliant' },
  { name: 'CCPA', label: 'Compliant' },
];

export default function SecuritySection() {
  return (
    <section id="security" className="section-padding bg-background">
      <div className="container-max">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16">
          {/* Integrations */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 flex items-center justify-center">
                <ShieldCheckIcon className="w-6 h-6 text-ocean-blue" />
              </div>
              <h3 className="text-xl font-semibold text-heading">
                Securely Connects to Your Bank
              </h3>
            </div>

            <p className="text-text-secondary mb-8">
              We use bank-level security to securely verify your business's cash flow.
              Your credentials are never stored on our servers.
            </p>

            {/* Integration Logos */}
            <div className="flex flex-wrap gap-4">
              {integrations.map((integration, index) => (
                <div
                  key={index}
                  className="bg-white rounded-xl px-6 py-4 border border-gray-200 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-ocean-blue/10 flex items-center justify-center">
                    <span className="text-ocean-blue font-bold text-sm">
                      {integration.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-heading">{integration.name}</p>
                    <p className="text-xs text-text-secondary">{integration.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Security & Compliance */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-mint-green/10 flex items-center justify-center">
                <LockClosedIcon className="w-6 h-6 text-mint-green" />
              </div>
              <h3 className="text-xl font-semibold text-heading">
                Your Data is Always Protected
              </h3>
            </div>

            <p className="text-text-secondary mb-8">
              We take security seriously. Your information is protected by industry-leading
              security measures and strict privacy controls.
            </p>

            {/* Certifications */}
            <div className="flex flex-wrap gap-3 mb-8">
              {certifications.map((cert, index) => (
                <div
                  key={index}
                  className="bg-mint-green/10 rounded-lg px-4 py-2 border border-mint-green/20"
                >
                  <p className="font-bold text-heading text-sm">{cert.name}</p>
                  <p className="text-xs text-text-secondary">{cert.label}</p>
                </div>
              ))}
            </div>

            {/* Security Features */}
            <div className="space-y-3">
              {securityFeatures.map((feature, index) => (
                <div key={index} className="flex items-center gap-3">
                  <feature.icon className="w-5 h-5 text-mint-green" />
                  <span className="text-text-secondary">{feature.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
