import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { SparklesIcon, BuildingLibraryIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import {
  getMyDealSubmissions,
  type DealSubmissionView,
  type SubmissionBucket,
} from "../../services/portalService";
import Countdown from "./Countdown";

interface SubmissionsCardProps {
  dealId: string;
}

// Merchant-facing, compliance-clean status chips. Never "loan"; declines are
// framed respectfully ("Not a match this time"), never as a rejection.
const BUCKET_CHIP: Record<SubmissionBucket, { label: string; className: string; pulse?: boolean }> = {
  submitted: {
    label: "Submitted",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    pulse: true,
  },
  reviewing: {
    label: "Reviewing your file",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    pulse: true,
  },
  offer: {
    label: "Offer ready",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  declined: {
    label: "Not a match this time",
    className: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  },
  withdrawn: {
    label: "Closed",
    className: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  },
};

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function money(n: number | null): string | null {
  return n == null ? null : `$${n.toLocaleString()}`;
}

/** Offer detail grid — only rendered for the 'offer' bucket. Compliance-safe:
 *  no APR/interest framing (MCA is a purchase of receivables), just the numbers
 *  the merchant will see. */
function OfferDetails({ sub }: { sub: DealSubmissionView }) {
  const rows: { label: string; value: string }[] = [];
  const amt = money(sub.offer_amount);
  const payback = money(sub.offer_payback);
  const payment = money(sub.offer_payment);
  if (amt) rows.push({ label: "Funding amount", value: amt });
  if (payback) rows.push({ label: "Total payback", value: payback });
  if (sub.offer_term) rows.push({ label: "Term", value: `${sub.offer_term} months` });
  if (payment) {
    rows.push({
      label: "Payment",
      value: sub.offer_frequency ? `${payment} ${sub.offer_frequency}` : payment,
    });
  }
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
      {rows.map((r) => (
        <div key={r.label}>
          <span className="block text-xs text-emerald-700/70 dark:text-emerald-300/70">{r.label}</span>
          <span className="font-bold text-emerald-800 dark:text-emerald-200">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SubmissionsCard({ dealId }: SubmissionsCardProps) {
  const [subs, setSubs] = useState<DealSubmissionView[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyDealSubmissions(dealId)
      .then((rows) => alive && setSubs(rows))
      .catch((e) => {
        console.error("Failed to load submissions:", e);
        if (alive) setSubs([]);
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [dealId]);

  // Nothing to show until the RPC returns rows (or if it's not deployed yet).
  if (!loaded || subs.length === 0) return null;

  const activeCount = subs.filter((s) =>
    ["submitted", "reviewing", "offer"].includes(s.status_bucket),
  ).length;
  const anyWaiting = subs.some((s) => s.status_bucket === "submitted" || s.status_bucket === "reviewing");
  const anyOffer = subs.some((s) => s.status_bucket === "offer");

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-1">
        <BuildingLibraryIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {activeCount > 0
            ? `Your file is in front of ${activeCount} funding partner${activeCount === 1 ? "" : "s"}`
            : "Your funding partner review"}
        </h3>
        {anyWaiting && (
          <span className="ml-1 flex h-2.5 w-2.5 relative" aria-hidden>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {anyOffer
          ? "Good news — an offer is in. Review your options and your advisor will walk you through it."
          : anyWaiting
            ? "Funding partners typically respond within 24–48 hours. We'll flag the moment an offer lands."
            : "Here's where your file stands with our funding partners."}
      </p>

      {anyOffer && (
        <Link
          to="/portal/offers"
          className="mb-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-mint-green text-white text-sm font-semibold hover:brightness-95 transition"
        >
          Review your offers
          <ArrowRightIcon className="w-4 h-4" />
        </Link>
      )}

      <div className="space-y-2">
        {subs.map((sub, i) => {
          const chip = BUCKET_CHIP[sub.status_bucket];
          const submitted = fmtDate(sub.submitted_at);
          const isOffer = sub.status_bucket === "offer";
          const cardBody = (
            <div
              className={`rounded-lg border p-3 ${
                isOffer
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-white">
                  {isOffer && <SparklesIcon className="w-4 h-4 text-emerald-500" />}
                  {sub.partner_label}
                </span>
                <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full flex-shrink-0 ${chip.className}`}>
                  {chip.label}
                </span>
              </div>

              {submitted && !isOffer && (
                <p className="text-xs text-gray-400 mt-1">Submitted {submitted}</p>
              )}

              {isOffer && <OfferDetails sub={sub} />}
              {isOffer && sub.offer_expires_at && (
                <div className="mt-2">
                  <Countdown target={sub.offer_expires_at} label="Offer good through" variant="soft" />
                </div>
              )}
            </div>
          );

          return isOffer ? (
            <motion.div
              key={`${sub.partner_label}-${i}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              {cardBody}
            </motion.div>
          ) : (
            <div key={`${sub.partner_label}-${i}`}>{cardBody}</div>
          );
        })}
      </div>
    </div>
  );
}
