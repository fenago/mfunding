import { useNavigate } from "react-router-dom";
import NewLeadToast from "./NewLeadToast";
import { useLeadAlerts } from "../../context/LeadAlertContext";

/**
 * The app-wide mount of the corner alert stack. Rendered once by AdminLayout, so
 * a closer hears their live transfer whether they're on My Day, the Calendar, or
 * a lender page — not only inside the Revenue Playbook.
 *
 * The same stack carries the APPLICATION SIGNED card (see
 * useSignedApplicationAlert) — one corner, one queue, no two stacks fighting for
 * the same pixels.
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
        // Retire every card pointing at the deal we're about to open — a lead
        // card and a signature card can both be up for the same merchant, and
        // leaving one behind after the click looks like a second, unread event.
        for (const a of alerts) if (a.dealId === dealId) dismiss(a.key);
        navigate(`/admin/playbooks?deal=${encodeURIComponent(dealId)}`);
      }}
      onDismiss={dismiss}
      desktopEnabled={desktopEnabled}
      onEnableDesktop={enableDesktop}
    />
  );
}
