'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

type TColorProp = string | string[];

interface ShineBorderProps {
  borderRadius?: number;
  borderWidth?: number;
  duration?: number;
  color?: TColorProp;
  className?: string;
  children: ReactNode;
}

export function ShineBorder({
  borderRadius = 12,
  borderWidth = 2,
  duration = 8,
  color = ['#00D49D', '#007EA7', '#00A896'],
  className,
  children,
}: ShineBorderProps) {
  return (
    <div
      style={
        {
          '--border-radius': `${borderRadius}px`,
        } as React.CSSProperties
      }
      className={cn(
        'relative min-h-[60px] w-full rounded-[--border-radius] p-[2px]',
        className
      )}
    >
      <div
        style={
          {
            '--border-width': `${borderWidth}px`,
            '--border-radius': `${borderRadius}px`,
            '--duration': `${duration}s`,
            '--background-radial-gradient': `radial-gradient(transparent,transparent, ${
              color instanceof Array ? color.join(',') : color
            },transparent,transparent)`,
          } as React.CSSProperties
        }
        className="absolute inset-0 rounded-[--border-radius] before:absolute before:inset-0 before:aspect-square before:size-full before:rounded-[--border-radius] before:p-[--border-width] before:will-change-[background-position] before:content-[''] before:![-webkit-mask-composite:xor] before:![mask-composite:exclude] before:[background-image:--background-radial-gradient] before:[background-size:300%_300%] before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] motion-safe:before:animate-shine"
      />
      <div className="relative z-10 rounded-[calc(var(--border-radius)-2px)] bg-white h-full">
        {children}
      </div>
    </div>
  );
}
