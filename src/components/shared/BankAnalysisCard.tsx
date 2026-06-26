import { useEffect, useState } from "react";
import { BanknotesIcon, ExclamationTriangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { PLAID_ENABLED } from "../../config";
import {
  getBankAnalysisForDeal, createBankAnalysis, updateBankAnalysis, prequalFlags,
  type BankAnalysis, type BankAnalysisInput,
} from "../../services/bankAnalysisService";

interface Props {
  dealId: string;
  customerId: string | null;
}

const FIELDS: { key: keyof BankAnalysisInput; label: string; step?: string }[] = [
  { key: "months_analyzed", label: "Months analyzed" },
  { key: "average_daily_balance", label: "Average daily balance ($)" },
  { key: "avg_monthly_deposits", label: "Avg monthly deposits ($)" },
  { key: "avg_monthly_revenue", label: "Avg monthly revenue ($)" },
  { key: "deposit_count", label: "Deposit count / mo" },
  { key: "nsf_count", label: "NSF count" },
  { key: "negative_days", label: "Negative days" },
  { key: "existing_mca_positions", label: "Existing MCA positions" },
  { key: "existing_mca_payments", label: "Existing MCA debits ($/day or wk)" },
  { key: "largest_deposit", label: "Largest single deposit ($)" },
];

/**
 * Bank analysis card — the MANUAL bank-metrics entry (default path). Plaid is
 * optional; when PLAID_ENABLED is false we only show manual entry. Stores into
 * `bank_analyses`, the single source the underwriting workbench reads.
 */
export default function BankAnalysisCard({ dealId, customerId }: Props) {
  const [existing, setExisting] = useState<BankAnalysis | null>(null);
  const [form, setForm] = useState<BankAnalysisInput>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBankAnalysisForDeal(dealId)
      .then((a) => { setExisting(a); if (a) setForm(a); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId]);

  function setNum(key: keyof BankAnalysisInput, value: string) {
    setForm((f) => ({ ...f, [key]: value === "" ? null : Number(value) }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload: BankAnalysisInput = { ...form, deal_id: dealId, customer_id: customerId, source: "manual" };
      const saved = existing ? await updateBankAnalysis(existing.id, payload) : await createBankAnalysis(payload);
      setExisting(saved);
      setForm(saved);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const flags = prequalFlags(editing ? form : existing ?? {});

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <BanknotesIcon className="w-5 h-5 text-ocean-blue" /> Bank Analysis
          {existing && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{existing.source}</span>}
        </h3>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-sm text-ocean-blue hover:underline">
            {existing ? "Edit" : "Enter manually"}
          </button>
        )}
      </div>

      {!PLAID_ENABLED && (
        <p className="text-xs text-gray-400 mb-3">
          Plaid is not enabled — enter bank metrics manually from the uploaded statements. (Bank statement collection is handled by the GHL stips workflow.)
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={String(f.key)} className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">{f.label}</span>
                <input
                  type="number" step="any"
                  value={(form[f.key] as number | null | undefined) ?? ""}
                  onChange={(e) => setNum(f.key, e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-60">
              {saving ? "Saving…" : "Save analysis"}
            </button>
            <button onClick={() => { setEditing(false); if (existing) setForm(existing); }} className="text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      ) : existing ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {FIELDS.map((f) => (
              <div key={String(f.key)} className="flex justify-between">
                <span className="text-gray-400">{f.label}</span>
                <span className="text-gray-900 dark:text-gray-100 font-medium">{(existing[f.key as keyof BankAnalysis] as number | null) ?? "—"}</span>
              </div>
            ))}
          </div>
          {flags.length > 0 ? (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-amber-700 dark:text-amber-300 text-xs">Risk flags: {flags.join(" · ")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-600 text-xs">
              <CheckCircleIcon className="w-4 h-4" /> No automatic risk flags
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No bank analysis yet.</p>
      )}
    </div>
  );
}
