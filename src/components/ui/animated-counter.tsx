'use client';

import { cn } from '@/lib/utils';
import { animate, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  duration?: number;
}

export function AnimatedCounter({
  value,
  suffix = '',
  prefix = '',
  className,
  duration = 2,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isInView) {
      const controls = animate(0, value, {
        duration,
        onUpdate: (latest) => {
          setDisplayValue(Math.round(latest));
        },
      });
      return controls.stop;
    }
  }, [isInView, value, duration]);

  const formattedValue = value >= 1000
    ? Math.round(displayValue / 1000) + 'k'
    : displayValue;

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      <span>{formattedValue}</span>
      {suffix}
    </span>
  );
}

// Simple percentage counter
export function PercentageCounter({
  value,
  className,
  duration = 2,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isInView) {
      const controls = animate(0, value, {
        duration,
        onUpdate: (latest) => {
          setDisplayValue(Math.round(latest));
        },
      });
      return controls.stop;
    }
  }, [isInView, value, duration]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      <span>{displayValue}</span>%
    </span>
  );
}
