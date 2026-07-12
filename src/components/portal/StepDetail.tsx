import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircleIcon, DocumentCheckIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import { QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import type { PortalDeal, MerchantDocument } from "../../services/portalService";
import { SUBMITTED_OR_PAST_STATUSES } from "../../services/portalService";
import { resolveJourney, STAGE_SLA } from "../../data/merchantJourney";
import { openGhlDoc, type ApplicationStatus } from "../../utils/signing";
import DocChecklist from "./DocChecklist";
import SubmissionsCard from "./SubmissionsCard";
import PaydownTracker from "./PaydownTracker";
import PostFundingVault from "./PostFundingVault";
import Countdown from "./Countdown";

interface StepDetailProps {
  deal: PortalDeal;
  /** The selected step's key (may differ from the deal's stage). */
  stepKey: string;
  customerId: string | null;
  application: ApplicationStatus;
  signedDocuments: MerchantDocument[];
  onSignNative: (doc: MerchantDocument) => void;
  onChanged: () => void;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

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

/**
 * The substance card for the SELECTED journey step — real content, not just
 * copy. It swaps as the merchant taps nodes: the application artifact, the inline
 * upload checklist, the submissions/offers summary, or the paydown tracker.
 */
export default function StepDetail({
  deal,
  stepKey,
  customerId,
  application,
  signedDocuments,
  onSignNative,
  onChanged,
}: StepDetailProps) {
  const { journey, currentIndex } = resolveJourney(deal);
  const idx = journey.steps.findIndex((s) => s.key === stepKey);
  const step = journey.steps[idx] ?? journey.steps[Math.max(currentIndex, 0)];
  const state: "done" | "current" | "ahead" =
    idx < currentIndex ? "done" : idx === currentIndex ? "current" : "ahead";

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

  const sla = STAGE_SLA[deal.status];
  const elapsed = sla ? elapsedSince(deal[sla.since] as string | null) : null;

  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-5"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tagClass}`}>{tag}</span>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">{step.label}</h3>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">{step.whatsHappening}</p>
      <p className="mt-1 text-xs text-gray-400">{step.timeframe}</p>

      {/* ── Per-step substance ─────────────────────────────────────────────── */}
      <div className="mt-4">
        {stepKey === "application" && (
          <ApplicationCard application={application} onSignNative={onSignNative} />
        )}

        {stepKey === "documents" && customerId && (
          <DocChecklist customerId={customerId} dealId={deal.id} includeAdHoc onChanged={onChanged} />
        )}

        {stepKey === "in_review" &&
          (deal.deal_type !== "vcf" && SUBMITTED_OR_PAST_STATUSES.has(deal.status) ? (
            <SubmissionsCard dealId={deal.id} />
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your file will appear here once it's in front of our funding partners.
            </p>
          ))}

        {stepKey === "offers" && (
          <div className="space-y-3">
            {deal.deal_type !== "vcf" && SUBMITTED_OR_PAST_STATUSES.has(deal.status) && (
              <SubmissionsCard dealId={deal.id} />
            )}
            <Link
              to="/portal/offers"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-blue hover:underline"
            >
              Review your offers
            </Link>
          </div>
        )}

        {(stepKey === "funded" || stepKey === "growing") && (
          <>
            <PaydownTracker deal={deal} />
            <PostFundingVault deal={deal} customerId={customerId} signedDocuments={signedDocuments} />
          </>
        )}
      </div>

      {/* Soft SLA timer for the current waiting stage — reassuring, never alarming */}
      {state === "current" && sla && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Typical wait {sla.typical}
          {elapsed ? ` · elapsed ${elapsed}` : ""}
        </p>
      )}

      {/* Stips deadline countdown when sitting on documents */}
      {stepKey === "documents" && state === "current" && deal.stips_promised_by && (
        <div className="mt-3">
          <Countdown
            target={deal.stips_promised_by}
            label="Bank statements due"
            overdueLabel="Bank statements are past due — upload them to keep your file moving"
            variant="urgent"
          />
        </div>
      )}

      <Link
        to="/portal/how-it-works"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ocean-blue hover:underline"
      >
        <QuestionMarkCircleIcon className="w-4 h-4" />
        What does this step mean?
      </Link>
    </motion.div>
  );
}

function ApplicationCard({
  application,
  onSignNative,
}: {
  application: ApplicationStatus;
  onSignNative: (doc: MerchantDocument) => void;
}) {
  if (application.state === "signed") {
    const s = application.signable;
    const date = fmtDate(application.date);
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-4">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              Signed{date ? ` ${date}` : ""}
            </p>
            <button
              type="button"
              onClick={() =>
                s?.source === "ghl" ? openGhlDoc(s.url) : s?.nativeDoc && onSignNative(s.nativeDoc)
              }
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-blue hover:underline"
            >
              View your signed application
              {s?.source === "ghl" && <ArrowTopRightOnSquareIcon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (application.state === "pending") {
    const s = application.signable;
    return (
      <div className="rounded-lg border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
        <div className="flex items-center gap-3">
          <DocumentCheckIcon className="w-6 h-6 text-ocean-blue flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 dark:text-white">
              Your application is ready to fill out and sign
            </p>
          </div>
          <button
            type="button"
            disabled={s?.source === "ghl" && !s.url}
            onClick={() =>
              s?.source === "native" ? s.nativeDoc && onSignNative(s.nativeDoc) : openGhlDoc(s?.url ?? null)
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-mint-green text-white text-sm font-semibold hover:bg-mint-green/90 disabled:opacity-50 flex-shrink-0 transition-colors"
          >
            Review &amp; sign
            {s?.source === "ghl" && <ArrowTopRightOnSquareIcon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <p className="text-sm text-gray-500 dark:text-gray-400">
      Your specialist will send your application to sign shortly.
    </p>
  );
}
