import { motion } from 'framer-motion';
import { CheckCircleIcon, ExclamationTriangleIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

interface ProductDocumentsProps {
  documents: string[];
  restrictions?: string[];
}

export default function ProductDocuments({ documents, restrictions }: ProductDocumentsProps) {
  return (
    <section className="section-padding bg-gray-50 dark:bg-gray-900">
      <div className="container-max">
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
            <DocumentTextIcon className="w-4 h-4" />
            What You'll Need
          </motion.span>

          <h2 className="heading-2 text-gray-900 dark:text-white">
            Required{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Documents
            </span>
          </h2>
        </motion.div>

        {/* Documents Checklist */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8"
        >
          <div className="space-y-4">
            {documents.map((doc, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.1 * index }}
                className="flex items-center gap-4"
              >
                <CheckCircleIcon className="w-6 h-6 text-mint-green flex-shrink-0" />
                <span className="text-gray-900 dark:text-white text-base">{doc}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Important Notes (Restrictions) */}
        {restrictions && restrictions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="max-w-3xl mx-auto mt-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-6 border border-yellow-200 dark:border-yellow-700/30"
          >
            <h3 className="text-gray-900 dark:text-white font-semibold mb-4">Important Notes</h3>
            <div className="space-y-3">
              {restrictions.map((restriction, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.1 * index }}
                  className="flex items-start gap-3"
                >
                  <ExclamationTriangleIcon className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                  <span className="text-gray-800 dark:text-gray-200 text-sm">{restriction}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
