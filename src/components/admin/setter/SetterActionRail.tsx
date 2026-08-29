import { useState } from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import MerchantApplicationModal from "../MerchantApplicationModal";
import AdHocSendMenu from "../AdHocSendMenu";
import BookAppointmentControl from "../BookAppointmentControl";
import { useUserProfile } from "../../../context/UserProfileContext";
import type { DealWithCustomer } from "../../../types/deals";

/**
 * SetterActionRail — the three actions a setter fires from the Operations
 * console, all reusing the Revenue Playbook's own controls (no reinvention):
 *   1. Fill out application  → MerchantApplicationModal (the PRIMARY/headline
 *      action — the in-app capture with all three send paths built in)
 *   2. Send docs             → AdHocSendMenu (application paths + agreements)
 *   3. Appointment           → BookAppointmentControl (30-min GHL calendar book)
 *
 * Everything binds to the single already-loaded deal — nothing re-fetches it.
 */
export default function SetterActionRail({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const { effectiveUserId } = useUserProfile();
  const [showApp, setShowApp] = useState(false);
  // BookAppointmentControl requires an onNotify; a lightweight local toast keeps
  // this component self-contained (the host only needs to hand us the deal).
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const notify = (text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      {/* PRIMARY / headline action — fill the application in-app, then send it. */}
      <button
        type="button"
        onClick={() => setShowApp(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ocean-blue px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-ocean-blue/90"
      >
        <PencilSquareIcon className="w-5 h-5" />
        Fill out application
      </button>

      {/* Secondary actions — send docs + book an appointment. */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <AdHocSendMenu
          dealId={deal.id}
          merchantEmail={deal.customer?.email}
          ghlContactId={deal.ghl_contact_id}
        />
        <BookAppointmentControl
          dealId={deal.id}
          appointmentAt={deal.appointment_at}
          appointmentSyncedAt={deal.appointment_synced_at}
          appointmentSyncError={deal.appointment_sync_error}
          ownerUserId={effectiveUserId}
          onRefresh={onRefresh}
          onNotify={notify}
        />
      </div>

      {toast && (
        <div
          className={`text-xs font-medium ${
            toast.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {toast.text}
        </div>
      )}

      {showApp && (
        <MerchantApplicationModal
          deal={deal}
          onClose={() => setShowApp(false)}
          onSent={() => {
            setShowApp(false);
            onRefresh();
          }}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}
