'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform, useInView } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NumberTickerProps {
  value: number;
  direction?: 'up' | 'down';
  delay?: number;
  className?: string;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
}

export function NumberTicker({
  value,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
  prefix = '',
  suffix = '',
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [hasAnimated, setHasAnimated] = useState(false);

  const springValue = useSpring(direction === 'up' ? 0 : value, {
    bounce: 0,
    duration: 2000,
  });

  const displayValue = useTransform(springValue, (current) =>
    Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(current)
  );

  useEffect(() => {
    if (isInView && !hasAnimated) {
      setTimeout(() => {
        springValue.set(direction === 'up' ? value : 0);
        setHasAnimated(true);
      }, delay * 1000);
    }
  }, [isInView, hasAnimated, springValue, value, direction, delay]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      <motion.span>{displayValue}</motion.span>
      {suffix}
    </span>
  );
}

// Flip-style number display
interface FlipNumberProps {
  value: number;
  className?: string;
}

export function FlipNumber({ value, className }: FlipNumberProps) {
  const digits = String(value).padStart(2, '0').split('');

  return (
    <div className={cn('flex gap-1', className)}>
      {digits.map((digit, index) => (
        <motion.div
          key={`${index}-${digit}`}
          className="relative w-12 h-16 bg-gradient-to-b from-gray-800 to-gray-900 rounded-lg overflow-hidden shadow-lg"
          initial={{ rotateX: -90 }}
          animate={{ rotateX: 0 }}
          transition={{ duration: 0.3, delay: index * 0.1 }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-white">
            {digit}
          </div>
          <div className="absolute inset-x-0 top-1/2 h-px bg-black/30" />
        </motion.div>
      ))}
    </div>
  );
}
