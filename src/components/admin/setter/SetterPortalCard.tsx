import { useEffect, useState } from "react";
import {
  UserCircleIcon,
  ExclamationTriangleIcon,
  DocumentIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import type { DealWithCustomer } from "../../../types/deals";
import supabase from "../../../supabase";
import { groupDocs, type GhlDoc } from "../../../lib/ghlDocs";
import PortalInviteButton from "../PortalInviteButton";
import PortalAccessChip from "../PortalAccessChip";
import { DealDocumentsButton } from "../DealDocumentsModal";

// Compact human labels for the doc-type chip (mirrors DealDocumentsModal; falls
// back to the raw type for anything not listed).
const DOC_TYPE_LABELS: Record<string, string> = {
  bank_statement: "Bank Statement",
  application: "Application",
  tax_return: "Tax Return",
  id: "ID / Driver's License",
  business_license: "Business License",
  voided_check: "Voided Check",
  credit_authorization: "Credit Authorization",
  personal_guarantee: "Personal Guarantee",
  other: "Other / Unsorted",
};

interface SetterDocRow {
  id: string;
  filename: string;
  document_type: string;
  created_at: string;
}

/** Short upload date, e.g. "Aug 29". Guards an unparseable timestamp. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const MAX_VISIBLE_DOCS = 4;

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

  // Inline list of the files on the merchant's record — same customer_documents
  // read DealDocumentsModal makes, so no new schema assumption. Three states,
  // kept distinct: null = still loading, [] = read SUCCEEDED and there are none,
  // docsError set = the read FAILED (never show "empty" on a failed read).
  const [docs, setDocs] = useState<SetterDocRow[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  useEffect(() => {
    if (!customerId) { setDocs(null); setDocsError(null); return; }
    let cancelled = false;
    setDocs(null);
    setDocsError(null);
    supabase
      .from("customer_documents")
      .select("id, filename, document_type, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setDocsError(error.message);
          setDocs(null);
          return;
        }
        setDocs((data as SetterDocRow[]) ?? []);
      });
    return () => { cancelled = true; };
  }, [customerId]);

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
          <div className="space-y-2">
            <DealDocumentsButton
              customerId={customerId}
              merchantName={merchantName}
              esign={esign}
            />

            {/* Inline list of the actual files — not just the count. */}
            {docsError ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
                Couldn't read documents — try again.
              </p>
            ) : docs === null ? (
              <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                <span className="loading loading-spinner loading-xs" /> Loading documents…
              </p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No documents uploaded yet.</p>
            ) : (
              <ul className="space-y-1">
                {docs.slice(0, MAX_VISIBLE_DOCS).map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
                  >
                    <DocumentIcon className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate font-medium text-gray-900 dark:text-white">
                      {doc.filename}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="whitespace-nowrap text-gray-400 dark:text-gray-500">
                      {shortDate(doc.created_at)}
                    </span>
                  </li>
                ))}
                {docs.length > MAX_VISIBLE_DOCS && (
                  <li className="text-xs text-gray-400 dark:text-gray-500">
                    +{docs.length - MAX_VISIBLE_DOCS} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
