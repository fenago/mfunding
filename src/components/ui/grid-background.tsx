'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface GridBackgroundProps {
  children?: ReactNode;
  className?: string;
  variant?: 'dots' | 'grid' | 'grid-with-dots';
  color?: string;
}

export function GridBackground({
  children,
  className,
  variant = 'grid-with-dots',
  color = 'rgba(0, 126, 167, 0.15)',
}: GridBackgroundProps) {
  const getBackgroundStyle = () => {
    switch (variant) {
      case 'dots':
        return {
          backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        };
      case 'grid':
        return {
          backgroundImage: `
            linear-gradient(to right, ${color} 1px, transparent 1px),
            linear-gradient(to bottom, ${color} 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        };
      case 'grid-with-dots':
      default:
        return {
          backgroundImage: `
            linear-gradient(to right, rgba(0, 126, 167, 0.08) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(0, 126, 167, 0.08) 1px, transparent 1px),
            radial-gradient(circle, rgba(0, 212, 157, 0.3) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px, 40px 40px, 20px 20px',
        };
    }
  };

  return (
    <div className={cn('relative', className)}>
      <div
        className="absolute inset-0 z-0"
        style={getBackgroundStyle()}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// Gradient orb background
export function GradientOrbBackground({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Animated orbs */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background: `
            radial-gradient(circle at 20% 20%, rgba(0, 212, 157, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(0, 126, 167, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(0, 168, 150, 0.1) 0%, transparent 60%)
          `,
        }}
      />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(0, 126, 167, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(0, 126, 167, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
