import { motion } from 'framer-motion';
import { SunIcon, MoonIcon, ComputerDesktopIcon } from '@heroicons/react/24/outline';
import { useTheme } from '../../lib/theme-context';

interface ThemeToggleProps {
  className?: string;
}

const MODE_ICON = {
  light: SunIcon,
  dark: MoonIcon,
  system: ComputerDesktopIcon,
} as const;

const MODE_LABEL = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
} as const;

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { mode, cycleMode } = useTheme();
  const Icon = MODE_ICON[mode];

  return (
    <motion.button
      onClick={cycleMode}
      className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
        mode === 'dark'
          ? 'bg-white/10 hover:bg-white/20 text-white'
          : 'bg-gray-100 hover:bg-gray-200 text-midnight-blue'
      } ${className}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch.`}
      title={MODE_LABEL[mode]}
    >
      <motion.div
        key={mode}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <Icon className="w-5 h-5" />
      </motion.div>
    </motion.button>
  );
}
