// Funder Availability checklist — for the loaded merchant, shows each LIVE MCA
// funder as ✅ READY to submit or ⚠️ NEEDS: [missing docs], computed from the
// structured doc requirements on lender_programs vs the docs on the merchant's
// file. This is the "which lenders can I submit this merchant to right now?"
// visibility panel; it does NOT gate anything — FunderPicker keeps its own hard
// gate. Rendered on the doc-collection + funder-submission playbook steps.
import { useEffect, useState } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import { getFunderDocReadiness, type FunderReadiness } from "../../services/funderAvailability";
import type { DealWithCustomer } from "../../types/deals";

export default function FunderAvailabilityChecklist({ deal }: { deal: DealWithCustomer }) {
  const [rows, setRows] = useState<FunderReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await getFunderDocReadiness(deal);
        if (!cancelled) setRows(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to check funder availability");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deal.id, deal.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const readyCount = rows.filter((r) => r.ready).length;

  return (
    <details className="mt-4 rounded-lg border border-emerald-300/50 dark:border-emerald-800/60 bg-white dark:bg-gray-800" open>
      <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2 flex-wrap">
        <ClipboardDocumentCheckIcon className="w-4 h-4 text-emerald-600" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Funder availability</span>
        {loading ? (
          <span className="text-[11px] text-gray-400">checking…</span>
        ) : rows.length > 0 ? (
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {readyCount} of {rows.length} funder{rows.length === 1 ? "" : "s"} ready to submit
          </span>
        ) : null}
        <span className="text-[11px] text-gray-400">who can I submit this merchant to right now?</span>
      </summary>

      <div className="px-3 pb-3 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-400">Checking each live funder's doc requirements…</p>
        ) : error ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
            <ExclamationTriangleIcon className="w-4 h-4" /> {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            No live MCA funders with structured doc requirements yet. Set them in Admin → Funder Matrix.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li
                  key={r.lenderId}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    r.ready
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15"
                      : "border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15"
                  }`}
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    {r.ready ? (
                      <CheckCircleIcon className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-white">{r.name}</span>
                        {r.ready ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            ready
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-700 dark:text-amber-300">
                            Needs: {r.missing.join(", ")}
                          </span>
                        )}
                      </span>
                      {r.advisories.length > 0 && (
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          May also need: {r.advisories.join("; ")}
                        </span>
                      )}
                      {r.conditions && (
                        <span className="block text-[11px] text-gray-400 mt-0.5">Conditions: {r.conditions}</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-gray-400">
              Advisory only — voided check and conditional/if-applicable docs never block a funder here. Submit still
              runs its own hard gate.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
