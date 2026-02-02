import { motion } from 'framer-motion';

interface LogoProps {
  variant?: 'icon' | 'full' | 'stacked';
  size?: 'sm' | 'md' | 'lg';
  theme?: 'light' | 'dark';
  className?: string;
  animated?: boolean;
}

// SVG Logo Mark - Abstract upward arrow integrated with M shape
// Represents momentum, growth, forward movement
const LogoMark = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="logoGradient" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00A896" />
        <stop offset="50%" stopColor="#00C4A7" />
        <stop offset="100%" stopColor="#00D49D" />
      </linearGradient>
      <linearGradient id="logoGradientDark" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#007A6E" />
        <stop offset="100%" stopColor="#00A896" />
      </linearGradient>
    </defs>

    {/* Background rounded square */}
    <rect
      x="0"
      y="0"
      width="40"
      height="40"
      rx="10"
      fill="url(#logoGradient)"
    />

    {/* M shape with integrated upward arrow */}
    <path
      d="M10 28V16L15 22L20 12L25 22L30 16V28"
      stroke="#0A2342"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />

    {/* Arrow accent at the peak */}
    <path
      d="M20 12L17 15M20 12L23 15"
      stroke="#0A2342"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Full wordmark
const Wordmark = ({ theme = 'dark', className = '' }: { theme?: 'light' | 'dark'; className?: string }) => (
  <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-heading'} ${className}`}>
    Momentum
  </span>
);

const sizeClasses = {
  sm: {
    icon: 'w-8 h-8',
    text: 'text-lg',
    gap: 'gap-2',
  },
  md: {
    icon: 'w-10 h-10',
    text: 'text-xl',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-12 h-12',
    text: 'text-2xl',
    gap: 'gap-3',
  },
};

export default function Logo({
  variant = 'full',
  size = 'md',
  theme = 'light',
  className = '',
  animated = true,
}: LogoProps) {
  const sizes = sizeClasses[size];

  if (variant === 'icon') {
    return (
      <motion.div
        className={className}
        whileHover={animated ? { scale: 1.1, rotate: 5 } : undefined}
        whileTap={animated ? { scale: 0.95 } : undefined}
        transition={{ duration: 0.2 }}
      >
        <LogoMark className={sizes.icon}  />
      </motion.div>
    );
  }

  if (variant === 'stacked') {
    return (
      <motion.div
        className={`flex flex-col items-center ${className}`}
        whileHover={animated ? { scale: 1.02 } : undefined}
      >
        <motion.div
          whileHover={animated ? { scale: 1.1, rotate: 5 } : undefined}
          transition={{ duration: 0.2 }}
        >
          <LogoMark className={sizes.icon}  />
        </motion.div>
        <Wordmark theme={theme} className={`${sizes.text} mt-2`} />
      </motion.div>
    );
  }

  // Default: full horizontal logo
  return (
    <motion.div
      className={`flex items-center ${sizes.gap} ${className}`}
      whileHover={animated ? { x: 2 } : undefined}
    >
      <motion.div
        whileHover={animated ? { scale: 1.1, rotate: 5 } : undefined}
        whileTap={animated ? { scale: 0.95 } : undefined}
        transition={{ duration: 0.2 }}
      >
        <LogoMark className={sizes.icon}  />
      </motion.div>
      <Wordmark theme={theme} className={sizes.text} />
    </motion.div>
  );
}

// Export individual components for flexibility
export { LogoMark, Wordmark };
