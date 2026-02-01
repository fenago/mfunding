'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface HyperTextProps {
  text: string;
  className?: string;
  duration?: number;
  delay?: number;
  characterSet?: string;
  animateOnLoad?: boolean;
  animateOnHover?: boolean;
  startOnView?: boolean;
}

const DEFAULT_CHARACTER_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';

export function HyperText({
  text,
  className,
  duration = 800,
  delay = 0,
  characterSet = DEFAULT_CHARACTER_SET,
  animateOnLoad = true,
  animateOnHover = true,
  startOnView = false,
}: HyperTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const scramble = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);

    let iteration = 0;
    const totalIterations = text.length;
    const iterationDuration = duration / totalIterations;

    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setDisplayText(() => {
        const newText = text
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';
            if (index < iteration) return text[index];
            return characterSet[Math.floor(Math.random() * characterSet.length)];
          })
          .join('');
        return newText;
      });

      iteration += 1 / 3;

      if (iteration >= totalIterations) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        setIsAnimating(false);
        setHasAnimated(true);
      }
    }, iterationDuration / 3);
  }, [text, duration, characterSet, isAnimating]);

  // Animate on load
  useEffect(() => {
    if (!animateOnLoad || hasAnimated) return;

    if (startOnView) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !hasAnimated) {
            setTimeout(scramble, delay);
          }
        },
        { threshold: 0.5 }
      );

      if (ref.current) {
        observer.observe(ref.current);
      }

      return () => observer.disconnect();
    } else {
      const timeout = setTimeout(scramble, delay);
      return () => clearTimeout(timeout);
    }
  }, [animateOnLoad, delay, scramble, hasAnimated, startOnView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (animateOnHover && !isAnimating) {
      scramble();
    }
  };

  return (
    <motion.span
      ref={ref}
      className={cn('inline-block font-mono', className)}
      onMouseEnter={handleMouseEnter}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {displayText.split('').map((char, index) => (
        <span
          key={index}
          className={cn(
            'inline-block transition-all duration-75',
            isAnimating && char !== text[index] && char !== ' '
              ? 'text-mint-green scale-110'
              : ''
          )}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </motion.span>
  );
}

// Letter-by-letter blur reveal (no scramble, just blur to clear)
interface BlurTextProps {
  text: string;
  className?: string;
  delay?: number;
  staggerDelay?: number;
  blurAmount?: number;
}

export function BlurText({
  text,
  className,
  delay = 0,
  staggerDelay = 0.04,
  blurAmount = 10,
}: BlurTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={cn('inline-flex flex-wrap', className)}>
      {text.split('').map((char, index) => (
        <motion.span
          key={index}
          initial={{
            opacity: 0,
            filter: `blur(${blurAmount}px)`,
            y: 10,
          }}
          animate={
            isInView
              ? {
                  opacity: 1,
                  filter: 'blur(0px)',
                  y: 0,
                }
              : {}
          }
          transition={{
            duration: 0.5,
            delay: delay + index * staggerDelay,
            ease: [0.4, 0, 0.2, 1],
          }}
          className="inline-block"
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
}

// Split text animation - words fly in from different directions
interface SplitTextProps {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'random';
}

export function SplitText({
  text,
  className,
  wordClassName,
  delay = 0,
  direction = 'up',
}: SplitTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const words = text.split(' ');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  const getInitialPosition = (index: number) => {
    if (direction === 'random') {
      const directions: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
      const randomDir = directions[index % 4];
      return getPosition(randomDir);
    }
    return getPosition(direction as 'up' | 'down' | 'left' | 'right');
  };

  const getPosition = (dir: 'up' | 'down' | 'left' | 'right') => {
    switch (dir) {
      case 'up':
        return { y: 40, x: 0 };
      case 'down':
        return { y: -40, x: 0 };
      case 'left':
        return { y: 0, x: 40 };
      case 'right':
        return { y: 0, x: -40 };
      default:
        return { y: 40, x: 0 };
    }
  };

  return (
    <div ref={ref} className={cn('flex flex-wrap gap-x-[0.25em]', className)}>
      {words.map((word, index) => {
        const initial = getInitialPosition(index);
        return (
          <div key={index} className="overflow-hidden">
            <motion.span
              className={cn('inline-block', wordClassName)}
              initial={{
                opacity: 0,
                y: initial.y,
                x: initial.x,
                rotateX: direction === 'up' || direction === 'down' ? 45 : 0,
              }}
              animate={
                isInView
                  ? {
                      opacity: 1,
                      y: 0,
                      x: 0,
                      rotateX: 0,
                    }
                  : {}
              }
              transition={{
                duration: 0.6,
                delay: delay + index * 0.08,
                ease: [0.4, 0, 0.2, 1],
              }}
            >
              {word}
            </motion.span>
          </div>
        );
      })}
    </div>
  );
}

// Glitch text effect
interface GlitchTextProps {
  text: string;
  className?: string;
  glitchColors?: [string, string];
}

export function GlitchText({
  text,
  className,
  glitchColors = ['#00D49D', '#007EA7'],
}: GlitchTextProps) {
  return (
    <span className={cn('relative inline-block', className)}>
      <span className="relative z-10">{text}</span>
      <motion.span
        className="absolute top-0 left-0 z-0 opacity-80"
        style={{ color: glitchColors[0] }}
        animate={{
          x: [0, -2, 2, 0],
          y: [0, 1, -1, 0],
        }}
        transition={{
          duration: 0.3,
          repeat: Infinity,
          repeatType: 'reverse',
          repeatDelay: 3,
        }}
      >
        {text}
      </motion.span>
      <motion.span
        className="absolute top-0 left-0 z-0 opacity-80"
        style={{ color: glitchColors[1] }}
        animate={{
          x: [0, 2, -2, 0],
          y: [0, -1, 1, 0],
        }}
        transition={{
          duration: 0.3,
          repeat: Infinity,
          repeatType: 'reverse',
          repeatDelay: 3,
          delay: 0.1,
        }}
      >
        {text}
      </motion.span>
    </span>
  );
}
