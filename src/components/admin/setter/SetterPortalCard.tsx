import { useEffect, useState } from "react";
import { UserCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { DealWithCustomer } from "../../../types/deals";
import supabase from "../../../supabase";
import { groupDocs, type GhlDoc } from "../../../lib/ghlDocs";
import PortalInviteButton from "../PortalInviteButton";
import PortalAccessChip from "../PortalAccessChip";
import { DealDocumentsButton } from "../DealDocumentsModal";

/**
 * Setter Ops — merchant portal + documents, in ONE card.
 *
 * Everything a setter needs to get paperwork moving without leaving the deal:
 *   • the portal-active status chip (can this merchant sign in?)
 *   • a one-click "send / resend portal invite" (the sign-in link that lets them
 *     upload docs and e-sign)
 *   • the Documents button (files on record + what's out for signature)
 *
 * All three are EXISTING self-contained components (PortalAccessChip,
 * PortalInviteButton, DealDocumentsButton) — this card only arranges them and
 * feeds DealDocumentsButton the e-sign summary from a single ghl-docs-status
 * fetch, mirroring what the Revenue Playbook's DealContextBar builds. No
 * re-fetch of the deal; no mutation of its own (each child owns its own action).
 */
export default function SetterPortalCard({
  deal,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const customer = deal.customer;
  const customerId = customer?.id ?? null;
  const merchantName = customer?.business_name?.trim()
    || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim()
    || null;

  // ONE ghl-docs-status fetch → the "· N out / N signed" suffix on the Documents
  // button, so a doc out for signature is never invisible behind "Documents (0)".
  // Same {out, signed} shape DealContextBar builds. Stays null (suffix hidden)
  // when there's no GHL contact or the fetch can't be read — never claims zero.
  const ghlContactId = deal.ghl_contact_id;
  const [esign, setEsign] = useState<{ out: number; signed: number } | null>(null);
  useEffect(() => {
    if (!ghlContactId) { setEsign(null); return; }
    let cancelled = false;
    setEsign(null);
    supabase.functions
      .invoke("ghl-docs-status", { body: { ghl_contact_id: ghlContactId } })
      .then(({ data }) => {
        if (cancelled || data?.error) return;
        const groups = groupDocs((data?.documents ?? []) as GhlDoc[]);
        setEsign({
          out: groups.filter((g) => !g.latest.signed).length,
          signed: groups.filter((g) => g.latest.signed).length,
        });
      })
      .catch(() => { /* leave the suffix off rather than claim zero */ });
    return () => { cancelled = true; };
  }, [ghlContactId]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <UserCircleIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Portal &amp; Documents</h3>
      </div>

      {!customerId ? (
        <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          No customer record on this deal — nothing to invite or collect yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Status + invite side by side; both self-contained. */}
          <div className="flex flex-wrap items-center gap-2">
            <PortalAccessChip customerId={customerId} />
            <PortalInviteButton customerId={customerId} compact />
          </div>

          {/* Files on record + what's out for signature. */}
          <div>
            <DealDocumentsButton
              customerId={customerId}
              merchantName={merchantName}
              esign={esign}
            />
          </div>
        </div>
      )}
    </div>
  );
}
