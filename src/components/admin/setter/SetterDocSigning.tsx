import { useCallback, useEffect, useState } from "react";
import { DocumentCheckIcon, ArrowPathIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import type { DealWithCustomer } from "../../../types/deals";
import supabase from "../../../supabase";
import { groupDocs, type DocGroup, type GhlDoc } from "../../../lib/ghlDocs";
import { dateTimeET } from "../../../utils/time";

/**
 * Setter Ops — the two paperwork chips that answer "are we clear to move?":
 * has the BROKER AGREEMENT and the APPLICATION been SENT and SIGNED?
 *
 * Live e-sign status straight from GHL (ghl-docs-status), grouped so re-issued
 * copies collapse into one verdict (groupDocs). Each chip mirrors the Revenue
 * Playbook's DocsBackChips presentation:
 *   ✍️ signed (emerald) · ⏳ sent, awaiting signature (amber) · — not sent (gray)
 *
 * Unreadable ≠ empty: a FAILED fetch shows a red "couldn't read doc status" —
 * it never renders the chips as "not sent", which would be a lie about ground
 * truth. Guards on deal.ghl_contact_id (no contact = nothing to check).
 */

type DocKind = { label: string; match: (name: string) => boolean };

// The two docs a setter must clear. Name-matching mirrors DocsBackChips' short()
// classifier so the same GHL docs map to the same buckets across the app.
const DOC_KINDS: DocKind[] = [
  { label: "Broker agreement", match: (n) => /broker\s*compensation|broker\s*agreement/i.test(n) },
  { label: "Application", match: (n) => /application|04b|04c/i.test(n) },
];

function DocKindChip({ label, group }: { label: string; group: DocGroup | null }) {
  // No group at all → the document was never sent.
  if (!group) {
    return (
      <span
        title={`${label} — not sent yet`}
        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-gray-100 dark:bg-gray-700/60 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
      >
        — {label} · not sent
      </span>
    );
  }
  const { latest } = group;
  const signed = latest.signed;
  return (
    <span
      title={`${latest.name} — ${signed ? "signed" : latest.status}${latest.updatedAt ? ` · ${dateTimeET(latest.updatedAt)}` : ""}`}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
        signed
          ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
          : "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
      }`}
    >
      {signed ? "✍️" : "⏳"} {label} {signed ? "· signed ✓" : `· sent · ${latest.status}`}
    </span>
  );
}

export default function SetterDocSigning({
  deal,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const ghlContactId = deal.ghl_contact_id;
  const [groups, setGroups] = useState<DocGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ghlContactId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("ghl-docs-status", {
        body: { ghl_contact_id: ghlContactId },
      });
      if (data?.error) throw new Error(data.error);
      if (invokeError) throw invokeError;
      setGroups(groupDocs((data?.documents ?? []) as GhlDoc[]));
    } catch (e) {
      // Unreadable — do NOT fall through to "not sent". Keep any prior groups off.
      setGroups(null);
      setError(e instanceof Error ? e.message : "Could not read doc status");
    } finally {
      setLoading(false);
    }
  }, [ghlContactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <DocumentCheckIcon className="w-5 h-5 text-ocean-blue" />
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Signing status</h3>
    </div>
  );

  // No GHL contact — nothing to read (distinct from an error).
  if (!ghlContactId) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
        {header}
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No GHL contact on this deal — no e-sign status to show.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
      {header}

      {loading && groups === null && !error ? (
        <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <ArrowPathIcon className="w-4 h-4 animate-spin" /> Reading doc status…
        </p>
      ) : error ? (
        // Unreadable — loud red, and a retry. NEVER shown as "nothing sent".
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
            Couldn't read doc status
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] font-medium text-ocean-blue hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {DOC_KINDS.map((kind) => (
            <DocKindChip
              key={kind.label}
              label={kind.label}
              group={(groups ?? []).find((g) => kind.match(g.latest.name)) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
