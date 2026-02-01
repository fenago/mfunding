'use client';

import React, { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = '#00D49D',
      shimmerSize = '0.1em',
      shimmerDuration = '2.5s',
      borderRadius = '0.5rem',
      background = 'linear-gradient(135deg, #0A2342 0%, #0C516E 100%)',
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        style={
          {
            '--spread': '90deg',
            '--shimmer-color': shimmerColor,
            '--radius': borderRadius,
            '--speed': shimmerDuration,
            '--cut': shimmerSize,
            '--bg': background,
          } as CSSProperties
        }
        className={cn(
          'group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap px-8 py-4 font-semibold',
          '[background:var(--bg)] [border-radius:var(--radius)]',
          'transform-gpu transition-all duration-300 ease-in-out',
          'hover:scale-105 hover:shadow-[0_0_40px_8px_rgba(0,212,157,0.3)]',
          'active:scale-95',
          className
        )}
        ref={ref}
        {...props}
      >
        {/* Shimmer effect */}
        <div
          className={cn(
            '-z-30 blur-[2px]',
            'absolute inset-0 overflow-visible [container-type:size]'
          )}
        >
          <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1] [border-radius:0] [mask:none]">
            <div
              className="absolute -inset-full w-auto rotate-0 [translate:0_0]"
              style={{
                background: `conic-gradient(from calc(270deg - (var(--spread) * 0.5)), transparent 0, var(--shimmer-color) var(--spread), transparent var(--spread))`,
                animation: `spin 3s linear infinite`,
              }}
            />
          </div>
        </div>

        {/* Content */}
        <span className="relative z-10 flex items-center gap-2 text-white">
          {children}
        </span>

        {/* Inner highlight */}
        <div
          className={cn(
            'absolute inset-0 size-full',
            'rounded-[var(--radius)] px-4 py-1.5 text-sm font-medium',
            'shadow-[inset_0_-8px_10px_rgba(255,255,255,0.15)]',
            'transform-gpu transition-all duration-300 ease-in-out',
            'group-hover:shadow-[inset_0_-6px_10px_rgba(255,255,255,0.25)]',
            'group-active:shadow-[inset_0_-10px_10px_rgba(255,255,255,0.2)]'
          )}
        />

        {/* Background behind shimmer */}
        <div
          className={cn(
            'absolute -z-20 [background:var(--bg)] [border-radius:var(--radius)] [inset:var(--cut)]'
          )}
        />
      </button>
    );
  }
);

ShimmerButton.displayName = 'ShimmerButton';
