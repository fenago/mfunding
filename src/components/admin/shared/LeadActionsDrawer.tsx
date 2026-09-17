// LeadActionsDrawer — everything a setter or processor needs to WORK a merchant,
// inline on a list row, so nobody bounces between screens.
//
// EXTRACTED from HotLeadsPanel's HotLeadActions (2026-09-17) so the processor's
// application-chase queue mounts the identical action set. The owner's ask was
// literally "basically all of the things that are in the Hot Realtime Leads tab
// so that she can easily see what she needs to do and execute on it from right
// there" — which is this component, unchanged, on a second list.
//
// NOTHING HERE IS NEW. Every control is the SAME component the Operations console
// mounts (SetterOpsTab), bound to the same deal and firing the same RPCs and edge
// functions:
//   · SetterActionRail   → Quick App, full application (both with the
//                          ensureDealStageAtLeast wiring), Send docs
//                          (AdHocSendMenu), and Do Not Contact (SetterDndButton).
//   · SetterCommsPanel   → Text (TextMerchantPanel, the JMP/sms-send path — NOT
//                          GHL) and Email (EmailMerchantPanel).
//   · SetterCallOutcome  → log the disposition (connected / no answer / voicemail
//                          / callback / not interested → nurture) through
//                          logContactAttempt + updateDealStatus, with the ET
//                          callback picker and an optional note.
//   · BookAppointmentControl → book a real appointment (emails the invite).
//   · SetterNotes        → free-text notes on the deal.
// A duplicate send path here would be a second thing to keep correct, and the
// first one to drift.
//
// LAZY, AND ONE AT A TIME. A panel may render hundreds of rows; loading a full
// DealWithCustomer for each would be hundreds of reads to render a list nobody
// has asked to act on yet. The deal loads on expand, and panels keep a single row
// open (accordion), so the dense scan-list stays a scan-list.
//
// getDealById is the same loader the console uses, including its get_deal_lite
// fallback — so a processor opening a lead assigned to another setter still gets
// the row (money-masked) instead of an empty drawer.
//
// UNREADABLE ≠ "no such deal": a failed load says the read failed and offers a
// retry, rather than rendering an empty action set that looks like there is
// nothing to do.

import { useCallback, useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { getDealById } from "@/services/dealService";
import type { DealWithCustomer } from "@/types/deals";
import { useUserProfile } from "@/context/UserProfileContext";
import SetterActionRail from "@/components/admin/setter/SetterActionRail";
import SetterCommsPanel from "@/components/admin/setter/SetterCommsPanel";
import SetterCallOutcome from "@/components/admin/setter/SetterCallOutcome";
import SetterNotes from "@/components/admin/setter/SetterNotes";
import BookAppointmentControl from "@/components/admin/BookAppointmentControl";

export default function LeadActionsDrawer({
  dealId,
  onDealChanged,
}: {
  dealId: string;
  /** Re-read the panel so counts, heat and the tracker reflect what just happened. */
  onDealChanged: () => void;
}) {
  const { effectiveUserId } = useUserProfile();
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // BookAppointmentControl requires an onNotify; a local line keeps this drawer
  // self-contained, exactly as SetterChecklist does for the same control.
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const loadDeal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await getDealById(dealId);
      if (!res) {
        setError("Couldn't load this merchant's record — the actions can't be shown.");
        return;
      }
      setDeal(res.deal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this merchant's record.");
    } finally {
      setBusy(false);
    }
  }, [dealId]);

  useEffect(() => {
    void loadDeal();
  }, [loadDeal]);

  // Any action inside re-reads the deal AND tells the panel, so the attempt count
  // and heat on the row behind the drawer move the moment a call is logged.
  const refresh = useCallback(() => {
    void loadDeal();
    onDealChanged();
  }, [loadDeal, onDealChanged]);

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    // Stops the row's own onClick from firing — a tap on a button in here must not
    // also yank the merchant into the console above.
    <div
      className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 p-3 space-y-3 cursor-default"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {busy && !deal && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="loading loading-spinner loading-xs" /> Loading the merchant's record…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">{error}</div>
            <button
              type="button"
              onClick={() => void loadDeal()}
              className="mt-1 font-semibold text-ocean-blue hover:underline"
            >
              Try again →
            </button>
          </div>
        </div>
      )}

      {deal && (
        <>
          {/* APPLY + SEND + take them off the list. autoOpen is deliberately OFF:
              in the console the application modal pops on load because a merchant
              is on the line, but a list row popping a full-screen modal on expand
              would fight whoever is scanning the panel. */}
          <SetterActionRail deal={deal} onRefresh={refresh} />

          {/* TEXT + EMAIL — the 5-minute speed-to-lead touch, and the channel the
              signature chase actually gets answered on. */}
          <SetterCommsPanel deal={deal} onRefresh={refresh} />

          {/* BOOK IT. */}
          <div className="flex flex-wrap items-center gap-3">
            <BookAppointmentControl
              dealId={deal.id}
              appointmentAt={deal.appointment_at}
              appointmentSyncedAt={deal.appointment_synced_at}
              appointmentSyncError={deal.appointment_sync_error}
              ownerUserId={effectiveUserId}
              onRefresh={refresh}
              onNotify={notify}
            />
          </div>

          {/* LOG THE CALL (also the callback + not-interested/nurture park) beside
              the notes, the same pairing the console uses at the bottom. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SetterCallOutcome deal={deal} onRefresh={refresh} />
            <SetterNotes deal={deal} onRefresh={refresh} />
          </div>
        </>
      )}

      {toast && (
        <p
          className={`text-xs font-medium ${
            toast.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}
