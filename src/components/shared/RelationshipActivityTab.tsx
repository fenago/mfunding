import { useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import InteractionTimeline from "./InteractionTimeline";
import type { ActivityEntry } from "../../hooks/useActivityLog";

/**
 * The lender/vendor Activity Log tab: the InteractionTimeline (doc-uploads, notes,
 * and the mirrored GHL conversation history) plus a "Sync now" button that fires the
 * vendor-conversation-sweep for THIS entity and refreshes the timeline inline — no
 * popups. The 15-minute cron keeps it current on its own; this is the on-demand pull.
 */
export default function RelationshipActivityTab({
  entityType,
  entityId,
  activities,
  isLoading,
  addActivity,
  onSynced,
}: {
  entityType: "lender" | "marketing_vendor";
  entityId: string | undefined;
  activities: ActivityEntry[];
  isLoading: boolean;
  addActivity: (data: { interaction_type: string; subject?: string; content: string; follow_up_date?: string; created_at?: string }) => Promise<void>;
  onSynced: () => void | Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const handleSync = async () => {
    if (!entityId || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("vendor-conversation-sweep", {
        body: { entity_type: entityType, entity_id: entityId },
      });
      if (error) throw error;
      const synced = (data as { synced?: number; note?: string } | null)?.synced ?? 0;
      const note = (data as { note?: string } | null)?.note;
      setSyncMsg(note ? note : synced > 0 ? `Synced ${synced} new message${synced === 1 ? "" : "s"} from GHL.` : "Up to date — no new messages.");
      await onSynced();
    } catch (e) {
      setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Activity Log</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Notes, documents, and the full GHL/VibeReach conversation history in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-xs text-gray-500 dark:text-gray-400">{syncMsg}</span>}
          <button
            onClick={handleSync}
            disabled={syncing || !entityId}
            className="flex items-center gap-1.5 text-sm text-ocean-blue hover:text-ocean-blue/80 disabled:opacity-50 font-medium"
            title="Pull new GHL conversation messages into this timeline"
          >
            <ArrowPathIcon className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
      <InteractionTimeline
        interactions={activities}
        onAddInteraction={addActivity}
        showAddForm={true}
        isLoading={isLoading}
      />
    </div>
  );
}
