import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useUserProfile } from "./UserProfileContext";
import { useNewLeadAlert, type CornerAlert, type MatchBanner } from "../hooks/useNewLeadAlert";

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
 */
interface LeadAlertContextValue {
  alerts: CornerAlert[];
  dismiss: (dealId: string) => void;
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
  const { effectiveUserId, isAdmin } = useUserProfile();

  const [openDealId, setOpenDealId] = useState<string | null>(null);
  // The playbook's refresh callback is re-created on every render; hold it in a
  // ref so registering it can never churn the subscription.
  const refreshRef = useRef<((dealId: string) => void) | undefined>(undefined);

  const setOpenDeal = useCallback((dealId: string | null, onRefresh?: (dealId: string) => void) => {
    refreshRef.current = onRefresh;
    setOpenDealId(dealId);
  }, []);
  const onRefreshOpenDeal = useCallback((dealId: string) => refreshRef.current?.(dealId), []);

  const { alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop } =
    useNewLeadAlert({
      openDealId,
      onRefreshOpenDeal,
      // effectiveUserId is the impersonation-aware profile id — the same id stored
      // on deals.assigned_closer_id, so "view as <closer>" hears that closer's leads.
      viewerId: effectiveUserId,
      viewerIsManager: isAdmin,
    });

  const value = useMemo<LeadAlertContextValue>(
    () => ({ alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop, setOpenDeal }),
    [alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop, setOpenDeal],
  );

  return <LeadAlertContext.Provider value={value}>{children}</LeadAlertContext.Provider>;
}
