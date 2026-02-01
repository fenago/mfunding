import { motion, useMotionValue, useTransform, animate, useInView } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface CountAnimationProps {
  number: number;
  className?: string;
  duration?: number;
  suffix?: string;
  prefix?: string;
}

export function CountAnimation({
  number,
  className = 'text-4xl font-bold',
  duration = 2,
  suffix = '',
  prefix = '',
}: CountAnimationProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));

  useEffect(() => {
    if (isInView) {
      const animation = animate(count, number, { duration });
      return animation.stop;
    }
  }, [isInView, count, number, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}
