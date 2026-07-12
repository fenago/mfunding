import { Link } from "react-router-dom";
import {
  BoltIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
} from "@heroicons/react/24/solid";
import type { PortalDeal, DocRequest, MerchantDocument } from "../../services/portalService";
import { openGhlDoc, type Signable, type ApplicationStatus } from "../../utils/signing";
import { isDeadlinePast } from "../../utils/deadline";
import { cleanDocLabel, joinLabels } from "../../data/docRequests";
import Countdown from "./Countdown";
import FreshApplicationLink from "./FreshApplicationLink";

interface ActionBlockProps {
  deals: PortalDeal[];
  /** Unified pending signables (native + GHL), collapsed by the one-application rule. */
  pending: Signable[];
  /** Resolved application — powers the "fill out a fresh one" fallback link. */
  application: ApplicationStatus;
  docRequests: DocRequest[];
  offerCount: number;
  /** Open a native agreement in the in-app signing modal. */
  onSignNative: (doc: MerchantDocument) => void;
  /** Jump to the inline upload checklist for a deal (select + scroll). */
  onUpload: (dealId: string) => void;
}

/** Reassuring "next update" hint when nothing is on the merchant's plate. */
function nextUpdateHint(deals: PortalDeal[]): string {
  if (deals.some((d) => d.status === "submitted_to_funder")) {
    return "Funding partners typically respond within 24–48 hours.";
  }
  if (deals.some((d) => d.status === "offer_received")) {
    return "We're lining up your best options now.";
  }
  return "We'll reach out as soon as there's an update.";
}

/**
 * "What you need to do now" — the single, ordered action block at the top of the
 * dashboard. Merges what used to be two stacked cards (the action hero + the
 * ready-to-sign card) into one list: sign → upload → offers, each row actionable
 * inline. When nothing's needed, the reassuring all-set state.
 */
export default function ActionBlock({
  deals,
  pending,
  application,
  docRequests,
  offerCount,
  onSignNative,
  onUpload,
}: ActionBlockProps) {
  // Only REQUIRED items (and signatures) create urgency. Optional-but-encouraged
  // uploads never fire the amber task — they surface as a soft nudge instead.
  const openReqs = docRequests.filter((r) => r.status === "requested" || r.status === "rejected");
  const openRequired = openReqs.filter((r) => r.required);
  const openOptional = openReqs.filter((r) => !r.required);
  const rejectedRequired = openRequired.filter((r) => r.status === "rejected");
  const overdue = deals.find(
    (d) => isDeadlinePast(d.stips_promised_by) && (d.status === "docs_collected" || d.status === "bank_statements"),
  );
  const needUpload = openRequired.length > 0 || !!overdue;
  const uploadDeal =
    deals.find((d) => openRequired.some((r) => r.deal_id === d.id)) ??
    deals.find((d) => d.status === "docs_collected" || d.status === "bank_statements") ??
    null;
  const optionalDeal = deals.find((d) => openOptional.some((r) => r.deal_id === d.id)) ?? null;
  const soonestDue =
    openRequired
      .map((r) => r.due_at)
      .filter((d): d is string => !!d)
      .sort()[0] ?? overdue?.stips_promised_by ?? undefined;

  // Name the exact outstanding items (single source: the doc requests).
  const requiredLabels = joinLabels(openRequired.map((r) => cleanDocLabel(r.label)));
  const rejectedLabels = joinLabels(rejectedRequired.map((r) => cleanDocLabel(r.label)));
  const optionalLabels = joinLabels(openOptional.map((r) => cleanDocLabel(r.label)));

  const offersActive = offerCount > 0 || deals.some((d) => d.status === "offer_presented");

  const rowCount = pending.length + (needUpload ? 1 : 0) + (offersActive ? 1 : 0);

  // Nothing urgent → the all-set state (with a soft optional nudge if any remain).
  if (rowCount === 0) {
    return (
      <div className="sticky top-2 z-20 rounded-xl p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              You're all set — we're working on it.
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">{nextUpdateHint(deals)}</p>
            {openOptional.length > 0 && (
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                Optional: {optionalLabels} could strengthen your file.
                {optionalDeal && (
                  <button
                    type="button"
                    onClick={() => onUpload(optionalDeal.id)}
                    className="ml-1 font-semibold underline hover:no-underline"
                  >
                    Add {openOptional.length === 1 ? "it" : "them"}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const uploadUrgent = rejectedRequired.length > 0 || !!overdue;

  return (
    <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-900/10 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <BoltIcon className="w-5 h-5 text-amber-500" />
        <h2 className="font-bold text-gray-900 dark:text-white">What you need to do now</h2>
      </div>

      <div className="space-y-2">
        {/* 1) Sign */}
        {pending.map((s, i) => (
          <ActionRow
            key={`sign-${s.nativeDoc?.id ?? i}-${s.name}`}
            icon={<PencilSquareIcon className="w-5 h-5" />}
            tone="blue"
            title="Sign your document"
            detail={s.name}
            cta={{
              label: "Review & sign",
              external: s.source === "ghl",
              disabled: s.source === "ghl" && !s.url,
              onClick: () =>
                s.source === "native"
                  ? s.nativeDoc && onSignNative(s.nativeDoc)
                  : openGhlDoc(s.url),
            }}
          />
        ))}
        <FreshApplicationLink application={application} className="px-1" />

        {/* 2) Upload */}
        {needUpload && uploadDeal && (
          <ActionRow
            icon={<ArrowUpTrayIcon className="w-5 h-5" />}
            tone={uploadUrgent ? "red" : "amber"}
            title={
              rejectedRequired.length > 0
                ? `Re-upload: ${rejectedLabels}`
                : requiredLabels
                  ? `Upload: ${requiredLabels}`
                  : "Upload your last 4 months of business bank statements"
            }
            detail={
              rejectedRequired.length > 0
                ? "One of your uploads couldn't be accepted — send it again to keep your file moving."
                : overdue
                  ? "Past due — upload now to keep your file moving with our funding partners."
                  : "The faster these come in, the faster you get offers."
            }
            countdownTarget={soonestDue}
            cta={{ label: "Upload documents", onClick: () => onUpload(uploadDeal.id) }}
          />
        )}

        {/* 3) Offers */}
        {offersActive && (
          <ActionRow
            icon={<BanknotesIcon className="w-5 h-5" />}
            tone="green"
            title={offerCount > 1 ? `You have ${offerCount} offers to review` : "You have an offer to review"}
            detail="See your funding options side by side and choose the one that fits."
            cta={{ label: "Review your offers", to: "/portal/offers" }}
          />
        )}
      </div>
    </div>
  );
}

type Tone = "blue" | "amber" | "red" | "green";

const TONE: Record<Tone, { dot: string; btn: string }> = {
  blue: { dot: "bg-ocean-blue/10 text-ocean-blue", btn: "bg-ocean-blue hover:bg-deep-sea text-white" },
  amber: { dot: "bg-amber-100 text-amber-600 dark:bg-amber-900/40", btn: "bg-amber-500 hover:bg-amber-600 text-white" },
  red: { dot: "bg-red-100 text-red-600 dark:bg-red-900/40", btn: "bg-red-600 hover:bg-red-700 text-white" },
  green: { dot: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40", btn: "bg-mint-green hover:bg-mint-green/90 text-white" },
};

interface Cta {
  label: string;
  onClick?: () => void;
  to?: string;
  external?: boolean;
  disabled?: boolean;
}

function ActionRow({
  icon,
  tone,
  title,
  detail,
  countdownTarget,
  cta,
}: {
  icon: React.ReactNode;
  tone: Tone;
  title: string;
  detail: string;
  countdownTarget?: string;
  cta: Cta;
}) {
  const t = TONE[tone];
  const btnClass = `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold flex-shrink-0 transition-colors disabled:opacity-50 ${t.btn}`;
  const btnInner = (
    <>
      {cta.label}
      {cta.external ? <ArrowTopRightOnSquareIcon className="w-4 h-4" /> : <ArrowRightIcon className="w-4 h-4" />}
    </>
  );

  return (
    <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 flex items-start gap-3">
      <span className={`p-2 rounded-lg flex-shrink-0 ${t.dot}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white">{title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{detail}</p>
        {countdownTarget && (
          <div className="mt-1.5">
            <Countdown target={countdownTarget} label="Due" variant="urgent" />
          </div>
        )}
      </div>
      {cta.to ? (
        <Link to={cta.to} className={`mt-0.5 ${btnClass}`}>
          {btnInner}
        </Link>
      ) : (
        <button type="button" onClick={cta.onClick} disabled={cta.disabled} className={`mt-0.5 ${btnClass}`}>
          {btnInner}
        </button>
      )}
    </div>
  );
}
