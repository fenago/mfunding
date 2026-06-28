import { useEffect, useState } from "react";
import { ShieldExclamationIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  listDisclosures, updateDisclosure, getDisclosureExposure,
  type Disclosure, type DisclosureExposure,
} from "../../services/complianceService";

export default function CompliancePage() {
  const [rows, setRows] = useState<Disclosure[]>([]);
  const [exposure, setExposure] = useState<DisclosureExposure[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => { listDisclosures().then(setRows).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { getDisclosureExposure().then(setExposure).catch(() => {}); }, []);

  // Alert when open deals sit in a state whose disclosure isn't finalized.
  const alerts = exposure.filter((e) => e.open_deals > 0 && !e.finalized);

  function startEdit(d: Disclosure) {
    setEditing(d.id);
    setDraft({ title: d.title, body: d.body });
  }

  async function save(d: Disclosure) {
    setSavingId(d.id);
    try {
      const updated = await updateDisclosure(d.id, draft);
      setRows((rs) => rs.map((r) => (r.id === d.id ? updated : r)));
      setEditing(null);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(d: Disclosure) {
    const updated = await updateDisclosure(d.id, { is_active: !d.is_active });
    setRows((rs) => rs.map((r) => (r.id === d.id ? updated : r)));
  }

  const needsContent = (b: string) => b.trim().startsWith("TODO");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldExclamationIcon className="w-6 h-6 text-ocean-blue" /> Compliance Disclosures
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          State-specific disclosure text. The GHL workflow + app pull the active disclosure for a merchant's state.
          Replace each <code>TODO</code> with the real legal language for that state.
        </p>
      </div>

      {/* Missing-disclosure alerts — open deals in states without finalized text */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-semibold text-amber-800 dark:text-amber-200">Disclosure gaps on open deals</h2>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
            These states have open deals but the disclosure text isn't finalized — finalize before any offer is presented.
          </p>
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <span key={a.state} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-sm">
                <strong className="text-gray-900 dark:text-white">{a.state_name}</strong>
                <span className="text-amber-700 dark:text-amber-300">{a.open_deals} open</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => (
            <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{d.state_name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{d.state} · {d.product_type}</span>
                  {needsContent(d.body) ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">needs content</span>
                  ) : (
                    <span className="text-xs inline-flex items-center gap-1 text-emerald-600"><CheckCircleIcon className="w-3.5 h-3.5" /> set</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleActive(d)} className="text-xs text-gray-500 hover:underline">
                    {d.is_active ? "Active" : "Inactive"}
                  </button>
                  {editing !== d.id && (
                    <button onClick={() => startEdit(d)} className="text-sm text-ocean-blue hover:underline">Edit</button>
                  )}
                </div>
              </div>

              {editing === d.id ? (
                <div className="space-y-2">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((s) => ({ ...s, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
                  />
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft((s) => ({ ...s, body: e.target.value }))}
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => save(d)} disabled={savingId === d.id} className="btn-primary text-sm disabled:opacity-60">
                      {savingId === d.id ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditing(null)} className="text-sm text-gray-500">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{d.title}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap line-clamp-3">{d.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
