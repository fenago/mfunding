import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightIcon } from '@heroicons/react/24/solid';

export default function StickyApplyCTA() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show after scrolling past hero section (roughly 80vh)
      const heroHeight = window.innerHeight * 0.8;
      setIsVisible(window.scrollY > heroHeight);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 100, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed bottom-6 right-6 z-50 lg:bottom-8 lg:right-8"
        >
          <motion.a
            href="#apply"
            className="group flex items-center gap-3 bg-gradient-to-r from-mint-green to-teal text-midnight-blue font-bold px-6 py-4 rounded-full shadow-2xl hover:shadow-mint-green/30"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {/* Pulsing glow effect */}
            <motion.div
              className="absolute inset-0 rounded-full bg-mint-green"
              animate={{
                boxShadow: [
                  '0 0 0 0 rgba(0, 212, 157, 0.4)',
                  '0 0 0 15px rgba(0, 212, 157, 0)',
                  '0 0 0 0 rgba(0, 212, 157, 0.4)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            <span className="relative z-10">See If You Qualify</span>
            <motion.span
              className="relative z-10"
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ArrowRightIcon className="w-5 h-5" />
            </motion.span>
          </motion.a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
