import { useState } from "react";
import { BuildingOfficeIcon, PlusIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import type { DealStatus } from "../../types/deals";

/** One business owned by the person behind the GHL contact. Shape is the
 *  `businesses[]` entry returned by the playbook-open-contact edge function
 *  (multiple_businesses / list_businesses / add_business). */
export type PlaybookBusiness = {
  customer_id: string;
  /** null when the business has no deal yet — open_business creates one. */
  deal_id?: string | null;
  business_name: string | null;
  status?: string | null;
  /** null both when there's no deal and when the money wall masks it. */
  amount_requested?: number | null;
};

const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * One owner → many businesses.
 *
 * A person can own several businesses; each one is its own customer + its own
 * deal under the SAME contact. Opening the contact used to land silently on
 * business #1 with no way to reach the others or add a new one — this card is
 * the fix. It sits at the top of the Revenue Playbook whenever we know which
 * contact we're working:
 *   • 2+ businesses → pick which one to work (nothing auto-opens).
 *   • 1 business    → slim bar; the point of it is "+ Add a business", which is
 *                     exactly the moment the owner wants a second one.
 *
 * Presentational only — the page owns the edge-function calls and the deal load.
 */
export default function BusinessPicker({
  businesses,
  activeCustomerId,
  ownerLabel,
  listState,
  listError,
  onRetryList,
  onOpen,
  onAdd,
  busyCustomerId,
}: {
  businesses: PlaybookBusiness[];
  /** The business currently loaded in the playbook (highlighted, not clickable). */
  activeCustomerId: string | null;
  /** The person — "Maria Ortiz" / their phone. Shown as the card's subject. */
  ownerLabel: string;
  listState: "idle" | "loading" | "error";
  listError?: string | null;
  onRetryList: () => void;
  onOpen: (customerId: string) => void;
  /** Resolves once the new business is created AND loaded; rejects with a real
   *  error message, which this card shows inline (never a silent no-op). */
  onAdd: (businessName: string) => Promise<void>;
  /** customer_id currently being opened — that row shows a spinner. */
  busyCustomerId: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const many = businesses.length > 1;

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAdd(trimmed);
      setName("");
      setAddOpen(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add that business.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BuildingOfficeIcon className="w-5 h-5 text-ocean-blue shrink-0" />
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {many ? `${businesses.length} businesses` : "This owner's business"}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">· {ownerLabel}</span>
        {listState === "loading" && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="loading loading-spinner loading-xs" /> checking…
          </span>
        )}
        <button
          type="button"
          onClick={() => { setAddOpen((o) => !o); setAddError(null); }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-mint-green px-3 py-1.5 text-xs font-bold text-midnight-blue hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-mint-green/50"
        >
          <PlusIcon className="w-4 h-4" />
          {addOpen ? "Cancel" : "Add a business"}
        </button>
      </div>

      {many && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Same person, separate businesses — <b>pick the one you're working</b>. Each has its own deal.
        </p>
      )}

      {listState === "error" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
          <span>Couldn't check this owner's other businesses{listError ? ` — ${listError}` : "."}</span>
          <button type="button" onClick={onRetryList} className="ml-auto font-semibold underline">
            retry
          </button>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {businesses.map((b) => {
          const cfg = b.status ? DEAL_STATUS_CONFIG[b.status as DealStatus] : undefined;
          const on = b.customer_id === activeCustomerId;
          const busy = b.customer_id === busyCustomerId;
          return (
            <li key={b.customer_id}>
              <button
                type="button"
                disabled={on || busy}
                onClick={() => onOpen(b.customer_id)}
                className={`w-full flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left transition-shadow ${
                  on
                    ? "border-ocean-blue ring-2 ring-ocean-blue/30 bg-white dark:bg-gray-800 cursor-default"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-md"
                }`}
              >
                <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {b.business_name || "Unnamed business"}
                </span>
                {cfg ? (
                  <span className={`text-[11px] shrink-0 px-2 py-0.5 rounded-full ${cfg.bgColor} ${cfg.color}`}>
                    {cfg.label}
                  </span>
                ) : (
                  <span className="text-[11px] shrink-0 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    no deal yet
                  </span>
                )}
                {typeof b.amount_requested === "number" && b.amount_requested > 0 && (
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                    {money0(b.amount_requested)}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs font-semibold">
                  {busy ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : on ? (
                    <span className="text-ocean-blue">working this one</span>
                  ) : (
                    <span className="text-ocean-blue">{b.deal_id ? "open →" : "start it →"}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {addOpen && (
        <form onSubmit={submitAdd} className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
            New business name
          </label>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Same owner — the phone and email carry over. Opens straight into the playbook so you can work it now.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ortiz Landscaping LLC"
              className="flex-1 min-w-[12rem] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue/40"
            />
            <button
              type="submit"
              disabled={!name.trim() || adding}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ocean-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {adding && <span className="loading loading-spinner loading-xs" />}
              {adding ? "Adding…" : "Add it and open it"}
            </button>
          </div>
          {addError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
              <span>⚠</span>
              <span>{addError}</span>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
