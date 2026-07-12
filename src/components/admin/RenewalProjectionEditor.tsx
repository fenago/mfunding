import { useState } from "react";
import { updateDeal } from "../../services/dealService";
import type { DealWithCustomer } from "../../types/deals";

interface RenewalProjectionEditorProps {
  deal: DealWithCustomer;
  onSaved: () => void;
}

/** Parse a money/number input to a number, or null when blank. */
function toNum(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Staff editor for the six renewal-projection fields on a deal. These drive the
 * merchant portal's paydown countdown and renewal timing, so they live next to
 * the deal details. Saving a changed balance auto-stamps balance_as_of = now so
 * the merchant sees an honest "As of" date. MCA-family deals only.
 */
export default function RenewalProjectionEditor({ deal, onSaved }: RenewalProjectionEditorProps) {
  const [payback, setPayback] = useState(deal.payback_amount?.toString() ?? "");
  const [remitAmount, setRemitAmount] = useState(deal.remittance_amount?.toString() ?? "");
  const [remitFreq, setRemitFreq] = useState(deal.remittance_frequency ?? "");
  const [firstRemit, setFirstRemit] = useState(deal.first_remittance_date ?? "");
  const [balance, setBalance] = useState(deal.balance_override?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const balanceAsOf = fmtStamp(deal.balance_as_of);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedNote(false);
    try {
      const nextBalance = toNum(balance);
      const balanceChanged = nextBalance !== (deal.balance_override ?? null);

      await updateDeal(deal.id, {
        payback_amount: toNum(payback),
        remittance_amount: toNum(remitAmount),
        remittance_frequency: remitFreq === "daily" || remitFreq === "weekly" ? remitFreq : null,
        first_remittance_date: firstRemit || null,
        balance_override: nextBalance,
        // Auto-stamp freshness whenever the balance is edited.
        ...(balanceChanged ? { balance_as_of: new Date().toISOString() } : {}),
      });
      setSavedNote(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the renewal projection.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Renewal projection</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        These drive the merchant's paydown countdown and renewal timing in their portal.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Total payback ($)
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={payback}
            onChange={(e) => setPayback(e.target.value)}
            placeholder="e.g. 65000"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Remittance amount ($)
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={remitAmount}
            onChange={(e) => setRemitAmount(e.target.value)}
            placeholder="e.g. 650"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Remittance frequency
          </span>
          <select value={remitFreq} onChange={(e) => setRemitFreq(e.target.value)} className={inputCls}>
            <option value="">Not set</option>
            <option value="daily">Daily (business days)</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            First remittance date
          </span>
          <input
            type="date"
            value={firstRemit}
            onChange={(e) => setFirstRemit(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Current balance override ($)
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="Leave blank to let the estimate drive paydown"
            className={inputCls}
          />
          {balanceAsOf && (
            <span className="block text-xs text-gray-400 mt-1">As of {balanceAsOf}</span>
          )}
        </label>
      </div>

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      {savedNote && !error && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-3">Saved.</p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save projection"}
        </button>
      </div>
    </div>
  );
}
