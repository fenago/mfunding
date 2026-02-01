'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface GlowingTextProps {
  children: ReactNode;
  className?: string;
  glowColor?: string;
}

export function GlowingText({
  children,
  className,
  glowColor = 'rgba(0, 212, 157, 0.8)',
}: GlowingTextProps) {
  return (
    <motion.span
      className={cn('relative inline-block', className)}
      whileHover={{ scale: 1.02 }}
    >
      <span
        className="absolute inset-0 blur-lg opacity-60"
        style={{ color: glowColor }}
      >
        {children}
      </span>
      <span className="relative">{children}</span>
    </motion.span>
  );
}

// Animated gradient text
export function GradientText({
  children,
  className,
  animate = true,
}: {
  children: ReactNode;
  className?: string;
  animate?: boolean;
}) {
  return (
    <motion.span
      className={cn(
        'inline-block bg-clip-text text-transparent',
        animate && 'animate-gradient-x',
        className
      )}
      style={{
        backgroundImage: 'linear-gradient(90deg, #00D49D, #4AE3B5, #00D49D, #4AE3B5)',
        backgroundSize: '200% 100%',
      }}
      initial={animate ? { backgroundPosition: '0% 50%' } : undefined}
      animate={animate ? { backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] } : undefined}
      transition={animate ? { duration: 5, repeat: Infinity, ease: 'linear' } : undefined}
    >
      {children}
    </motion.span>
  );
}

// Typing effect
export function TypewriterText({
  text,
  className,
  speed = 50,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  return (
    <motion.span className={cn('inline-block', className)}>
      {text.split('').map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * (speed / 1000) }}
        >
          {char}
        </motion.span>
      ))}
    </motion.span>
  );
}
