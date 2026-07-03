import { useEffect, useState, useCallback } from "react";
import {
  ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  getGHLStatus, getFollowUpSequences, getSyncCounts,
  type GHLStatus, type FollowUpSequenceRow, type SyncCounts,
} from "../../../services/integrationService";
import { useUserProfile } from "../../../context/UserProfileContext";
import AIProviderPanel from "./AIProviderPanel";

const WEBHOOK_URL = "https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-webhook";
const GHL_LOCATION = "t7NmVR4WCy927j4Zon4b (MFunding.net)";

const SEQ_LABELS: Record<string, string> = {
  stips_docs: "A · Stips/Docs", no_answer: "B · No Answer", soft_no: "C · Soft No",
  offer_declined: "D · Offer Declined", renewal: "E · Renewal", reactivation: "F · Reactivation",
};

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function IntegrationsPage() {
  const [status, setStatus] = useState<GHLStatus | null>(null);
  const [sequences, setSequences] = useState<FollowUpSequenceRow[]>([]);
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const { isSuperAdmin } = useUserProfile();

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, seqs, c] = await Promise.all([
      getGHLStatus(),
      getFollowUpSequences().catch(() => []),
      getSyncCounts().catch(() => null),
    ]);
    setStatus(s);
    setSequences(seqs);
    setCounts(c);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Integrations</h1>
          <p className="text-gray-500 dark:text-gray-400">GoHighLevel sync status, webhook, and follow-up sequences.</p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center gap-2">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* AI provider (super_admin only) */}
      {isSuperAdmin && <AIProviderPanel />}

      {/* GHL connection */}
      <Card title="GoHighLevel Connection"
        action={status && (
          <span className={`inline-flex items-center gap-1 text-sm font-medium ${status.connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {status.connected ? <CheckCircleIcon className="w-5 h-5" /> : <XCircleIcon className="w-5 h-5" />}
            {status.connected ? "Connected" : "Not connected"}
          </span>
        )}>
        {loading && !status ? (
          <p className="text-sm text-gray-400">Testing connection…</p>
        ) : status ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-400">Location</span><div className="text-gray-900 dark:text-gray-100">{GHL_LOCATION}</div></div>
              <div><span className="text-gray-400">Pipelines</span><div className="text-gray-900 dark:text-gray-100">{status.pipelineCount}</div></div>
            </div>
            {status.error && <p className="text-red-500">Error: {status.error}</p>}
            <div className={`flex items-start gap-2 p-3 rounded-lg ${status.hasMFundingPipeline ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-amber-50 dark:bg-amber-900/20"}`}>
              {status.hasMFundingPipeline
                ? <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0" />
                : <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0" />}
              <span className="text-gray-700 dark:text-gray-300">
                {status.hasMFundingPipeline
                  ? "The 9-stage MFunding pipeline is present — deal sync will land opportunities in the correct stage."
                  : "No pipeline with all 9 MFunding stage names found. Build the “MFunding Deal Pipeline” in GHL (see GHL_Pipeline_And_Automations.md) so deal sync maps stages correctly."}
              </span>
            </div>
            {status.pipelines.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ocean-blue">View pipelines &amp; stages</summary>
                <div className="mt-2 space-y-2">
                  {status.pipelines.map((p) => (
                    <div key={p.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                      <div className="text-gray-500 dark:text-gray-400">{p.stages.map((s) => s.name).join(" → ")}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : null}
      </Card>

      {/* Webhook */}
      <Card title="Inbound Webhook">
        <div className="space-y-2 text-sm">
          <p className="text-gray-600 dark:text-gray-300">Configure this URL in GHL (Settings → Webhooks or a workflow “Webhook” action) for Contact &amp; Opportunity events. Append the shared secret stored in the Supabase vault as <code>?secret=…</code>.</p>
          <code className="block bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-xs break-all">{WEBHOOK_URL}?secret=YOUR_GHL_WEBHOOK_SECRET</code>
          <p className="text-gray-400 text-xs">The secret lives in the vault (<code>GHL_WEBHOOK_SECRET</code>) — never hard-code it here.</p>
        </div>
      </Card>

      {/* Sync mapping */}
      <Card title="Record Mapping (Supabase ⇄ GHL)">
        {counts ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-400">Customers linked to GHL contacts</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{counts.customersLinked}<span className="text-base text-gray-400"> / {counts.customersTotal}</span></div>
            </div>
            <div>
              <div className="text-gray-400">Deals linked to GHL opportunities</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{counts.dealsLinked}<span className="text-base text-gray-400"> / {counts.dealsTotal}</span></div>
            </div>
          </div>
        ) : <p className="text-sm text-gray-400">—</p>}
      </Card>

      {/* Follow-up sequences */}
      <Card title="Follow-Up Sequence Enrollments">
        {sequences.length === 0 ? (
          <p className="text-sm text-gray-400">No enrollments yet. These populate as GHL workflows enroll contacts and sync back.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2 pr-4">Sequence</th><th className="py-2 pr-4">Entity</th>
                  <th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Step</th><th className="py-2">Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="py-2 pr-4">{SEQ_LABELS[s.sequence_key] ?? s.sequence_key}</td>
                    <td className="py-2 pr-4">{s.entity_type}</td>
                    <td className="py-2 pr-4">{s.status}</td>
                    <td className="py-2 pr-4">{s.current_step}</td>
                    <td className="py-2">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
