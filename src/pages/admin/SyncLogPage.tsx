import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowsRightLeftIcon, ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { syncDealToGHL } from "../../services/ghlService";

interface WebhookEvent {
  id: string;
  event_type: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  outcome: string;
  detail: string | null;
  created_at: string;
}

// A lead/deal that was created but never reached GHL (ghl_contact_id IS NULL).
interface UnsyncedDeal {
  id: string;
  deal_number: string | null;
  deal_type: string;
  status: string;
  lead_source: string | null;
  created_at: string;
  customer: { first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null } | null;
}

const TERMINAL = ["funded", "declined", "dead", "nurture", "restructure_executed", "servicing"];

function NeedsSyncPanel() {
  const [rows, setRows] = useState<UnsyncedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    // Deals created but never linked to GHL, still active (worth recovering).
    const { data } = await supabase
      .from("deals")
      .select("id, deal_number, deal_type, status, lead_source, created_at, customer:customers!customer_id(first_name,last_name,business_name,email,phone)")
      .is("ghl_contact_id", null)
      .not("status", "in", `(${TERMINAL.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data || []) as unknown as UnsyncedDeal[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function retry(id: string) {
    setBusy(id); setMsg(null);
    try {
      const res = await syncDealToGHL(id);
      if (res.ok && res.ghl_contact_id) {
        setMsg({ id, ok: true, text: "Synced ✓" });
        setRows((r) => r.filter((d) => d.id !== id)); // it's fixed — drop it from the list
      } else {
        setMsg({ id, ok: false, text: res.error || res.warning || "Still failed — check GHL config" });
      }
    } catch (e) {
      setMsg({ id, ok: false, text: e instanceof Error ? e.message : "Retry failed" });
    }
    setBusy(null);
  }

  const name = (d: UnsyncedDeal) =>
    d.customer?.business_name || [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") || d.deal_number || "Lead";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className={`w-5 h-5 ${rows.length ? "text-amber-500" : "text-emerald-500"}`} />
          <h2 className="font-bold text-gray-900 dark:text-white">Leads not synced to GHL</h2>
          {rows.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{rows.length}</span>
          )}
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline">
          <ArrowPathIcon className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 p-6">Checking for unsynced leads…</p>
      ) : rows.length === 0 ? (
        <div className="p-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircleIcon className="w-5 h-5" /> Every active lead is in GHL. Nothing to reconcile.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Lead</th><th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Type / Stage</th><th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Created</th><th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-2.5 px-4">
                    <Link to={`/admin/deals/${d.id}`} className="text-gray-900 dark:text-white hover:text-ocean-blue font-medium">{name(d)}</Link>
                    <span className="block text-xs text-gray-400">{d.deal_number}</span>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-gray-500">{[d.customer?.email, d.customer?.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2.5 px-4 text-xs"><span className="uppercase">{d.deal_type}</span> · {d.status}</td>
                  <td className="py-2.5 px-4 text-xs text-gray-500">{d.lead_source || "—"}</td>
                  <td className="py-2.5 px-4 text-xs text-gray-400 whitespace-nowrap">{new Date(d.created_at).toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-right">
                    <button onClick={() => retry(d.id)} disabled={busy === d.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50">
                      {busy === d.id ? "Syncing…" : "Retry sync"}
                    </button>
                    {msg?.id === d.id && <span className={`block mt-1 text-[11px] ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  processed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  ignored: "bg-gray-100 text-gray-500 dark:bg-gray-700",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  received: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

export default function SyncLogPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("ghl_webhook_events")
      .select("id, event_type, ghl_contact_id, ghl_opportunity_id, outcome, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    setEvents((data || []) as WebhookEvent[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowsRightLeftIcon className="w-6 h-6 text-ocean-blue" /> GHL Sync Log
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Reconcile leads that didn't reach GHL, and review inbound webhook events.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline">
          <ArrowPathIcon className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Reconciliation: leads that never reached GHL, with one-click retry */}
      <NeedsSyncPanel />

      <h2 className="text-lg font-bold text-gray-900 dark:text-white pt-2">Inbound webhook events</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500">No webhook events yet. Once GHL is configured to POST here, events appear in real time.</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Time</th><th className="py-3 px-4">Event</th>
                <th className="py-3 px-4">Outcome</th><th className="py-3 px-4">Contact / Opp</th><th className="py-3 px-4">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-gray-900 dark:text-white">{e.event_type || "—"}</td>
                  <td className="py-2.5 px-4"><span className={`text-xs px-2 py-0.5 rounded-full ${OUTCOME_STYLE[e.outcome] ?? ""}`}>{e.outcome}</span></td>
                  <td className="py-2.5 px-4 text-xs text-gray-400 font-mono">{e.ghl_opportunity_id || e.ghl_contact_id || "—"}</td>
                  <td className="py-2.5 px-4 text-gray-500 max-w-xs truncate">{e.detail || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
