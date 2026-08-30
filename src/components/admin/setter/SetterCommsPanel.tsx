import TextMerchantPanel from "../TextMerchantPanel";
import EmailMerchantPanel from "../EmailMerchantPanel";
import { ensureDealStageAtLeast } from "../../../services/dealService";
import type { DealWithCustomer } from "../../../types/deals";

/**
 * SetterCommsPanel — text + email the merchant without leaving the Operations
 * console, reusing the Revenue Playbook's own two compose panels wired EXACTLY as
 * PlaybooksPage's DealContextBar wires them (both carry their template chips + a
 * Blank/write-my-own option built in). This is the 5-minute speed-to-lead touch;
 * if it lived three screens away in Comms it wouldn't get sent inside the window.
 *
 * Binds to the single already-loaded deal — nothing re-fetches it. onRefresh is
 * threaded into the text panel's onSent (a send is the deal's first touch, so the
 * host re-reads it).
 */
export default function SetterCommsPanel({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const bestTime = (deal as unknown as { lead_qual?: Record<string, unknown> | null }).lead_qual?.[
    "best_time"
  ] as string | undefined;

  // A sent text/email = the setter has engaged the merchant → advance to at least
  // Contacted (forward-only; no-op if already past it), then re-read the deal so
  // the pipeline rail + snapshot reflect the new stage.
  const onSent = async () => {
    await ensureDealStageAtLeast(deal, "contacted");
    onRefresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* TEXT the merchant — inline compose through the real JMP path (sms-send),
          with connect-bank / upload / signing links one tap from the body. */}
      <TextMerchantPanel
        dealId={deal.id}
        customerId={deal.customer?.id}
        merchantPhone={deal.customer?.phone}
        additionalPhones={deal.customer?.additional_phones ?? []}
        merchantEmail={deal.customer?.email}
        merchantFirstName={deal.customer?.first_name}
        businessName={deal.customer?.business_name}
        ghlContactId={deal.ghl_contact_id}
        onSent={onSent}
      />
      {/* EMAIL the merchant — same panel the playbook uses, templates + Blank
          built in; CC rides on additional_emails. */}
      <EmailMerchantPanel
        dealId={deal.id}
        merchantEmail={deal.customer?.email}
        additionalEmails={deal.customer?.additional_emails ?? []}
        merchantFirstName={deal.customer?.first_name}
        businessName={deal.customer?.business_name}
        leadSource={deal.lead_source}
        bestTime={bestTime}
        onSent={onSent}
      />
    </div>
  );
}
