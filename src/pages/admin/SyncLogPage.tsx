import { useEffect, useState } from "react";
import { ArrowsRightLeftIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

interface WebhookEvent {
  id: string;
  event_type: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  outcome: string;
  detail: string | null;
  created_at: string;
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
          <p className="text-gray-500 dark:text-gray-400 mt-1">Inbound GoHighLevel webhook events (last 100). Use this to verify Gap A/B.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline">
          <ArrowPathIcon className="w-4 h-4" /> Refresh
        </button>
      </div>

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
