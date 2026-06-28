import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cog6ToothIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { getBranding, saveBranding, DEFAULT_BRANDING, type Branding } from "../../services/platformService";
import {
  getActiveScorecard, saveScorecard, DEFAULT_SCORECARD, type ScorecardConfig,
} from "../../services/underwritingService";
import { MCA_PIPELINE, VCF_PIPELINE } from "../../data/pipelines";

const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6";

// Scorecard fields grouped for the editor.
const SCORECARD_GROUPS: { title: string; fields: { key: keyof ScorecardConfig; label: string }[] }[] = [
  { title: "NSFs", fields: [{ key: "nsf_per", label: "Deduct per NSF" }, { key: "nsf_max", label: "Max deduct" }, { key: "nsf_flag_at", label: "Flag at" }] },
  { title: "Negative days", fields: [{ key: "neg_per", label: "Deduct per day" }, { key: "neg_max", label: "Max deduct" }, { key: "neg_flag_at", label: "Flag at" }] },
  { title: "MCA positions", fields: [{ key: "pos_per", label: "Deduct per position" }, { key: "pos_max", label: "Max deduct" }, { key: "pos_flag_at", label: "Flag at" }] },
  { title: "Avg daily balance", fields: [{ key: "adb_low1", label: "Tier-1 threshold $" }, { key: "adb_low1_deduct", label: "Tier-1 deduct" }, { key: "adb_low2", label: "Tier-2 threshold $" }, { key: "adb_low2_deduct", label: "Tier-2 deduct" }] },
  { title: "Revenue", fields: [{ key: "rev_min", label: "Min monthly $" }, { key: "rev_deduct", label: "Deduct" }] },
  { title: "Time in business", fields: [{ key: "tib_min", label: "Min months" }, { key: "tib_deduct", label: "Deduct" }, { key: "tib_flag_at", label: "Flag under (months)" }] },
  { title: "Credit", fields: [{ key: "credit_min", label: "Min score" }, { key: "credit_deduct", label: "Deduct" }] },
  { title: "Recommendation cutoffs", fields: [{ key: "approve_at", label: "Approve at ≥" }, { key: "review_at", label: "Review at ≥" }] },
];

export default function PlatformConfigPage() {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [scorecard, setScorecard] = useState<ScorecardConfig>(DEFAULT_SCORECARD);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBranding().then(setBranding).catch(() => {});
    getActiveScorecard().then(setScorecard).catch(() => {});
  }, []);

  function flash(m: string) { setSavedMsg(m); setTimeout(() => setSavedMsg(null), 2500); }

  async function persistBranding() {
    setBusy(true);
    try { await saveBranding(branding); flash("Branding saved"); } finally { setBusy(false); }
  }
  async function persistScorecard() {
    setBusy(true);
    try { await saveScorecard(scorecard); flash("Scorecard saved"); } finally { setBusy(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Cog6ToothIcon className="w-6 h-6 text-ocean-blue" /> Platform Config
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">White-label branding, underwriting scorecard weights, and pipeline reference.</p>
        </div>
        {savedMsg && <span className="text-sm text-emerald-600 inline-flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" /> {savedMsg}</span>}
      </div>

      {/* Branding */}
      <div className={card}>
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">White-label branding</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm"><span className="text-gray-500">Company name</span>
            <input value={branding.company_name} onChange={(e) => setBranding({ ...branding, company_name: e.target.value })} className={input} /></label>
          <label className="text-sm"><span className="text-gray-500">Tagline</span>
            <input value={branding.tagline} onChange={(e) => setBranding({ ...branding, tagline: e.target.value })} className={input} /></label>
          <label className="text-sm"><span className="text-gray-500">Support email</span>
            <input value={branding.support_email} onChange={(e) => setBranding({ ...branding, support_email: e.target.value })} className={input} /></label>
          <label className="text-sm"><span className="text-gray-500">Logo URL</span>
            <input value={branding.logo_url} onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })} className={input} /></label>
          <label className="text-sm"><span className="text-gray-500">Primary color</span>
            <input type="color" value={branding.primary_color} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600" /></label>
          <label className="text-sm"><span className="text-gray-500">Accent color</span>
            <input type="color" value={branding.accent_color} onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600" /></label>
        </div>
        <button onClick={persistBranding} disabled={busy} className="btn-primary text-sm mt-4 disabled:opacity-60">Save branding</button>
      </div>

      {/* Scorecard weights */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900 dark:text-white">Underwriting scorecard</h2>
          <button onClick={() => setScorecard(DEFAULT_SCORECARD)} className="text-xs text-gray-400 hover:underline">Reset to defaults</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Each deal starts at 100; these deductions/thresholds drive the Approve / Review / Decline recommendation.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          {SCORECARD_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">{g.title}</p>
              <div className="space-y-2">
                {g.fields.map((f) => (
                  <label key={f.key} className="text-xs block">
                    <span className="text-gray-500">{f.label}</span>
                    <input type="number" value={scorecard[f.key]}
                      onChange={(e) => setScorecard({ ...scorecard, [f.key]: Number(e.target.value) })}
                      className={input} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={persistScorecard} disabled={busy} className="btn-primary text-sm mt-4 disabled:opacity-60">Save scorecard</button>
      </div>

      {/* Pipeline reference (read-only) */}
      <div className={card}>
        <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Pipeline reference</h2>
        <p className="text-xs text-gray-500 mb-4">Stage definitions are code-managed and mirrored to the GHL pipelines (read-only here).</p>
        <div className="grid sm:grid-cols-2 gap-6">
          {[{ title: "MCA Pipeline", p: MCA_PIPELINE }, { title: "VCF Pipeline", p: VCF_PIPELINE }].map(({ title, p }) => (
            <div key={title}>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{title}</p>
              <ol className="space-y-1">
                {p.stages.map((s, i) => (
                  <li key={s.key} className="text-sm text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400 mr-2">{i + 1}.</span>{s.label}
                    <span className="ml-2 text-xs text-gray-400 font-mono">{s.key}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {/* API keys pointer */}
      <div className={card}>
        <h2 className="font-semibold text-gray-900 dark:text-white mb-1">API keys & integrations</h2>
        <p className="text-sm text-gray-500">
          Integration credentials (GHL, Plaid, Google, Stripe) live in the Supabase vault / environment — never edited from the browser.
          Manage connection status on the <Link to="/admin/settings/integrations" className="text-ocean-blue hover:underline">Integrations</Link> page.
        </p>
      </div>
    </div>
  );
}
