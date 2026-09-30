import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useUserProfile } from "./UserProfileContext";
import { useNewLeadAlert, type CornerAlert, type MatchBanner } from "../hooks/useNewLeadAlert";
import { useSignedApplicationAlert } from "../hooks/useSignedApplicationAlert";
import { useMerchantUpdateAlert } from "../hooks/useMerchantUpdateAlert";
import useIsProcessor from "../hooks/useIsProcessor";

/**
 * ONE realtime lead-alert subscription for the whole admin shell.
 *
 * Speed-to-lead doesn't care what screen the closer is on: a live transfer means
 * a merchant is on the phone RIGHT NOW. So the corner alert lives in AdminLayout
 * and fires on My Day, the Calendar, anywhere — but only for the closer the lead
 * was assigned to (see useNewLeadAlert for the ownership rules).
 *
 * The Revenue Playbook needs the OTHER half of the same stream — the in-playbook
 * MatchBanner, which depends on which deal is open. Rather than mount the hook
 * twice (two subscriptions, two chimes, two toasts for one lead), the playbook
 * registers its open deal here via `setOpenDeal` and reads `matchBanner` back.
 *
 * THREE SOURCES, ONE STACK. Signed-application cards come from a different
 * table (ghl_doc_completions), and merchant-file changes from a third
 * (processor_notifications), each on its own subscription — but the corner is
 * one piece of screen, so all three are merged into `alerts` here and queue up
 * instead of covering each other.
 *
 * ORDER IS A PRIORITY CLAIM, and it is made once, here:
 *
 *   1. leads      — a live transfer means a merchant is ON THE PHONE right now
 *   2. updates    — a merchant CHANGED something and is waiting on us (the
 *                   Bankers correction: a name, an email and a phone, ignored)
 *   3. signatures — good news, and already up to an hour old by the time the
 *                   hourly sweep finds it (see useSignedApplicationAlert)
 *
 * Updates sit above signatures because a change usually carries a question; a
 * signature is a thing that has already gone right.
 */
interface LeadAlertContextValue {
  alerts: CornerAlert[];
  /** Dismiss one card by its `key` (the deal id for leads, `sig:<doc>` for a
   *  signature) — NOT by deal id: one deal can hold both kinds at once. */
  dismiss: (key: string) => void;
  dismissAll: () => void;
  matchBanner: MatchBanner | null;
  dismissBanner: () => void;
  desktopEnabled: boolean;
  enableDesktop: () => void;
  /**
   * Tell the alert stream which deal is on screen and how to reload it. Pass
   * (null) on unmount/clear. Stable identity — safe in a dependency array.
   */
  setOpenDeal: (dealId: string | null, onRefresh?: (dealId: string) => void) => void;
}

const LeadAlertContext = createContext<LeadAlertContextValue | null>(null);

export function useLeadAlerts(): LeadAlertContextValue {
  const ctx = useContext(LeadAlertContext);
  if (!ctx) throw new Error("useLeadAlerts must be used within a LeadAlertProvider");
  return ctx;
}

export function LeadAlertProvider({ children }: { children: React.ReactNode }) {
  const { effectiveUserId, isAdmin, isSuperAdmin } = useUserProfile();
  // Merchant-file changes go to PROCESSORS (and super-admins), matching the gate
  // on processor_pipeline_rows. Fail-closed while the capability read is in
  // flight — `isProcessor` is false until the RPC answers, and the hook
  // subscribes when it flips. A setter's browser never opens the channel.
  const { isProcessor } = useIsProcessor();

  const [openDealId, setOpenDealId] = useState<string | null>(null);
  // The playbook's refresh callback is re-created on every render; hold it in a
  // ref so registering it can never churn the subscription.
  const refreshRef = useRef<((dealId: string) => void) | undefined>(undefined);

  const setOpenDeal = useCallback((dealId: string | null, onRefresh?: (dealId: string) => void) => {
    refreshRef.current = onRefresh;
    setOpenDealId(dealId);
  }, []);
  const onRefreshOpenDeal = useCallback((dealId: string) => refreshRef.current?.(dealId), []);

  const {
    alerts: leadAlerts,
    dismiss: dismissLead,
    dismissAll: dismissAllLeads,
    matchBanner,
    dismissBanner,
    desktopEnabled,
    enableDesktop,
  } = useNewLeadAlert({
    openDealId,
    onRefreshOpenDeal,
    // effectiveUserId is the impersonation-aware profile id — the same id stored
    // on deals.assigned_closer_id, so "view as <closer>" hears that closer's leads.
    viewerId: effectiveUserId,
    viewerIsManager: isAdmin,
  });

  const { alerts: signedAlerts, dismiss: dismissSigned } = useSignedApplicationAlert({ desktopEnabled });

  const { alerts: updateAlerts, dismiss: dismissUpdate } = useMerchantUpdateAlert({
    enabled: isProcessor || isSuperAdmin,
    desktopEnabled,
  });

  const alerts = useMemo(
    () => [...leadAlerts, ...updateAlerts, ...signedAlerts],
    [leadAlerts, updateAlerts, signedAlerts],
  );

  // Fan a dismissal out to all three streams; each ignores a key it doesn't hold.
  const dismiss = useCallback(
    (key: string) => {
      dismissLead(key);
      dismissSigned(key);
      dismissUpdate(key);
    },
    [dismissLead, dismissSigned, dismissUpdate],
  );
  const dismissAll = useCallback(() => {
    dismissAllLeads();
    for (const a of signedAlerts) dismissSigned(a.key);
    for (const a of updateAlerts) dismissUpdate(a.key);
  }, [dismissAllLeads, dismissSigned, signedAlerts, dismissUpdate, updateAlerts]);

  const value = useMemo<LeadAlertContextValue>(
    () => ({ alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop, setOpenDeal }),
    [alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop, setOpenDeal],
  );

  return <LeadAlertContext.Provider value={value}>{children}</LeadAlertContext.Provider>;
}
