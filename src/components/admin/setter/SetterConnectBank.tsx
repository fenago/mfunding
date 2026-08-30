// SetterConnectBank — the "Connect bank + statements" affordance for the Setter
// Operations console. One connect (~60 seconds via Plaid) verifies revenue AND
// pulls ~6 months of bank statement PDFs straight from the bank, so there are no
// statements to chase — the #1 leak in the funnel.
//
// Ported from the Revenue Playbook's ConnectBankBarChip so the two surfaces can't
// drift:
//   · CONNECTED (an ACTIVE Plaid item) → a green chip naming the bank, linking to
//     the deal's Documents tab for the full Plaid panel.
//   · NOT CONNECTED → a button that mints the tokenized /connect-bank/<token> link
//     and copies it to the clipboard (non-destructive copy → no armed two-step).
//     A hint reminds the setter the same link can be dropped into a Text from the
//     comms panel (that path already exists).
//
// Standalone by contract: takes only { deal, onRefresh }, never re-fetches the
// deal, reuses the EXPORTED hook + helper.
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DealWithCustomer } from "@/types/deals";
import { useDealPlaidItem } from "@/hooks/useDealPlaidItem";
import { mintAndCopyConnectBankLink } from "@/lib/connectBank";

interface Props {
  deal: DealWithCustomer;
  onRefresh: () => void;
}

export default function SetterConnectBank({ deal, onRefresh }: Props) {
  const { item: bank } = useDealPlaidItem(deal.id, deal.customer_id);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // CONNECTED — a compact green chip naming the institution, linking to the deal's
  // Documents tab for the full Plaid panel.
  if (bank && bank.status === "active") {
    return (
      <div className="flex flex-col gap-1">
        <Link
          to={`/admin/deals/${deal.id}#documents`}
          title={`Bank connected via Plaid${bank.institution_name ? ` — ${bank.institution_name}` : ""} · ${(bank.transactions_count ?? 0).toLocaleString()} transactions. Opens the full bank panel.`}
          className="inline-flex w-fit items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40"
        >
          🏦 {bank.institution_name || "Bank"} ✓
        </Link>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Bank connected — revenue verified and statements pulled. No statements to chase.
        </span>
      </div>
    );
  }

  const copy = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await mintAndCopyConnectBankLink(deal.id);
      setFlash(true);
      setTimeout(() => setFlash(false), 2000);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mint a Connect-Bank link.");
      setTimeout(() => setErr(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={copy}
        disabled={busy}
        title="Mint a secure Connect-Bank link and copy it — text it to the merchant. One ~60-second connect verifies revenue AND pulls their last ~6 months of bank statements straight from the bank (where the bank supports it), so there are no statement PDFs to chase."
        className={`inline-flex w-fit items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-60 ${
          err
            ? "border-red-400 text-red-600 dark:text-red-400"
            : flash
            ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-900/20"
            : "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
        }`}
      >
        {busy
          ? "🏦 …"
          : flash
          ? "🏦 link copied ✓"
          : err
          ? "🏦 couldn't mint — retry"
          : "🏦 Connect bank + statements"}
      </button>
      {err ? (
        <span className="text-[10px] text-red-600 dark:text-red-400">{err}</span>
      ) : (
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Copies a secure link to paste into a text — or drop it straight into a Text from the comms panel.
        </span>
      )}
    </div>
  );
}
