import { Link } from "react-router-dom";
import { BoltIcon, CheckCircleIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import type { PortalDeal, DocRequest, MerchantDocument, GhlDocument } from "../../services/portalService";
import Countdown from "./Countdown";
import { isDeadlinePast } from "../../utils/deadline";
import { ghlPending } from "../../utils/signing";

interface ActionNeededHeroProps {
  deals: PortalDeal[];
  /** Count of the merchant's documents still pending review/upload. */
  pendingDocuments: number;
  /** Open document-checklist requests across the merchant's deals. */
  docRequests?: DocRequest[];
  /** Agreements awaiting the merchant's signature (status 'sent'). */
  signDocuments?: MerchantDocument[];
  /** Real GHL documents awaiting signature (opened in a new tab). */
  ghlDocuments?: GhlDocument[];
  /** Number of offer-stage submissions the merchant can review right now. */
  offerCount?: number;
}

interface ActionItem {
  priority: number; // higher = more urgent
  title: string;
  detail: string;
  to?: string;
  ctaLabel?: string;
  /** Show a live countdown to this ISO target (stips deadline). */
  countdownTarget?: string;
}

/** Derive the single most important thing the merchant should do right now. */
function topAction(
  deals: PortalDeal[],
  pendingDocuments: number,
  docRequests: DocRequest[],
  signDocuments: MerchantDocument[],
  ghlDocuments: GhlDocument[],
  offerCount: number,
): ActionItem | null {
  const actions: ActionItem[] = [];

  // A ready-to-sign document is the single most important active step — the file
  // is one signature from moving forward. Native in-app agreements and real GHL
  // documents are merged into one signal.
  const nativeToSign = signDocuments.filter((d) => d.status === "sent");
  const ghlToSign = ghlPending(ghlDocuments);
  const totalToSign = nativeToSign.length + ghlToSign.length;
  if (totalToSign > 0) {
    const one = totalToSign === 1;
    // Deep-link a lone native agreement to its sign page; anything involving a
    // GHL doc (opens in a new tab) routes to the Documents "To sign" section.
    const to = one && nativeToSign.length === 1 ? `/portal/sign/${nativeToSign[0].id}` : "/portal/documents";
    actions.push({
      priority: 120,
      title: one ? "Your document is ready to sign" : `${totalToSign} documents ready to sign`,
      detail: "Review and add your signature to keep your funding moving.",
      to,
      ctaLabel: one ? "Review & sign" : "Review documents",
    });
  }

  // Offers waiting for the merchant's decision — just below a rejected doc.
  if (offerCount > 0) {
    actions.push({
      priority: 105,
      title: offerCount === 1 ? "You have an offer to review" : `You have ${offerCount} offers to review`,
      detail: "See your funding options side by side and choose the one that fits.",
      to: "/portal/offers",
      ctaLabel: "Review your offers",
    });
  }

  // Explicit document requests are the most precise signal — a rejected doc is
  // the single most urgent thing on a merchant's plate (their file is stalled).
  const rejected = docRequests.filter((r) => r.status === "rejected");
  const stillNeeded = docRequests.filter((r) => r.status === "requested");
  if (rejected.length > 0) {
    actions.push({
      priority: 110,
      title: `${rejected.length} document${rejected.length === 1 ? "" : "s"} need${rejected.length === 1 ? "s" : ""} another look`,
      detail: "One of your uploads couldn't be accepted — tap to send it again and keep your file moving.",
      to: "/portal/documents",
      ctaLabel: "Re-upload now",
    });
  }
  if (stillNeeded.length > 0) {
    // Surface the soonest due date as a countdown if any request has one.
    const soonest = stillNeeded
      .map((r) => r.due_at)
      .filter((d): d is string => !!d)
      .sort()[0];
    actions.push({
      priority: 78,
      title: `${stillNeeded.length} document${stillNeeded.length === 1 ? "" : "s"} needed`,
      detail: "Upload what your specialist asked for — it's the fastest way to your offers.",
      to: "/portal/documents",
      ctaLabel: "Upload documents",
      countdownTarget: soonest,
    });
  }

  for (const d of deals) {
    // Stips overdue — most urgent. (date-only aware: overdue only after end of day)
    if (isDeadlinePast(d.stips_promised_by) && (d.status === "docs_collected" || d.status === "bank_statements")) {
      actions.push({
        priority: 100,
        title: "Your bank statements are past due",
        detail: "Upload them now to keep your file moving with our funding partners.",
        to: "/portal/documents",
        ctaLabel: "Upload documents",
        countdownTarget: d.stips_promised_by ?? undefined,
      });
    }
    // Offer awaiting the merchant's decision — fallback nudge when we don't have
    // an authoritative offer count yet (deep-links to the offers page all the same).
    if (d.status === "offer_presented" && offerCount === 0) {
      actions.push({
        priority: 90,
        title: "You have an offer to review",
        detail: "See your funding options and choose the one that fits.",
        to: "/portal/offers",
        ctaLabel: "Review your offers",
      });
    }
    // Application waiting to be signed.
    if (d.status === "application_sent") {
      actions.push({
        priority: 80,
        title: "Sign your application",
        detail: "Check your email for the link to complete and sign your application.",
      });
    }
    // Documents needed (not yet overdue).
    if (d.status === "docs_collected" || d.status === "bank_statements") {
      actions.push({
        priority: 70,
        title: "Upload your documents",
        detail: "Your most recent business bank statements are the fastest way to your offers.",
        to: "/portal/documents",
        ctaLabel: "Upload documents",
        countdownTarget: d.stips_promised_by ?? undefined,
      });
    }
  }

  // Any documents flagged pending, independent of stage.
  if (pendingDocuments > 0) {
    actions.push({
      priority: 60,
      title: `You have ${pendingDocuments} document${pendingDocuments === 1 ? "" : "s"} to take care of`,
      detail: "Open your documents to see what's needed.",
      to: "/portal/documents",
      ctaLabel: "Go to documents",
    });
  }

  if (actions.length === 0) return null;
  return actions.sort((a, b) => b.priority - a.priority)[0];
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

export default function ActionNeededHero({
  deals,
  pendingDocuments,
  docRequests = [],
  signDocuments = [],
  ghlDocuments = [],
  offerCount = 0,
}: ActionNeededHeroProps) {
  const action = topAction(deals, pendingDocuments, docRequests, signDocuments, ghlDocuments, offerCount);

  if (!action) {
    return (
      <div className="sticky top-2 z-20 rounded-xl p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              You're all set — we're working on it.
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
              {nextUpdateHint(deals)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-2 z-20 rounded-xl p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 shadow-sm">
      <div className="flex items-start gap-3">
        <BoltIcon className="w-6 h-6 text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-amber-900 dark:text-amber-100">{action.title}</p>
          <p className="text-sm text-amber-800 dark:text-amber-200 mt-0.5">{action.detail}</p>
          {action.countdownTarget && (
            <div className="mt-2">
              <Countdown target={action.countdownTarget} label="Due" variant="urgent" />
            </div>
          )}
          {action.to && action.ctaLabel && (
            <Link
              to={action.to}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
            >
              {action.ctaLabel}
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
