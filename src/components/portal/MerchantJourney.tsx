import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckIcon } from "@heroicons/react/24/solid";
import { ChevronDownIcon, QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import Countdown from "./Countdown";
import type { PortalDeal } from "../../services/portalService";
import {
  resolveJourney,
  STAGE_SLA,
  type MerchantStep,
} from "../../data/merchantJourney";

interface DocProgress {
  done: number;
  total: number;
}

interface MerchantJourneyProps {
  deal: PortalDeal;
  /** Document-checklist progress for this deal, shown on the "documents" step. */
  docProgress?: DocProgress;
}

function stampText(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Elapsed-time helper for the soft SLA timer ("elapsed 6h"). */
function elapsedSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return null;
  const mins = Math.floor((Date.now() - start) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** The expanded card for the step the deal is currently sitting at. */
function CurrentStepCard({
  step,
  deal,
  docProgress,
}: {
  step: MerchantStep;
  deal: PortalDeal;
  docProgress?: DocProgress;
}) {
  const youMove = step.whoseMove === "you";
  const sla = STAGE_SLA[deal.status];
  const elapsed = sla ? elapsedSince(deal[sla.since] as string | null) : null;
  const showDocProgress = step.key === "documents" && docProgress && docProgress.total > 0;

  return (
    <div
      className={`rounded-xl p-4 border ${
        youMove
          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
          : "bg-ocean-blue/5 dark:bg-ocean-blue/10 border-ocean-blue/30 dark:border-ocean-blue/40"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
            youMove
              ? "bg-amber-500 text-white"
              : "bg-ocean-blue text-white"
          }`}
        >
          {youMove ? "⚡ You have a task" : "We're on it"}
        </span>
      </div>
      <h3 className="text-base font-bold text-gray-900 dark:text-white">{step.label}</h3>
      <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">{step.whatsHappening}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{step.timeframe}</p>

      {/* Document checklist progress */}
      {showDocProgress && (
        <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">
          {docProgress!.done} of {docProgress!.total} documents in
        </p>
      )}

      {/* Stips deadline countdown (urgent) */}
      {deal.stips_promised_by && (step.key === "documents") && (
        <div className="mt-3">
          <Countdown
            target={deal.stips_promised_by}
            label="Bank statements due"
            overdueLabel="Bank statements are past due — upload them to keep your file moving"
            variant="urgent"
          />
        </div>
      )}

      {/* Soft SLA timer — reassuring, never alarming */}
      {sla && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Typical wait {sla.typical}
          {elapsed ? ` · elapsed ${elapsed}` : ""}
        </p>
      )}

      {/* Plain-language help for this step */}
      <Link
        to="/portal/how-it-works"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ocean-blue hover:underline"
      >
        <QuestionMarkCircleIcon className="w-4 h-4" />
        What does this step mean?
      </Link>
    </div>
  );
}

/** Completed steps, each with the real date it happened. */
function CompletedList({ steps, deal }: { steps: MerchantStep[]; deal: PortalDeal }) {
  return (
    <ul className="space-y-2">
      {steps.map((s) => {
        const stamp = s.stampField ? stampText(deal[s.stampField] as string | null) : null;
        return (
          <li key={s.key} className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
              <CheckIcon className="w-4 h-4" />
            </span>
            <span className="text-sm text-gray-700 dark:text-gray-200">{s.label}</span>
            {stamp && <span className="text-xs text-gray-400 ml-auto">{stamp}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function MerchantJourney({ deal, docProgress }: MerchantJourneyProps) {
  const { journey, currentIndex, isTerminal } = resolveJourney(deal);
  const [showCompleted, setShowCompleted] = useState(false);

  // Terminal / off-journey states get a respectful status card, not a stepper.
  if (isTerminal) {
    const isDeclined = deal.status === "declined";
    return (
      <div
        className={`rounded-xl p-4 border ${
          isDeclined
            ? "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
            : "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700"
        }`}
      >
        <h3 className="text-base font-bold text-gray-900 dark:text-white">
          {isDeclined ? "Application update" : "We're still working for you"}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {isDeclined
            ? "We weren't able to move forward with this request right now. Your advisor can walk you through other options — check your messages or reach out anytime."
            : "This request is paused, but we're keeping an eye out for new options that fit your business. We'll reach out the moment something changes."}
        </p>
      </div>
    );
  }

  const completed = currentIndex > 0 ? journey.steps.slice(0, currentIndex) : [];
  const currentStep = currentIndex >= 0 ? journey.steps[currentIndex] : journey.steps[0];
  const upcoming = currentIndex >= 0 ? journey.steps.slice(currentIndex + 1) : [];

  return (
    <div>
      {/* The animated horizontal path now lives in <JourneyHero> above. This is
          the actionable detail: the current step, plus at-a-glance history and
          what's still ahead. One layout for every breakpoint. */}
      <div className="space-y-3">
        {/* Completed — compressed behind a collapser */}
        {completed.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
            >
              <span className="text-sm font-medium">
                ✓ {completed.length} step{completed.length === 1 ? "" : "s"} done
              </span>
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${showCompleted ? "rotate-180" : ""}`}
              />
            </button>
            {showCompleted && (
              <div className="mt-2 px-3">
                <CompletedList steps={completed} deal={deal} />
              </div>
            )}
          </div>
        )}

        {/* Current — expanded + animated pulse */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <CurrentStepCard step={currentStep} deal={deal} docProgress={docProgress} />
        </motion.div>

        {/* Upcoming — summarized */}
        {upcoming.length > 0 && (
          <div className="px-3 pt-1">
            <p className="text-xs font-medium text-gray-400 mb-2">Still ahead</p>
            <ul className="space-y-2">
              {upcoming.map((s, i) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 flex items-center justify-center text-xs flex-shrink-0">
                    {currentIndex + 2 + i}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
