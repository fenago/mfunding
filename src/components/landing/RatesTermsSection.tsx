import { motion } from 'framer-motion';
import {
  BoltIcon,
  CreditCardIcon,
  WrenchScrewdriverIcon,
  BanknotesIcon,
  CheckBadgeIcon,
} from '@heroicons/react/24/outline';

/**
 * Transparent rates & terms — at a glance.
 * Patterned after the clarity of best-in-class lenders: one scannable table,
 * plain numbers, no fine print games. Ranges shown are typical and vary by
 * business qualifications; exact pricing is always quoted before you sign.
 */

interface RateRow {
  icon: typeof BoltIcon;
  product: string;
  amount: string;
  cost: string;
  costNote: string;
  term: string;
  timeToFund: string;
  color: string;
}

const rows: RateRow[] = [
  {
    icon: BoltIcon,
    product: 'Merchant Cash Advance',
    amount: '$5K – $1M',
    cost: '1.1 – 1.5',
    costNote: 'Factor rate',
    term: '3 – 18 months',
    timeToFund: '24 – 48 hours',
    color: '#00D49D',
  },
  {
    icon: CreditCardIcon,
    product: 'Business Line of Credit',
    amount: 'Up to $1.25M',
    cost: 'From ~8% APR',
    costNote: 'Pay only on what you draw',
    term: 'Revolving',
    timeToFund: '1 – 3 days',
    color: '#007EA7',
  },
  {
    icon: WrenchScrewdriverIcon,
    product: 'Equipment Financing',
    amount: 'Up to $3M',
    cost: 'Fixed rate',
    costNote: 'Equipment is the collateral',
    term: '1 – 5 years',
    timeToFund: '3 – 5 days',
    color: '#00A896',
  },
  {
    icon: BanknotesIcon,
    product: 'Business Term Loan',
    amount: '$25K – $500K',
    cost: 'From ~9% APR',
    costNote: 'Fixed, predictable payments',
    term: '6 – 60 months',
    timeToFund: '1 – 3 days',
    color: '#0C516E',
  },
];

const columns = ['Funding amount', 'Cost', 'Repayment term', 'Time to fund'];

export default function RatesTermsSection() {
  return (
    <section id="rates" className="section-padding bg-white dark:bg-background relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-mint-green/10 rounded-full text-mint-green text-sm font-medium mb-4">
            <CheckBadgeIcon className="w-4 h-4" />
            Rates &amp; Terms
          </span>
          <h2 className="heading-2 text-heading mb-4">
            No Surprises.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint-green to-teal">
              Here Are the Numbers.
            </span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Every funding option, side by side. The ranges below are typical — your
            exact terms are quoted in writing before you ever commit.
          </p>
        </motion.div>

        {/* Desktop table */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="hidden md:block max-w-5xl mx-auto rounded-2xl border border-gray-100 dark:border-white/10 shadow-md overflow-hidden bg-white dark:bg-midnight-blue/30"
        >
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 dark:bg-midnight-blue/50 border-b border-gray-100 dark:border-white/10">
                <th className="py-4 px-6 text-sm font-semibold text-heading">Funding type</th>
                {columns.map((col) => (
                  <th key={col} className="py-4 px-6 text-sm font-semibold text-heading">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.product}
                  className={`border-b border-gray-100 dark:border-white/10 last:border-b-0 ${
                    i % 2 === 1 ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
                  }`}
                >
                  <td className="py-5 px-6">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${row.color}15` }}
                      >
                        <row.icon className="w-5 h-5" style={{ color: row.color }} />
                      </span>
                      <span className="font-semibold text-heading">{row.product}</span>
                    </div>
                  </td>
                  <td className="py-5 px-6 font-semibold" style={{ color: row.color }}>
                    {row.amount}
                  </td>
                  <td className="py-5 px-6">
                    <span className="font-semibold text-heading">{row.cost}</span>
                    <span className="block text-xs text-text-secondary mt-0.5">{row.costNote}</span>
                  </td>
                  <td className="py-5 px-6 text-body">{row.term}</td>
                  <td className="py-5 px-6 text-body">{row.timeToFund}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        {/* Mobile cards */}
        <div className="md:hidden grid gap-4 max-w-md mx-auto">
          {rows.map((row, i) => (
            <motion.div
              key={row.product}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="rounded-xl border border-gray-100 dark:border-white/10 p-5 bg-white dark:bg-midnight-blue/30 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${row.color}15` }}
                >
                  <row.icon className="w-5 h-5" style={{ color: row.color }} />
                </span>
                <span className="font-semibold text-heading">{row.product}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-text-secondary text-xs">Funding amount</dt>
                  <dd className="font-semibold" style={{ color: row.color }}>{row.amount}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Cost</dt>
                  <dd className="font-semibold text-heading">{row.cost}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Repayment term</dt>
                  <dd className="text-body">{row.term}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">Time to fund</dt>
                  <dd className="text-body">{row.timeToFund}</dd>
                </div>
              </dl>
            </motion.div>
          ))}
        </div>

        {/* Honest footnote */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center text-xs text-text-secondary max-w-3xl mx-auto mt-8 leading-relaxed"
        >
          A merchant cash advance is a purchase of future receivables, not a loan. Amounts,
          rates, and terms shown are typical ranges and depend on your business's revenue, time
          in business, and industry. We compare offers across our network of funding partners and
          present your exact terms — and total cost — in writing before you sign. No upfront fees, ever.
        </motion.p>
      </div>
    </section>
  );
}
