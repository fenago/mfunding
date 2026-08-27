import { useNavigate } from "react-router-dom";
import NewLeadToast from "./NewLeadToast";
import { useLeadAlerts } from "../../context/LeadAlertContext";

/**
 * The app-wide mount of the corner alert stack. Rendered once by AdminLayout, so
 * a closer hears their live transfer whether they're on My Day, the Calendar, or
 * a lender page — not only inside the Revenue Playbook.
 *
 * Clicking a card routes to the playbook with ?deal=<id>, which the playbook's
 * deep-link handler resolves and opens on the right flow tab. Merchants never
 * reach this: it lives inside the admin shell only.
 */
export default function LeadAlertToaster() {
  const { alerts, dismiss, desktopEnabled, enableDesktop } = useLeadAlerts();
  const navigate = useNavigate();

  return (
    <NewLeadToast
      alerts={alerts}
      onOpen={(dealId) => {
        dismiss(dealId);
        navigate(`/admin/playbooks?deal=${encodeURIComponent(dealId)}`);
      }}
      onDismiss={dismiss}
      desktopEnabled={desktopEnabled}
      onEnableDesktop={enableDesktop}
    />
  );
}
