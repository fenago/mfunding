import { useState } from "react";
import { motion } from "framer-motion";
import { CheckIcon } from "@heroicons/react/24/solid";
import { SparklesIcon, ArrowTrendingUpIcon } from "@heroicons/react/24/outline";
import {
  displayedPaydown,
  isPaydownEstimated,
  expressRenewalInterest,
  RenewalInterestError,
  type PortalDeal,
} from "../../services/portalService";
import {
  PAYDOWN_MILESTONES,
  MILESTONE_LABEL,
  MILESTONE_PROJECTION_PHRASE,
  nextMilestone,
  projectNextMilestone,
  type PaydownMilestone,
} from "../../utils/paydownProjection";

interface PaydownTrackerProps {
  deal: PortalDeal;
}

const INTEREST_HINT_PREFIX = "mf_renewal_interest_";

/** Local acknowledged-state hint — used ONLY as a fallback when the server
 *  field (renewal_interest_expressed) is absent, e.g. on the direct-select
 *  degradation path where the RPC isn't returning that column. Server truth
 *  always wins when present. */
function readInterestHint(dealId: string): boolean {
  try {
    return localStorage.getItem(INTEREST_HINT_PREFIX + dealId) === "1";
  } catch {
    return false;
  }
}
function writeInterestHint(dealId: string): void {
  try {
    localStorage.setItem(INTEREST_HINT_PREFIX + dealId, "1");
  } catch {
    /* non-fatal */
  }
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The horizontal progress bar with the four milestone checkpoints. */
function MilestoneBar({
  paydown,
  nextM,
}: {
  paydown: number;
  nextM: PaydownMilestone | null;
}) {
  const clamped = Math.max(0, Math.min(100, paydown));
  return (
    <div className="pt-6">
      <div className="relative h-3 rounded-full bg-gray-200 dark:bg-gray-700">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint-green to-teal-500"
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        {PAYDOWN_MILESTONES.map((m) => {
          const passed = clamped >= m;
          const isNext = m === nextM;
          return (
            <div
              key={m}
              className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2"
              style={{ left: `${m}%` }}
            >
              <div
                className={`flex items-center justify-center rounded-full border-2 transition-colors ${
                  passed
                    ? "w-5 h-5 bg-mint-green border-mint-green text-white"
                    : isNext
                      ? "w-5 h-5 bg-white dark:bg-gray-800 border-mint-green ring-2 ring-mint-green/40"
                      : "w-4 h-4 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                }`}
              >
                {passed && <CheckIcon className="w-3 h-3" />}
              </div>
              <span
                className={`absolute top-6 left-1/2 -translate-x-1/2 text-[10px] font-semibold ${
                  passed || isNext ? "text-gray-700 dark:text-gray-200" : "text-gray-400"
                }`}
              >
                {m}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PaydownTracker({ deal }: PaydownTrackerProps) {
  const paydown = displayedPaydown(deal);
  const estimated = isPaydownEstimated(deal);
  // Acknowledged state: server truth (get_my_portal_deals.renewal_interest_expressed)
  // when present; localStorage hint only as a fallback when that field is absent.
  const serverKnown = deal.renewal_interest_expressed != null;
  const [interest, setInterest] = useState<"idle" | "sending" | "done">(
    (serverKnown ? !!deal.renewal_interest_expressed : readInterestHint(deal.id))
      ? "done"
      : "idle",
  );
  const [interestError, setInterestError] = useState<string | null>(null);

  const asOf =
    fmtDate(deal.balance_as_of) ?? fmtDate(deal.updated_at) ?? fmtDate(deal.funded_at);

  // The next unpassed checkpoint, derived from paydown alone so the bar always
  // highlights it even when we lack remittance fields to project a date.
  const nextM: PaydownMilestone | null = paydown != null ? nextMilestone(paydown) : null;

  const projection =
    paydown != null
      ? projectNextMilestone({
          paydownPct: paydown,
          paybackAmount: deal.payback_amount,
          remittanceAmount: deal.remittance_amount,
          remittanceFrequency: deal.remittance_frequency,
        })
      : null;

  const projDate = fmtDate(projection?.date.toISOString() ?? null);

  const handleInterest = async () => {
    setInterest("sending");
    setInterestError(null);
    try {
      // Idempotent server-side; already_expressed=true is still success.
      await expressRenewalInterest(deal.id);
      writeInterestHint(deal.id); // helps the field-absent fallback path
      setInterest("done");
    } catch (e) {
      setInterest("idle");
      setInterestError(
        e instanceof RenewalInterestError
          ? e.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  const paidInFull = paydown != null && paydown >= 100;

  return (
    <div className="rounded-xl border border-mint-green/40 dark:border-mint-green/30 bg-gradient-to-br from-mint-green/5 to-teal-500/5 dark:from-mint-green/10 dark:to-teal-500/10 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ArrowTrendingUpIcon className="w-5 h-5 text-mint-green" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Growing with us</h3>
      </div>

      {/* Funding summary line */}
      {deal.amount_funded != null && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-bold text-gray-900 dark:text-white">
            ${deal.amount_funded.toLocaleString()}
          </span>{" "}
          funded
          {deal.funded_at ? ` on ${fmtDate(deal.funded_at)}` : ""}
        </p>
      )}

      {paydown != null ? (
        <>
          {/* Paydown figure with always-visible freshness */}
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">
              {Math.round(paydown)}%
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              paid down{estimated ? " (estimated)" : ""}
            </span>
          </div>
          {asOf && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">As of {asOf}</p>
          )}

          <MilestoneBar paydown={paydown} nextM={nextM} />

          {/* Headline projection when remittance fields let us estimate a date;
              otherwise a plain "next up" milestone with no date promise. */}
          {projection ? (
            <p className="mt-8 text-sm text-gray-700 dark:text-gray-200">
              <span className="font-semibold">≈ {projection.days} days</span> until{" "}
              {MILESTONE_PROJECTION_PHRASE[projection.milestone]}
              {projDate ? ` (estimated — around ${projDate})` : " (estimated)"}.
            </p>
          ) : nextM != null ? (
            <p className="mt-8 text-sm text-gray-600 dark:text-gray-300">
              Next up:{" "}
              <span className="font-semibold text-gray-900 dark:text-white">
                {MILESTONE_LABEL[nextM]}
              </span>
              .
            </p>
          ) : paidInFull ? (
            <p className="mt-8 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Paid in full 🎉 — let's talk about what's next for your business.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          You're all set. As you pay down your balance, you may qualify for additional
          capital — often on better terms. We'll let you know the moment you're eligible.
        </p>
      )}

      {/* One-tap interest */}
      <div className="mt-5">
        {interest === "done" ? (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              Great — your funding specialist will reach out shortly.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleInterest}
              disabled={interest === "sending"}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-mint-green text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60 transition"
            >
              <SparklesIcon className="w-4 h-4" />
              {interest === "sending" ? "One moment…" : "I'm interested in additional capital"}
            </button>
            {interestError && (
              <p className="text-sm text-red-500 mt-2">{interestError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
