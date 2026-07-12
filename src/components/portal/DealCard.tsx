import type { PortalDeal, MerchantDocument } from "../../services/portalService";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import { resolveJourney } from "../../data/merchantJourney";
import type { ApplicationStatus } from "../../utils/signing";
import JourneyHero from "./JourneyHero";
import StepDetail from "./StepDetail";

interface DealCardProps {
  deal: PortalDeal;
  customerId: string | null;
  /** Selected journey step (controlled by the page); falls back to the stage. */
  selectedKey?: string;
  onSelectStep: (key: string) => void;
  /** Resolved single application (one-application rule) for the application step. */
  application: ApplicationStatus;
  signedDocuments: MerchantDocument[];
  onSignNative: (doc: MerchantDocument) => void;
  onChanged: () => void;
}

/**
 * One funding request: the animated JourneyHero (stage vs. selection) plus the
 * substance card for whichever step is selected. Selection is controlled by the
 * page so the action block can jump straight to a step (e.g. documents).
 */
export default function DealCard({
  deal,
  customerId,
  selectedKey,
  onSelectStep,
  application,
  signedDocuments,
  onSignNative,
  onChanged,
}: DealCardProps) {
  const { journey, currentIndex, isTerminal } = resolveJourney(deal);
  const currentKey = currentIndex >= 0 ? journey.steps[currentIndex].key : journey.steps[0].key;
  const activeKey = selectedKey || currentKey;

  const cfg = DEAL_STATUS_CONFIG[deal.status as keyof typeof DEAL_STATUS_CONFIG];

  // Terminal / off-journey deals get a respectful status card, not a stepper.
  if (isTerminal) {
    const isDeclined = deal.status === "declined";
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700">
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
      </div>
    );
  }

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

      <JourneyHero deal={deal} selectedKey={activeKey} onSelectStep={onSelectStep} />

      <div id={`step-detail-${deal.id}`} className="mt-4 scroll-mt-24">
        <StepDetail
          deal={deal}
          stepKey={activeKey}
          customerId={customerId}
          application={application}
          signedDocuments={signedDocuments}
          onSignNative={onSignNative}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}
