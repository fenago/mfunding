import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon } from "@heroicons/react/24/outline";
import PipelineFlow from "../shared/PipelineFlow";
import { MCA_JOURNEY } from "../../data/merchantJourney";
import type { PipelineDef } from "../../data/pipelines";

const SEEN_KEY = "mf_portal_welcome_seen";

const WELCOME_PIPELINE: PipelineDef = {
  id: "mca",
  name: "Your funding journey",
  stages: MCA_JOURNEY.steps.map((s) => ({ key: s.key, label: s.label, blurb: s.whatsHappening })),
};

/**
 * One-time welcome overlay shown the first time a merchant lands in the portal.
 * Gives a crystal-clear overview of the funding journey, reusing the animated
 * PipelineFlow motion. Skippable; the "seen" flag lives in localStorage.
 */
export default function WelcomeOverlay() {
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(SEEN_KEY) !== "1";
  });

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore storage failures — worst case the overlay shows again */
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
        >
          <motion.div
            className="w-full sm:max-w-lg bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Here's how your funding journey works
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  A quick look at what happens from here — and where you'll pitch in.
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="mt-5">
              <PipelineFlow pipeline={WELCOME_PIPELINE} currentKey={MCA_JOURNEY.steps[0].key} />
            </div>

            <ol className="mt-5 space-y-3">
              {MCA_JOURNEY.steps.map((s, i) => (
                <motion.li
                  key={s.key}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                >
                  <span className="w-6 h-6 rounded-full bg-ocean-blue/10 text-ocean-blue dark:bg-ocean-blue/20 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{s.whatsHappening}</p>
                  </div>
                </motion.li>
              ))}
            </ol>

            {/* TODO(Wave 3): link to /portal/how-it-works once that page ships. */}

            <button
              type="button"
              onClick={dismiss}
              className="mt-6 w-full py-3 rounded-xl bg-mint-green hover:brightness-95 text-white font-semibold transition"
            >
              Got it — let's go
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
