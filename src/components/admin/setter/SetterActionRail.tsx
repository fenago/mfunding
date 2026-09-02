import { useEffect, useRef, useState } from "react";
import { BoltIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import MerchantApplicationModal from "../MerchantApplicationModal";
import AdHocSendMenu from "../AdHocSendMenu";
import QuickAppModal from "../processor/QuickAppModal";
import SetterDndButton from "./SetterDndButton";
import { ensureDealStageAtLeast } from "../../../services/dealService";
import type { DealWithCustomer } from "../../../types/deals";

/**
 * SetterActionRail — the two actions a setter fires from the Operations
 * console, both reusing the Revenue Playbook's own controls (no reinvention):
 *   1. Fill out application  → MerchantApplicationModal (the PRIMARY/headline
 *      action — the in-app capture with all three send paths built in)
 *   2. Send docs             → AdHocSendMenu (application paths + agreements)
 *
 * Booking an appointment now lives in the Setter checklist (step 3, beside "Set a
 * callback") — both schedule a follow-up, so they belong together.
 *
 * Everything binds to the single already-loaded deal — nothing re-fetches it.
 *
 * `autoOpen` (application-first): when set, the application modal pops the FIRST
 * time each deal resolves, so capture leads. It fires once per deal id — reopening
 * after the setter closes it would be a nuisance — and never overrides a manual
 * close.
 */
export default function SetterActionRail({
  deal,
  onRefresh,
  autoOpen = false,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
  autoOpen?: boolean;
}) {
  const [showApp, setShowApp] = useState(false);
  const [showQuickApp, setShowQuickApp] = useState(false);
  // One auto-open per deal id: hold the id we've already popped for so switching
  // merchants re-arms it, but a close on the same deal stays closed.
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (autoOpen && deal.id && autoOpenedFor.current !== deal.id) {
      autoOpenedFor.current = deal.id;
      setShowApp(true);
    }
  }, [autoOpen, deal.id]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      {/* PRIMARY / headline actions — the fast mandatory-only Quick App beside the
          full application. Same width, side by side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setShowQuickApp(true)}
          title="Mandatory fields only — address/phone auto-fill, account/routing/DOB pre-defaulted, live-transfer script inside"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-amber-600"
        >
          <BoltIcon className="w-5 h-5" />
          Quick App
        </button>
        <button
          type="button"
          onClick={() => setShowApp(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-ocean-blue px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-ocean-blue/90"
        >
          <PencilSquareIcon className="w-5 h-5" />
          Fill out application
        </button>
      </div>

      {/* Secondary actions — send docs + take them off the list (DND), together so
          the setter can act on "take me off your list" right where they send. */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <AdHocSendMenu
          dealId={deal.id}
          merchantEmail={deal.customer?.email}
          ghlContactId={deal.ghl_contact_id}
        />
        <span className="ml-auto">
          <SetterDndButton deal={deal} onRefresh={onRefresh} />
        </span>
      </div>

      {showQuickApp && (
        <QuickAppModal
          dealId={deal.id}
          onClose={() => setShowQuickApp(false)}
          onSaved={onRefresh}
        />
      )}

      {showApp && (
        <MerchantApplicationModal
          deal={deal}
          onClose={() => setShowApp(false)}
          onSent={async () => {
            setShowApp(false);
            // The modal's send paths already set application_sent; this is a
            // forward-only safety net (no-op if already there), then refresh.
            await ensureDealStageAtLeast(deal, "application_sent");
            onRefresh();
          }}
          onSaved={async () => {
            // Draft/save = the setter WORKED the application → advance to at least
            // Qualifying (forward-only). NOT fired on the modal merely opening.
            await ensureDealStageAtLeast(deal, "qualifying");
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
