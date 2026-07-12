import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckIcon } from "@heroicons/react/24/solid";
import type { PortalDeal } from "../../services/portalService";
import { resolveJourney } from "../../data/merchantJourney";

interface JourneyHeroProps {
  deal: PortalDeal;
  /** The step whose detail is expanded below (selection ≠ stage). */
  selectedKey: string;
  /** Select a step (visible highlight + host swaps the detail card). */
  onSelectStep: (key: string) => void;
}

/**
 * JourneyHero — the animated path. Two DISTINCT states the merchant can't
 * confuse: the deal's STAGE (filled node + "You are here" pill; never moves on
 * click) and the SELECTED step (outlined ring + "Viewing"; follows taps). The
 * progress line fills to the stage, completed nodes draw a checkmark, upcoming
 * nodes stay muted. Every node is a clickable anchor; the substance for the
 * selected step renders below (see StepDetail). Respects prefers-reduced-motion.
 *
 * COMPLIANCE: labels come from merchantJourney.ts (product-aware, never "loan").
 */
export default function JourneyHero({ deal, selectedKey, onSelectStep }: JourneyHeroProps) {
  const reduce = useReducedMotion();
  const { journey, currentIndex, isTerminal } = resolveJourney(deal);
  const steps = journey.steps;
  const currentRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  if (isTerminal) return null;

  const n = steps.length;
  const safeIndex = Math.max(currentIndex, 0);
  const halfCol = 50 / n;
  const progressFrac = n > 1 ? safeIndex / (n - 1) : 0;
  const heading = journey.product === "vcf" ? "Your path forward" : "Your path to funding";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{heading}</h3>
        <span className="text-xs font-medium text-gray-400">
          Step {safeIndex + 1} of {n}
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="pt-6 min-w-[22rem]">
          <div className="relative">
            {/* Background track */}
            <div
              className="absolute h-[3px] rounded-full bg-gray-200 dark:bg-gray-700"
              style={{ top: 18, left: `${halfCol}%`, right: `${halfCol}%` }}
            >
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 via-teal to-mint-green"
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${progressFrac * 100}%` }}
                transition={reduce ? { duration: 0 } : { duration: 1, ease: "easeInOut", delay: 0.15 }}
              />
            </div>

            {/* Nodes */}
            <div className="relative flex">
              {steps.map((step, i) => {
                const isCompleted = i < currentIndex;
                const isCurrent = i === currentIndex;
                const isFundedNode = step.key === "funded";
                const isSelected = step.key === selectedKey;
                const selectedNotCurrent = isSelected && !isCurrent;

                return (
                  <div key={step.key} className="relative flex flex-col items-center flex-1 min-w-[3.25rem] px-0.5">
                    {/* Stage pill (never moves) */}
                    {isCurrent && (
                      <motion.span
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: reduce ? 0 : 0.9 }}
                        className="absolute -top-5 whitespace-nowrap rounded-full bg-ocean-blue px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                      >
                        You are here
                      </motion.span>
                    )}
                    {/* Selection badge (only when viewing a different step) */}
                    {selectedNotCurrent && (
                      <span className="absolute -top-5 whitespace-nowrap rounded-full border border-ocean-blue bg-white dark:bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-ocean-blue shadow-sm">
                        Viewing
                      </span>
                    )}

                    <motion.button
                      type="button"
                      ref={isCurrent ? currentRef : undefined}
                      onClick={() => onSelectStep(step.key)}
                      aria-label={step.label}
                      aria-current={isCurrent ? "step" : undefined}
                      initial={false}
                      animate={
                        isCurrent && !reduce
                          ? {
                              boxShadow: [
                                "0 0 0 0 rgba(0,126,167,0.45)",
                                "0 0 0 10px rgba(0,126,167,0)",
                                "0 0 0 0 rgba(0,126,167,0)",
                              ],
                            }
                          : {}
                      }
                      transition={isCurrent && !reduce ? { duration: 1.9, repeat: Infinity } : undefined}
                      className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-2 transition-colors cursor-pointer ${
                        isCurrent
                          ? "bg-ocean-blue text-white ring-ocean-blue"
                          : isCompleted
                            ? isFundedNode
                              ? "bg-gradient-to-br from-mint-green to-teal text-midnight-blue ring-mint-green"
                              : "bg-emerald-500 text-white ring-emerald-500"
                            : "bg-white dark:bg-gray-800 text-gray-400 ring-gray-200 dark:ring-gray-600"
                      } ${selectedNotCurrent ? "outline outline-2 outline-offset-2 outline-ocean-blue" : ""}`}
                    >
                      {isCompleted ? (
                        <motion.span
                          initial={reduce ? false : { scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 18, delay: 0.2 + i * 0.12 }}
                        >
                          <CheckIcon className="h-5 w-5" />
                        </motion.span>
                      ) : isFundedNode ? (
                        <span aria-hidden>🎉</span>
                      ) : (
                        i + 1
                      )}
                    </motion.button>

                    <span
                      className={`mt-2 text-center text-[10px] leading-tight ${
                        isCurrent
                          ? "font-semibold text-ocean-blue"
                          : isSelected
                            ? "font-semibold text-ocean-blue"
                            : isCompleted
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
