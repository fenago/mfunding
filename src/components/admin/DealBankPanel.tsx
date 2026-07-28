import { useCallback, useEffect, useState } from "react";
import {
  BuildingLibraryIcon,
  ArrowPathIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { parseEdgeError } from "../../lib/edgeError";
import { mintAndCopyConnectBankLink } from "../../lib/connectBank";
import type { PlaidItem, PlaidItemStatus } from "../../services/portalService";

interface Props {
  dealId: string;
  customerId: string | null;
}

const PLAID_ITEM_COLUMNS =
  "id, customer_id, deal_id, item_id, institution_name, environment, status, " +
  "error_code, error_message, accounts, last_pull_at, transactions_count, " +
  "statements_count, created_at";

const STATUS_CHIP: Record<PlaidItemStatus, { label: string; cls: string }> = {
  active: { label: "active", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  pending: { label: "pending", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  error: { label: "error", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  revoked: { label: "revoked", cls: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
};

interface Note {
  ok: boolean;
  text: string;
}

/**
 * DealBankPanel — the honest admin view of a deal's Plaid bank connection.
 * Staff read plaid_items directly (RLS lets staff read all). Shows the linked
 * institution, live status, last pull, and how much data we hold; "Pull now"
 * re-pulls transactions/statements via the deployed plaid-pull function.
 *
 * No connection yet → points staff at the Send-docs menu's connect link. This
 * verifies revenue; never described as a loan.
 */
export default function DealBankPanel({ dealId, customerId }: Props) {
  const [item, setItem] = useState<PlaidItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [minting, setMinting] = useState(false);

  // Mint + copy the Connect-Bank link right in the empty state — the admin is
  // looking at "no bank connected" here, so the fix shouldn't be a pointer to
  // another menu. Shared helper, same path as the deal bar chip and Send docs.
  const copyConnectLink = async () => {
    if (minting) return;
    setMinting(true);
    setNote(null);
    try {
      await mintAndCopyConnectBankLink(dealId);
      setNote({ ok: true, text: "🔗 Connect-Bank link copied — text it; they verify revenue in ~60s." });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Could not create a Connect-Bank link." });
    } finally {
      setMinting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Prefer a connection attached to this deal; fall back to one on the customer
    // (a merchant may have linked before the deal was created). Active wins, else newest.
    let rows: PlaidItem[] = [];
    const byDeal = await supabase
      .from("plaid_items")
      .select(PLAID_ITEM_COLUMNS)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (!byDeal.error && byDeal.data) rows = byDeal.data as unknown as PlaidItem[];

    if (rows.length === 0 && customerId) {
      const byCust = await supabase
        .from("plaid_items")
        .select(PLAID_ITEM_COLUMNS)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (!byCust.error && byCust.data) rows = byCust.data as unknown as PlaidItem[];
    }
    setItem(rows.find((r) => r.status === "active") ?? rows[0] ?? null);
    setLoading(false);
  }, [dealId, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pullNow = async () => {
    if (!item) return;
    setPulling(true);
    setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-pull", {
        body: { item_id: item.item_id },
      });
      if (error) throw error;
      const d = data as {
        ok?: boolean;
        error?: string;
        accounts?: unknown;
        transactions?: unknown;
        statements?: unknown;
        statements_available?: boolean;
        notes?: unknown;
      } | null;
      if (d?.error) throw new Error(d.error);
      const accounts = Number(d?.accounts) || 0;
      const transactions = Number(d?.transactions) || 0;
      const statements = Number(d?.statements) || 0;
      const stmtNote =
        d?.statements_available === false
          ? " · statements not available for this bank"
          : "";
      const extra = typeof d?.notes === "string" && d.notes ? ` — ${d.notes}` : "";
      setNote({
        ok: true,
        text: `Pulled ${accounts} account${accounts === 1 ? "" : "s"} · ${transactions.toLocaleString()} transactions · ${statements} statement${statements === 1 ? "" : "s"}${stmtNote}${extra}`,
      });
      await load();
    } catch (e) {
      const { message } = await parseEdgeError(e, "Could not pull from the bank right now.");
      setNote({ ok: false, text: message });
    } finally {
      setPulling(false);
    }
  };

  const accountsCount = Array.isArray(item?.accounts) ? item!.accounts.length : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <BanknotesIcon className="w-5 h-5 text-emerald-500" />
        Bank connection (Plaid)
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Checking…
        </div>
      ) : !item ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4 text-sm text-gray-500 dark:text-gray-400 space-y-3">
          <div className="flex items-start gap-3">
            <BuildingLibraryIcon className="w-6 h-6 text-gray-400 flex-shrink-0" />
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">No bank connected yet.</span>{" "}
              Copy the Connect-Bank link and text it to the merchant — a 60-second link that verifies
              their revenue (no statements to chase).
            </span>
          </div>
          <button
            type="button"
            onClick={copyConnectLink}
            disabled={minting}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Mint a secure Connect-Bank link and copy it — text it to the merchant so they connect their bank in ~60 seconds"
          >
            <BanknotesIcon className="w-4 h-4" />
            {minting ? "Creating link…" : "🔗 Copy connect link"}
          </button>
          {note && (
            <p
              className={`text-xs rounded-md px-2 py-1.5 border ${
                note.ok
                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                  : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-white min-w-0">
              <BuildingLibraryIcon className="w-5 h-5 text-ocean-blue flex-shrink-0" />
              <span className="truncate">{item.institution_name || "Bank connected"}</span>
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${STATUS_CHIP[item.status].cls}`}>
              {STATUS_CHIP[item.status].label}
            </span>
          </div>

          {item.status === "error" && item.error_message && (
            <p className="text-xs text-red-600 dark:text-red-400">{item.error_message}</p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Last pull</span>
              <span className="text-gray-900 dark:text-white">
                {item.last_pull_at ? new Date(item.last_pull_at).toLocaleString() : "never"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Environment</span>
              <span className="text-gray-900 dark:text-white">{item.environment || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Transactions</span>
              <span className="text-gray-900 dark:text-white">
                {(item.transactions_count ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Statements</span>
              <span className="text-gray-900 dark:text-white">{item.statements_count ?? 0}</span>
            </div>
            {accountsCount != null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Accounts</span>
                <span className="text-gray-900 dark:text-white">{accountsCount}</span>
              </div>
            )}
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={pullNow}
              disabled={pulling}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-ocean-blue border border-ocean-blue/50 rounded-lg hover:bg-ocean-blue/5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Re-pull transactions and statements from the merchant's bank now"
            >
              <ArrowPathIcon className={`w-4 h-4 ${pulling ? "animate-spin" : ""}`} />
              {pulling ? "Pulling…" : "Pull now"}
            </button>
          </div>

          {note && (
            <p
              className={`text-xs rounded-md px-2 py-1.5 border ${
                note.ok
                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                  : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
