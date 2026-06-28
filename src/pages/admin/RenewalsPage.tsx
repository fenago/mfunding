import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, ArrowUpCircleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import {
  getRenewalCandidates, updateDealPaydown, reachedMilestone,
  type RenewalCandidate,
} from "../../services/renewalService";
import { pushDealPaydownToGHL } from "../../services/ghlService";

function milestoneLabel(m: number | null): string {
  if (m === 100) return "Paid off — renew now";
  if (m === 75) return "75% — best terms";
  if (m === 60) return "60% — eligible";
  if (m === 40) return "40% — may qualify";
  return "In progress";
}

export default function RenewalsPage() {
  const [rows, setRows] = useState<RenewalCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushed, setPushed] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try { setRows(await getRenewalCandidates()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveAndPush(d: RenewalCandidate) {
    const raw = draft[d.id];
    const pct = raw == null ? d.paydown_percentage ?? 0 : Number(raw);
    if (Number.isNaN(pct)) return;
    setBusyId(d.id);
    try {
      await updateDealPaydown(d.id, pct);
      const res = await pushDealPaydownToGHL(d.id);
      setPushed((p) => ({ ...p, [d.id]: res.ok ? (res.pushed ? "Pushed to GHL" : (res.warning ?? "Saved")) : (res.error ?? "Save only") }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const eligible = rows.filter((r) => (r.paydown_percentage ?? 0) >= 40).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowPathIcon className="w-6 h-6 text-ocean-blue" /> Renewals
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Funded deals by paydown %. Update paydown and push to GHL to fire the renewal outreach (40/60/75/100%).
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{eligible}</div>
          <div className="text-xs text-gray-400">renewal-eligible (≥40%)</div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500">No funded deals yet. Funded deals appear here to track toward renewal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const pct = d.paydown_percentage ?? 0;
            const m = reachedMilestone(pct);
            return (
              <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <Link to={`/admin/deals/${d.id}`} className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue">
                      {d.customer?.business_name || `${d.customer?.first_name ?? ""} ${d.customer?.last_name ?? ""}`.trim() || d.deal_number || "Deal"}
                    </Link>
                    <span className="ml-2 text-xs text-gray-400">{d.deal_number}</span>
                    {d.amount_funded != null && <span className="ml-2 text-sm text-gray-500">${d.amount_funded.toLocaleString()} funded</span>}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${m ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" : "bg-gray-100 text-gray-500 dark:bg-gray-700"}`}>
                    {milestoneLabel(m)}
                  </span>
                </div>

                {/* paydown bar */}
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-3">
                  <div className="h-full bg-ocean-blue" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-500">Paydown %</label>
                  <input
                    type="number" min={0} max={100} step="any"
                    defaultValue={pct}
                    onChange={(e) => setDraft((s) => ({ ...s, [d.id]: e.target.value }))}
                    className="w-24 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
                  />
                  <button
                    onClick={() => saveAndPush(d)}
                    disabled={busyId === d.id}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-ocean-blue rounded-lg hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    <ArrowUpCircleIcon className="w-4 h-4" /> {busyId === d.id ? "Saving…" : "Save + push to GHL"}
                  </button>
                  {pushed[d.id] && (
                    <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
                      <CheckCircleIcon className="w-4 h-4" /> {pushed[d.id]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
