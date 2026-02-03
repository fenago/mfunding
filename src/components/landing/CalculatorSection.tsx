import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CurrencyDollarIcon,
  CheckBadgeIcon,
  ClockIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US');
}

// Custom range slider
function RangeSlider({
  value,
  onChange,
  min,
  max,
  step,
  minLabel,
  maxLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const percentage = ((value - min) / (max - min)) * 100;

  const updateValue = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + pct * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, stepped)));
    },
    [min, max, step, onChange]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    updateValue(e.clientX);
    const onMove = (ev: MouseEvent) => {
      if (isDragging.current) updateValue(ev.clientX);
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    updateValue(e.touches[0].clientX);
    const onMove = (ev: TouchEvent) => {
      if (isDragging.current) updateValue(ev.touches[0].clientX);
    };
    const onEnd = () => {
      isDragging.current = false;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
  };

  return (
    <div>
      <div
        ref={trackRef}
        className="relative h-2 bg-gray-200 rounded-full cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Filled track */}
        <div
          className="absolute h-full bg-[#4CAF50] rounded-full"
          style={{ width: `${percentage}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-[3px] border-[#4CAF50] rounded-full shadow-md"
          style={{ left: `${percentage}%`, marginLeft: '-10px' }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

export default function CalculatorSection() {
  const [amount, setAmount] = useState(20000);
  const [factorRate, setFactorRate] = useState(1.29);
  const [term, setTerm] = useState(10);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');

  const totalRepayment = amount * factorRate;
  const totalBusinessDays = term * 20; // ~20 business days per month
  const totalWeeks = term * 4; // 4 weeks per month
  const dailyPayment = Math.round(totalRepayment / totalBusinessDays);
  const weeklyPayment = Math.round(totalRepayment / totalWeeks);
  const payment = frequency === 'daily' ? dailyPayment : weeklyPayment;

  const handleAmountInput = (val: string) => {
    const num = parseInt(val.replace(/,/g, ''));
    if (!isNaN(num) && num >= 5000 && num <= 1000000) {
      setAmount(num);
    }
  };

  const handleFactorInput = (val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 1.2 && num <= 1.49) {
      setFactorRate(Math.round(num * 100) / 100);
    }
  };

  const handleTermInput = (val: string) => {
    const num = parseInt(val);
    if (!isNaN(num) && num >= 3 && num <= 18) {
      setTerm(num);
    }
  };

  return (
    <section id="calculator" className="section-padding bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
      <div className="container-max relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-2 bg-[#4CAF50]/10 rounded-full text-[#4CAF50] text-sm font-medium mb-4">
            Funding Calculator
          </span>
          <h2 className="heading-2 text-midnight-blue dark:text-white mb-4">
            See What You{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4CAF50] to-teal">
              Qualify For
            </span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Get an instant estimate. No credit check. No commitment.
          </p>
        </motion.div>

        {/* Calculator Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-5xl mx-auto"
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="grid lg:grid-cols-5">
              {/* Left Panel - Green */}
              <div className="lg:col-span-2 bg-[#4CAF50] p-8 lg:p-10 flex flex-col justify-center text-white">
                <h3 className="text-3xl lg:text-4xl font-bold leading-tight mb-8">
                  Merchant Cash Advance Calculator
                </h3>

                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckBadgeIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium leading-snug pt-2">
                      Approvals of 50%-150% of Average Monthly Sales
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CurrencyDollarIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium leading-snug pt-2">
                      No Minimum Credit Score
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CurrencyDollarIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium leading-snug pt-2">
                      All Industries Qualify
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ClockIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium leading-snug pt-2">
                      24 Hour Approval and Funding
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Panel - Calculator */}
              <div className="lg:col-span-3 p-8 lg:p-10">
                {/* Amount */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      How much do you need?
                    </label>
                    <div className="flex items-center bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      <span className="px-2 py-1.5 bg-[#4CAF50] text-white text-sm font-bold">$</span>
                      <input
                        type="text"
                        value={formatCurrency(amount)}
                        onChange={(e) => handleAmountInput(e.target.value)}
                        className="w-24 px-2 py-1.5 text-sm font-semibold text-[#4CAF50] bg-transparent outline-none text-right"
                      />
                    </div>
                  </div>
                  <RangeSlider
                    value={amount}
                    onChange={setAmount}
                    min={5000}
                    max={1000000}
                    step={5000}
                    minLabel="$5,000"
                    maxLabel="$1,000,000"
                  />
                </div>

                {/* Factor Rate */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      Estimated Factor Rate
                    </label>
                    <input
                      type="text"
                      value={factorRate.toFixed(2)}
                      onChange={(e) => handleFactorInput(e.target.value)}
                      className="w-20 px-3 py-1.5 text-sm font-semibold text-[#4CAF50] bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-center outline-none"
                    />
                  </div>
                  <RangeSlider
                    value={factorRate}
                    onChange={(v) => setFactorRate(Math.round(v * 100) / 100)}
                    min={1.2}
                    max={1.49}
                    step={0.01}
                    minLabel="1.2"
                    maxLabel="1.49"
                  />
                </div>

                {/* Term */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      Estimated Term
                    </label>
                    <input
                      type="text"
                      value={term}
                      onChange={(e) => handleTermInput(e.target.value)}
                      className="w-20 px-3 py-1.5 text-sm font-semibold text-[#4CAF50] bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-center outline-none"
                    />
                  </div>
                  <RangeSlider
                    value={term}
                    onChange={setTerm}
                    min={3}
                    max={18}
                    step={1}
                    minLabel="3 Months"
                    maxLabel="18 Months"
                  />
                </div>

                {/* Payment Frequency */}
                <div className="mb-6">
                  <div className="flex items-center justify-between">
                    <label className="text-base font-semibold text-gray-800 dark:text-white">
                      Payment Frequency
                    </label>
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                      <button
                        onClick={() => setFrequency('daily')}
                        className={`px-5 py-2 text-sm font-semibold transition-colors ${
                          frequency === 'daily'
                            ? 'bg-[#4CAF50] text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        Daily
                      </button>
                      <button
                        onClick={() => setFrequency('weekly')}
                        className={`px-5 py-2 text-sm font-semibold transition-colors ${
                          frequency === 'weekly'
                            ? 'bg-[#4CAF50] text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        Weekly
                      </button>
                    </div>
                  </div>
                </div>

                {/* Result */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-3xl font-bold text-[#4CAF50]">
                    ${formatCurrency(payment)}/{frequency === 'daily' ? 'day' : 'week'}
                  </p>
                  <a
                    href="#apply"
                    className="inline-flex items-center gap-2 text-base font-semibold text-gray-700 dark:text-gray-300 hover:text-[#4CAF50] transition-colors"
                  >
                    Continue
                    <span className="w-8 h-8 bg-[#4CAF50] text-white rounded-lg flex items-center justify-center">
                      <ArrowRightIcon className="w-4 h-4" />
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
