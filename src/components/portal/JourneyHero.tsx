import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckIcon } from "@heroicons/react/24/solid";
import type { PortalDeal } from "../../services/portalService";
import { resolveJourney, type MerchantStep } from "../../data/merchantJourney";

/**
 * JourneyHero — the glanceable, animated summary of where a merchant's funding
 * request stands. A horizontal path of nodes (one per merchant step): completed
 * nodes draw in a checkmark, the progress line fills from the start up to the
 * current node, the current node pulses with a soft ring + "You are here", and
 * upcoming nodes stay muted. Tapping any node reveals that step's plain-language
 * card below the path.
 *
 * The per-stage detail (whose move, timers, doc progress) still lives in
 * <MerchantJourney>; this is the picture at the top of the deal card. Terminal
 * states (declined/nurture) render nothing here — the respectful status card in
 * MerchantJourney handles those.
 *
 * COMPLIANCE: all step copy comes from merchantJourney.ts (product-aware, never
 * "loan" for MCA). The only strings added here are neutral chrome.
 */
export default function JourneyHero({ deal }: { deal: PortalDeal }) {
  const reduce = useReducedMotion();
  const { journey, currentIndex, isTerminal } = resolveJourney(deal);
  const steps = journey.steps;

  // Which node's detail card is open. Default to where the merchant is.
  const [selected, setSelected] = useState(Math.max(currentIndex, 0));
  const currentRef = useRef<HTMLButtonElement | null>(null);

  // On mount, pull the current node into view on narrow screens (the path can
  // overflow-scroll on a phone). block:nearest keeps the page from jumping.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  if (isTerminal) return null;

  const n = steps.length;
  const safeIndex = Math.max(currentIndex, 0);
  const halfCol = 50 / n; // % inset from each edge to the first/last node center
  const progressFrac = n > 1 ? safeIndex / (n - 1) : 0;

  const heading =
    journey.product === "vcf" ? "Your path forward" : "Your path to funding";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{heading}</h3>
        <span className="text-xs font-medium text-gray-400">
          Step {safeIndex + 1} of {n}
        </span>
      </div>

      {/* The animated path */}
      <div className="overflow-x-auto pb-1">
        <div className="pt-6 min-w-[22rem]">
          <div className="relative">
            {/* Background track */}
            <div
              className="absolute h-[3px] rounded-full bg-gray-200 dark:bg-gray-700"
              style={{ top: 18, left: `${halfCol}%`, right: `${halfCol}%` }}
            >
              {/* Progress fill — draws from start to the current node on mount */}
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
                const isSelected = i === selected;

                return (
                  <div
                    key={step.key}
                    className="relative flex flex-col items-center flex-1 min-w-[3.25rem] px-0.5"
                  >
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

                    <motion.button
                      type="button"
                      ref={isCurrent ? currentRef : undefined}
                      onClick={() => setSelected(i)}
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
                      className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-2 transition-colors ${
                        isCurrent
                          ? "bg-ocean-blue text-white ring-ocean-blue"
                          : isCompleted
                            ? isFundedNode
                              ? "bg-gradient-to-br from-mint-green to-teal text-midnight-blue ring-mint-green"
                              : "bg-emerald-500 text-white ring-emerald-500"
                            : "bg-white dark:bg-gray-800 text-gray-400 ring-gray-200 dark:ring-gray-600"
                      } ${isSelected ? "outline outline-2 outline-offset-2 outline-ocean-blue/40" : ""}`}
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

      {/* Tapped-node detail — a plain-language line about that step. */}
      <StepBlurb step={steps[selected]} state={selected < currentIndex ? "done" : selected === currentIndex ? "current" : "ahead"} />
    </div>
  );
}

function StepBlurb({ step, state }: { step: MerchantStep; state: "done" | "current" | "ahead" }) {
  const tag =
    state === "done" ? "Done" : state === "current" ? (step.whoseMove === "you" ? "Your move" : "We're on it") : "Coming up";
  const tagClass =
    state === "done"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : state === "current"
        ? step.whoseMove === "you"
          ? "bg-amber-500 text-white"
          : "bg-ocean-blue text-white"
        : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300";

  return (
    <motion.div
      key={step.key}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tagClass}`}>{tag}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{step.label}</span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300">{step.whatsHappening}</p>
    </motion.div>
  );
}
