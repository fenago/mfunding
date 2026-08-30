// SetterChecklist — "the 3 things", pinned at the top of the Setter Operations
// console so a setter sees at a glance what's done and what's left on the loaded deal:
//
//   1. APPLICATION (headline) — a live completion meter + the exact mandatory fields
//      still missing (SetterAppProgress, gated by the SAME required set the send modal
//      uses).
//   2. BANK STATEMENTS — Plaid connect link (SetterConnectBank) OR email to
//      sales@send.mfunding.net, plus an upload-documents button (DealDocumentsButton).
//   3. CALLBACK (fallback) — if neither can happen right now, set a callback (handled
//      by the SetterCallOutcome panel further down the console; this is just the nudge).
//
// Each step shows ✓ done / ◑ partial (with the %) / ○ not started. Everything binds to
// the already-loaded deal and refreshes through the shared `reload` (onRefresh) — no
// component here re-fetches the deal.

import { useState } from "react";
import { ClipboardDocumentCheckIcon } from "@heroicons/react/24/outline";
import type { DealWithCustomer } from "@/types/deals";
import { useDealPlaidItem } from "@/hooks/useDealPlaidItem";
import { useUserProfile } from "@/context/UserProfileContext";
import { dateTimeET } from "@/utils/time";
import SetterAppProgress, { type AppProgressStatus } from "@/components/admin/setter/SetterAppProgress";
import SetterConnectBank from "@/components/admin/setter/SetterConnectBank";
import { DealDocumentsButton } from "@/components/admin/DealDocumentsModal";
import BookAppointmentControl from "@/components/admin/BookAppointmentControl";

const SALES_EMAIL = "sales@send.mfunding.net";

interface Props {
  deal: DealWithCustomer;
  onRefresh: () => void;
}

type StepStatus = "done" | "partial" | "todo";

/** The left-hand glance badge: ✓ done / ◑ partial / ○ not started. */
function StepBadge({ n, status }: { n: number; status: StepStatus }) {
  const cls =
    status === "done"
      ? "border-emerald-400 bg-emerald-500 text-white"
      : status === "partial"
      ? "border-amber-400 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : "border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500";
  const glyph = status === "done" ? "✓" : status === "partial" ? "◑" : n;
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${cls}`}
      aria-hidden
    >
      {glyph}
    </div>
  );
}

function StepRow({
  n,
  status,
  title,
  children,
}: {
  n: number;
  status: StepStatus;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <StepBadge n={n} status={status} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-sm font-bold text-gray-900 dark:text-white">{title}</div>
        {children}
      </div>
    </div>
  );
}

export default function SetterChecklist({ deal, onRefresh }: Props) {
  const { effectiveUserId } = useUserProfile();
  // BookAppointmentControl requires an onNotify; a lightweight local toast keeps
  // step 3 self-contained (mirrors the pattern SetterActionRail used to carry).
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const notify = (text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 4000);
  };

  // Step 1 status comes up from SetterAppProgress (which owns the draft read).
  const [appStatus, setAppStatus] = useState<AppProgressStatus | null>(null);
  const appStep: StepStatus = !appStatus || appStatus.unreadable
    ? "todo"
    : appStatus.done
    ? "done"
    : appStatus.pct > 0
    ? "partial"
    : "todo";

  // Step 2 — bank connected (Plaid) OR statements/docs already received.
  const { item: bank } = useDealPlaidItem(deal.id, deal.customer_id);
  const bankConnected = !!bank && bank.status === "active";
  const statementsIn = bankConnected || !!deal.bank_statements_at || !!deal.docs_collected_at;
  const bankStep: StepStatus = statementsIn ? "done" : "todo";

  const customer = deal.customer;
  const customerId = customer?.id ?? null;
  const merchantName =
    customer?.business_name?.trim() ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() ||
    null;

  // Step 3 — callback set?
  const callbackStep: StepStatus = deal.callback_at ? "done" : "todo";

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardDocumentCheckIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Setter checklist — the 3 things</h3>
      </div>

      <div className="space-y-4">
        {/* 1 — APPLICATION (headline) */}
        <StepRow n={1} status={appStep} title="Get the application filled &amp; sent">
          <SetterAppProgress deal={deal} onRefresh={onRefresh} onStatus={setAppStatus} />
        </StepRow>

        <div className="border-t border-gray-100 dark:border-gray-700/60" />

        {/* 2 — BANK STATEMENTS */}
        <StepRow n={2} status={bankStep} title="Get the bank statements">
          <div className="space-y-2">
            {bankStep === "done" ? (
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {bankConnected ? "Bank connected — statements pulled." : "Statements / documents received."}
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Fastest is Plaid — one ~60-second connect verifies revenue and pulls ~6 months of statements.
              </p>
            )}
            <SetterConnectBank deal={deal} onRefresh={onRefresh} />
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Or the merchant can email their bank statements to{" "}
              <a href={`mailto:${SALES_EMAIL}`} className="font-semibold text-ocean-blue">
                {SALES_EMAIL}
              </a>
              .
            </p>
            {customerId && (
              <div>
                <DealDocumentsButton customerId={customerId} merchantName={merchantName} />
              </div>
            )}
          </div>
        </StepRow>

        <div className="border-t border-gray-100 dark:border-gray-700/60" />

        {/* 3 — CALLBACK / APPOINTMENT (fallback) — both schedule a follow-up. */}
        <StepRow n={3} status={callbackStep} title="No luck today? Set a callback">
          <div className="space-y-2">
            {callbackStep === "done" ? (
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Callback set for {dateTimeET(deal.callback_at as string)}.
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Can't get the application or the statements right now? Use{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">Log the call</span> below to set a
                callback so this deal comes back to the top when it's due.
              </p>
            )}
            {/* Or, if the merchant agreed to a real meeting, book the appointment
                right here — it lives beside the callback because both schedule a
                follow-up (an appointment emails the merchant an invite). */}
            <BookAppointmentControl
              dealId={deal.id}
              appointmentAt={deal.appointment_at}
              appointmentSyncedAt={deal.appointment_synced_at}
              appointmentSyncError={deal.appointment_sync_error}
              ownerUserId={effectiveUserId}
              onRefresh={onRefresh}
              onNotify={notify}
            />
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
          </div>
        </StepRow>
      </div>

      {/* General reassurance line. */}
      <p className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
        The customer can always send documents to{" "}
        <a href={`mailto:${SALES_EMAIL}`} className="font-semibold text-ocean-blue">
          {SALES_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
