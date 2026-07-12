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
import { openGhlDoc, type Signable } from "../../utils/signing";
import { isDeadlinePast } from "../../utils/deadline";
import Countdown from "./Countdown";

interface ActionBlockProps {
  deals: PortalDeal[];
  /** Unified pending signables (native + GHL), collapsed by the one-application rule. */
  pending: Signable[];
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
  docRequests,
  offerCount,
  onSignNative,
  onUpload,
}: ActionBlockProps) {
  // Upload need: explicit requests, or a deal parked at the documents stage.
  const openReqs = docRequests.filter((r) => r.status === "requested" || r.status === "rejected");
  const rejected = docRequests.filter((r) => r.status === "rejected");
  const docsStageDeal = deals.find((d) => d.status === "docs_collected" || d.status === "bank_statements");
  const uploadDeal =
    deals.find((d) => openReqs.some((r) => r.deal_id === d.id)) ?? docsStageDeal ?? null;
  const needUpload = openReqs.length > 0 || !!docsStageDeal;
  const overdue = deals.find(
    (d) => isDeadlinePast(d.stips_promised_by) && (d.status === "docs_collected" || d.status === "bank_statements"),
  );
  const soonestDue =
    openReqs
      .map((r) => r.due_at)
      .filter((d): d is string => !!d)
      .sort()[0] ?? overdue?.stips_promised_by ?? undefined;

  const offersActive = offerCount > 0 || deals.some((d) => d.status === "offer_presented");

  const rowCount = pending.length + (needUpload ? 1 : 0) + (offersActive ? 1 : 0);

  // Nothing to do → the all-set state.
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
          </div>
        </div>
      </div>
    );
  }

  const uploadUrgent = rejected.length > 0 || !!overdue;

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

        {/* 2) Upload */}
        {needUpload && uploadDeal && (
          <ActionRow
            icon={<ArrowUpTrayIcon className="w-5 h-5" />}
            tone={uploadUrgent ? "red" : "amber"}
            title={
              rejected.length > 0
                ? "Re-upload a document"
                : overdue
                  ? "Your bank statements are past due"
                  : "Upload your documents"
            }
            detail={
              rejected.length > 0
                ? "One of your uploads couldn't be accepted — send it again to keep your file moving."
                : "Your most recent business bank statements are the fastest way to your offers."
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
