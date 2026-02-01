'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ReactNode, useMemo } from 'react';

interface AuroraBackgroundProps {
  children: ReactNode;
  className?: string;
  showRadialGradient?: boolean;
  variant?: 'default' | 'intense' | 'subtle';
  showParticles?: boolean;
}

// Floating particle component
function Particle({ delay, duration, size, x, y }: {
  delay: number;
  duration: number;
  size: number;
  x: string;
  y: string;
}) {
  return (
    <motion.div
      className="absolute rounded-full bg-mint-green/30"
      style={{
        width: size,
        height: size,
        left: x,
        top: y,
      }}
      animate={{
        y: [0, -30, 0],
        x: [0, 10, -10, 0],
        opacity: [0.3, 0.6, 0.3],
        scale: [1, 1.2, 1],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

export function AuroraBackground({
  children,
  className,
  showRadialGradient = true,
  variant = 'default',
  showParticles = true,
}: AuroraBackgroundProps) {
  // Generate random particles
  const particles = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      delay: Math.random() * 5,
      duration: 5 + Math.random() * 5,
      size: 2 + Math.random() * 4,
      x: `${Math.random() * 100}%`,
      y: `${Math.random() * 100}%`,
    }));
  }, []);

  const gradientIntensity = {
    default: 0.3,
    intense: 0.5,
    subtle: 0.2,
  }[variant];

  return (
    <div
      className={cn(
        'relative flex flex-col min-h-screen items-center justify-center overflow-hidden',
        className
      )}
    >
      {/* Base gradient layer */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          initial={{ backgroundPosition: '0% 50%' }}
          animate={{
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
          }}
          transition={{
            duration: 20,
            ease: 'linear',
            repeat: Infinity,
          }}
          className="absolute inset-0 z-0"
          style={{
            background: `
              linear-gradient(135deg, #0A2342 0%, #0C516E 25%, #007EA7 50%, #00A896 75%, #00D49D 100%)
            `,
            backgroundSize: '400% 400%',
          }}
        />

        {/* Animated aurora blobs */}
        <motion.div
          className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(0, 212, 157, 0.4) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
          animate={{
            x: [0, 100, 50, 0],
            y: [0, 50, 100, 0],
            scale: [1, 1.2, 0.9, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        <motion.div
          className="absolute -bottom-1/2 -right-1/4 w-[600px] h-[600px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(0, 126, 167, 0.5) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
          animate={{
            x: [0, -80, -40, 0],
            y: [0, -60, -120, 0],
            scale: [1, 0.9, 1.1, 1],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        <motion.div
          className="absolute top-1/3 right-1/3 w-[500px] h-[500px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(0, 168, 150, 0.3) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
          animate={{
            x: [0, 60, -30, 0],
            y: [0, -40, 20, 0],
            scale: [1, 1.15, 0.95, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Pulsing center glow */}
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(0, 212, 157, 0.15) 0%, transparent 50%)',
          }}
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Secondary color shifting overlay */}
        <motion.div
          initial={{ opacity: gradientIntensity }}
          animate={{ opacity: [gradientIntensity, gradientIntensity + 0.2, gradientIntensity] }}
          transition={{
            duration: 8,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 20% 30%, rgba(0, 212, 157, 0.3) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 70%, rgba(0, 126, 167, 0.3) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 50%, rgba(0, 168, 150, 0.2) 0%, transparent 60%)
            `,
          }}
        />

        {/* Mesh gradient overlay for depth */}
        <motion.div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              radial-gradient(at 40% 20%, rgba(0, 212, 157, 0.4) 0px, transparent 50%),
              radial-gradient(at 80% 0%, rgba(10, 35, 66, 0.8) 0px, transparent 50%),
              radial-gradient(at 0% 50%, rgba(0, 126, 167, 0.3) 0px, transparent 50%),
              radial-gradient(at 80% 50%, rgba(0, 168, 150, 0.3) 0px, transparent 50%),
              radial-gradient(at 0% 100%, rgba(10, 35, 66, 0.6) 0px, transparent 50%),
              radial-gradient(at 100% 100%, rgba(0, 212, 157, 0.2) 0px, transparent 50%)
            `,
          }}
          animate={{
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Floating particles */}
      {showParticles && (
        <div className="absolute inset-0 z-[1] pointer-events-none">
          {particles.map((particle) => (
            <Particle key={particle.id} {...particle} />
          ))}
        </div>
      )}

      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {showRadialGradient && (
        <div
          className="pointer-events-none absolute inset-0 z-[3]"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 20%, rgba(10, 35, 66, 0.4) 100%)',
          }}
        />
      )}

      <div className="relative z-[5]">{children}</div>
    </div>
  );
}

// Animated gradient mesh background (alternative option)
export function MeshGradientBackground({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative min-h-screen overflow-hidden', className)}>
      <motion.div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(135deg, #0A2342 0%, #0C516E 50%, #007EA7 100%)
          `,
        }}
      />

      {/* Animated mesh blobs */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full blur-[100px]"
        style={{
          background: 'linear-gradient(135deg, #00D49D 0%, #00A896 100%)',
          top: '-10%',
          left: '-10%',
        }}
        animate={{
          x: [0, 100, 0],
          y: [0, 100, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      <motion.div
        className="absolute w-[400px] h-[400px] rounded-full blur-[100px]"
        style={{
          background: 'linear-gradient(135deg, #007EA7 0%, #00D49D 100%)',
          bottom: '-10%',
          right: '-10%',
        }}
        animate={{
          x: [0, -100, 0],
          y: [0, -100, 0],
          scale: [1, 1.3, 1],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      <motion.div
        className="absolute w-[300px] h-[300px] rounded-full blur-[80px]"
        style={{
          background: 'linear-gradient(135deg, #00A896 0%, #007EA7 100%)',
          top: '40%',
          right: '20%',
        }}
        animate={{
          x: [0, -50, 50, 0],
          y: [0, 50, -50, 0],
          scale: [1, 1.1, 0.9, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
}
