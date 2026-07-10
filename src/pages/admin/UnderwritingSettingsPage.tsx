import { useEffect, useState } from "react";
import { AdjustmentsHorizontalIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  getUnderwritingSettings, saveUnderwritingSettings,
  type UnderwritingSettings,
} from "../../services/aiUnderwritingService";

// Human labels for padding categories — "which deposit types count as padding."
const PADDING_LABELS: Record<string, string> = {
  zelle: "Zelle / P2P",
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal_personal: "PayPal (personal)",
  internal_transfer: "Internal transfers",
  owner_deposit: "Owner deposits / ATM cash",
  reversal: "Refunds / reversals",
  round_number: "Round-number deposits",
  same_day_in_out: "Same-day in / out",
};

// Number knobs shown as inputs.
const NUMBER_FIELDS: { key: keyof UnderwritingSettings; label: string; help: string; suffix?: string }[] = [
  { key: "revenue_quality_flag_pct", label: "Revenue-quality flag", help: "Flag when real revenue falls below this % of reported.", suffix: "%" },
  { key: "holdback_ceiling_pct", label: "Holdback ceiling", help: "Max % of daily revenue a new advance may debit.", suffix: "%" },
  { key: "debt_service_flag_pct", label: "Debt-service flag", help: "Flag when existing debt service exceeds this % of revenue.", suffix: "%" },
  { key: "nsf_monthly_cap", label: "NSF monthly cap", help: "Flag when average monthly NSF count exceeds this." },
  { key: "negative_days_flag", label: "Negative-days flag", help: "Flag when negative-balance days exceed this per statement." },
  { key: "min_avg_daily_balance", label: "Min avg daily balance", help: "Flag when average daily balance drops below this.", suffix: "$" },
];

// Affordability knobs — the deterministic daily-vs-weekly sizing model.
const AFFORDABILITY_FIELDS: { key: keyof UnderwritingSettings; label: string; help: string; suffix?: string; step?: string }[] = [
  { key: "max_payment_pct_of_revenue", label: "Max payment % of revenue", help: "Total debt service (existing + new advance) may not exceed this % of true monthly revenue. Industry 8–15%.", suffix: "%" },
  { key: "balance_buffer_pct", label: "Balance buffer %", help: "The new payment may not exceed this % of the worst month's average daily balance — a thin-balance guard on top of the revenue cap.", suffix: "%" },
  { key: "affordability_factor_rate", label: "Assumed factor rate", help: "Factor used to convert a sustainable payment into an advance size (advance = payment × term ÷ factor).", suffix: "×", step: "0.01" },
  { key: "term_daily_biz_days", label: "Daily term (business days)", help: "Assumed number of business-day debits on a DAILY remittance structure.", suffix: "days" },
  { key: "term_weekly_weeks", label: "Weekly term (weeks)", help: "Assumed number of weekly debits on a WEEKLY remittance structure.", suffix: "wks" },
];

// One number knob. "$" renders as a left prefix; any other suffix renders on the
// right (%, ×, days, wks).
function NumberField({
  field, value, onChange,
}: {
  field: { key: keyof UnderwritingSettings; label: string; help: string; suffix?: string; step?: string };
  value: number | null;
  onChange: (raw: string) => void;
}) {
  const dollar = field.suffix === "$";
  const rightSuffix = field.suffix && !dollar ? field.suffix : null;
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{field.label}</label>
      <div className="relative">
        {dollar && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>}
        <input
          type="number"
          step={field.step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={`input-field w-full ${dollar ? "pl-7" : ""} ${rightSuffix ? "pr-12" : ""}`}
        />
        {rightSuffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{rightSuffix}</span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{field.help}</p>
    </div>
  );
}

export default function UnderwritingSettingsPage() {
  const [settings, setSettings] = useState<UnderwritingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUnderwritingSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  function patch(p: Partial<UnderwritingSettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
  }

  function togglePadding(cat: string) {
    if (!settings) return;
    patch({ padding_categories: { ...settings.padding_categories, [cat]: !settings.padding_categories[cat] } });
  }

  function setNumber(key: keyof UnderwritingSettings, raw: string) {
    patch({ [key]: raw === "" ? null : Number(raw) } as Partial<UnderwritingSettings>);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const { id, updated_at: _u, updated_by: _b, ...rest } = settings;
      void _u; void _b;
      const updated = await saveUnderwritingSettings(id, rest);
      setSettings(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">No underwriting settings row found</p>
            <p className="text-sm text-amber-700 dark:text-amber-300">{error ?? "The singleton underwriting_settings row could not be loaded."}</p>
          </div>
        </div>
      </div>
    );
  }

  const paddingKeys = Object.keys(settings.padding_categories ?? {});

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <AdjustmentsHorizontalIcon className="w-6 h-6 text-ocean-blue" /> Underwriting Settings
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          The knobs the AI underwriter uses when reading bank statements — which deposits count as
          revenue padding, and the thresholds that raise flags.
        </p>
      </div>

      {/* Padding categories */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Padding categories</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Deposit types treated as padding are removed from reported revenue to compute true revenue.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {paddingKeys.map((cat) => (
            <label
              key={cat}
              className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <span className="text-sm text-gray-900 dark:text-white">{PADDING_LABELS[cat] ?? cat.replace(/_/g, " ")}</span>
              <input
                type="checkbox"
                checked={!!settings.padding_categories[cat]}
                onChange={() => togglePadding(cat)}
                className="toggle toggle-primary toggle-sm"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Flag thresholds</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {NUMBER_FIELDS.map((f) => (
            <NumberField key={String(f.key)} field={f} value={settings[f.key] as number | null} onChange={(raw) => setNumber(f.key, raw)} />
          ))}
        </div>
      </div>

      {/* Affordability model */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Affordability model</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          How much a merchant can afford — the max sustainable daily vs weekly payment, converted to an
          advance size. The payment cap and balance buffer bound the payment; the factor and term size the advance.
        </p>
        <div className="grid sm:grid-cols-2 gap-5">
          {AFFORDABILITY_FIELDS.map((f) => (
            <NumberField key={String(f.key)} field={f} value={settings[f.key] as number | null} onChange={(raw) => setNumber(f.key, raw)} />
          ))}
        </div>
      </div>

      {/* Models */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Models</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Extraction model</label>
            <input
              type="text"
              value={settings.extraction_model ?? ""}
              onChange={(e) => patch({ extraction_model: e.target.value })}
              placeholder="e.g. claude-opus-4-8"
              className="input-field w-full"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Reads the PDFs and extracts per-statement figures.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Judge model</label>
            <input
              type="text"
              value={settings.judge_model ?? ""}
              onChange={(e) => patch({ judge_model: e.target.value })}
              placeholder="e.g. claude-opus-4-8"
              className="input-field w-full"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Produces the risk/affordability verdict + narrative.</p>
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="w-4 h-4" /> Saved
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <ExclamationTriangleIcon className="w-4 h-4" /> {error}
          </span>
        )}
        {settings.updated_at && (
          <span className="text-xs text-gray-400 ml-auto">
            Last updated {new Date(settings.updated_at).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
