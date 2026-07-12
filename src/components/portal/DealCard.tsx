import { useRef, useState, useCallback } from "react";
import {
  SUBMITTED_OR_PAST_STATUSES,
  type PortalDeal,
  type DocRequest,
  type MerchantDocument,
} from "../../services/portalService";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import { resolveJourney } from "../../data/merchantJourney";
import JourneyHero from "./JourneyHero";
import MerchantJourney from "./MerchantJourney";
import DocChecklist from "./DocChecklist";
import SubmissionsCard from "./SubmissionsCard";
import PaydownTracker from "./PaydownTracker";
import PostFundingVault from "./PostFundingVault";

interface DealCardProps {
  deal: PortalDeal;
  customerId: string | null;
  /** Page-level checklist rows (all deals) — used for at-a-glance step progress. */
  docRequests: DocRequest[];
  /** Signed/awaiting agreements, for the post-funding vault. */
  signDocuments: MerchantDocument[];
  /** Refetch page data after an inline upload. */
  onChanged: () => void;
}

/** MCA-family deal that has funded — flips into the paydown/renewal tracker. */
function isFundedMca(deal: PortalDeal): boolean {
  return deal.deal_type !== "vcf" && (deal.status === "funded" || deal.status === "renewal_eligible");
}

/**
 * One funding request, rendered so the merchant can do everything inline: the
 * animated JourneyHero (clickable step anchors), the step detail, the actual
 * upload checklist right here, and the post-funding tracker. Selecting the
 * "documents" step scrolls to the inline checklist — no navigation.
 */
export default function DealCard({ deal, customerId, docRequests, signDocuments, onChanged }: DealCardProps) {
  const { journey, currentIndex } = resolveJourney(deal);
  const currentKey = currentIndex >= 0 ? journey.steps[currentIndex].key : journey.steps[0].key;

  const [selectedKey, setSelectedKey] = useState(currentKey);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const checklistRef = useRef<HTMLDivElement | null>(null);

  const dealRequests = docRequests.filter((r) => r.deal_id === deal.id);
  const doneCount = dealRequests.filter(
    (r) => r.status === "uploaded" || r.status === "under_review" || r.status === "approved",
  ).length;
  const funded = isFundedMca(deal);

  // Show the inline checklist when there's something to upload, or when the deal
  // is sitting at the documents step (so uploads are always one tap away).
  const showChecklist = !!customerId && !funded && (dealRequests.length > 0 || currentKey === "documents");

  const handleSelectStep = useCallback((key: string) => {
    setSelectedKey(key);
    requestAnimationFrame(() => {
      if (key === "documents" && checklistRef.current) {
        checklistRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        heroRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }, []);

  const cfg = DEAL_STATUS_CONFIG[deal.status as keyof typeof DEAL_STATUS_CONFIG];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <span className="font-mono text-sm text-gray-900 dark:text-white">
            {deal.deal_number || "Your request"}
          </span>
          {deal.amount_requested != null && (
            <span className="ml-2 text-sm text-gray-500">
              ${deal.amount_requested.toLocaleString()}
            </span>
          )}
        </div>
        {cfg && (
          <span
            className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${cfg.bgColor} ${cfg.color}`}
          >
            {cfg.label}
          </span>
        )}
      </div>

      <div ref={heroRef}>
        <JourneyHero
          deal={deal}
          selectedKey={selectedKey}
          onSelectStep={handleSelectStep}
          hasUploadTarget={showChecklist}
        />
      </div>

      <div className="mt-4">
        <MerchantJourney
          deal={deal}
          docProgress={{ done: doneCount, total: dealRequests.length }}
          onSelectStep={handleSelectStep}
        />
      </div>

      {/* Inline upload checklist — the merchant uploads right here, no navigation. */}
      {showChecklist && customerId && (
        <div ref={checklistRef} className="mt-4 scroll-mt-24">
          <DocChecklist customerId={customerId} dealId={deal.id} includeAdHoc onChanged={onChanged} />
        </div>
      )}

      {funded ? (
        <>
          <div className="mt-4">
            <PaydownTracker deal={deal} />
          </div>
          <PostFundingVault deal={deal} customerId={customerId} signedDocuments={signDocuments} />
        </>
      ) : (
        deal.deal_type !== "vcf" &&
        SUBMITTED_OR_PAST_STATUSES.has(deal.status) && (
          <div className="mt-4">
            <SubmissionsCard dealId={deal.id} />
          </div>
        )
      )}
    </div>
  );
}
