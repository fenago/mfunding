// Funder Availability checklist — for the loaded merchant, shows each LIVE MCA
// funder as ✅ READY to submit or ⚠️ NEEDS: [missing docs], computed from the
// structured doc requirements on lender_programs vs the docs on the merchant's
// file. This is the "which lenders can I submit this merchant to right now?"
// visibility panel; it does NOT gate anything — FunderPicker keeps its own hard
// gate. Rendered on the doc-collection + funder-submission playbook steps.
//
// Presentation is a SCOREBOARD, not a wall of amber boxes: a one-line summary,
// ready funders as compact green rows, and the funders still waiting collapsed
// behind a toggle — each one row of missing-doc chips, with the long
// "may also need / conditions" prose tucked behind a per-funder ⓘ.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon,
  ArrowUpTrayIcon,
  TableCellsIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { getFunderDocReadiness, type FunderReadiness } from "../../services/funderAvailability";
import type { DealWithCustomer } from "../../types/deals";

// "Bank statements (3mo)" is long for a chip — trim the noun to "Bank stmts".
const shortMissing = (m: string) => m.replace(/^Bank statements/, "Bank stmts");
// Strip the "(3mo)" qualifier so the same doc counts as one across funders.
const baseMissing = (m: string) => m.replace(/\s*\(.*\)$/, "").trim();

export default function FunderAvailabilityChecklist({ deal }: { deal: DealWithCustomer }) {
  const [rows, setRows] = useState<FunderReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWaiting, setShowWaiting] = useState(false);
  // Which waiting funders have their "may also need / conditions" prose open.
  const [infoOpen, setInfoOpen] = useState<Set<string>>(new Set());

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
    // doc_checklist is the source of truth for availability — recompute when the
    // closer ticks a box (parent mirrors the change into the deal).
  }, [deal.id, deal.customer_id, JSON.stringify(deal.doc_checklist)]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = rows.filter((r) => r.ready);
  const waiting = rows.filter((r) => !r.ready);
  const readyCount = ready.length;
  const waitingCount = waiting.length;

  // The single most-common missing doc across the waiting funders, for the
  // summary line's "mostly Bank statements" nudge.
  let topMissing: string | null = null;
  if (waitingCount > 0) {
    const counts = new Map<string, number>();
    for (const r of waiting) for (const m of r.missing) {
      const base = baseMissing(m);
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    let top = 0;
    for (const [doc, n] of counts) if (n > top) { top = n; topMissing = doc; }
  }

  const toggleInfo = (id: string) =>
    setInfoOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <details className="mt-4 rounded-lg border border-emerald-300/50 dark:border-emerald-800/60 bg-white dark:bg-gray-800" open>
      <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2 flex-wrap">
        <ClipboardDocumentCheckIcon className="w-4 h-4 text-emerald-600" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Funder availability</span>
        {loading ? (
          <span className="text-[11px] text-gray-400">checking…</span>
        ) : rows.length > 0 ? (
          <span className="text-[11px] font-medium inline-flex items-center gap-1.5">
            <span className="text-emerald-700 dark:text-emerald-300">✅ {readyCount} ready</span>
            {waitingCount > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-px">
                ⚠ {waitingCount} waiting
              </span>
            )}
          </span>
        ) : null}
        <span className="text-[11px] text-gray-400">who can I submit this merchant to right now?</span>
        <Link
          to="/admin/funder-matrix"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[11px] font-medium text-ocean-blue hover:underline inline-flex items-center gap-1"
          title="Open the full Funder Approval Matrix (criteria + doc requirements) to reference"
        >
          <TableCellsIcon className="w-3.5 h-3.5" /> Funder matrix
        </Link>
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
            {/* Scoreboard summary — always the first thing you read */}
            <p className="text-[12px] text-gray-700 dark:text-gray-200">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">✅ {readyCount} ready to submit</span>
              {waitingCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-amber-700 dark:text-amber-300">⚠ {waitingCount} waiting on docs</span>
                  {topMissing && <span className="text-gray-500 dark:text-gray-400"> — mostly {topMissing}</span>}
                </>
              )}
            </p>

            {/* Ready funders — compact green rows, listed first */}
            {ready.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {ready.map((r) => (
                  <li
                    key={r.lenderId}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 px-2 py-1 text-[12px] text-gray-900 dark:text-white"
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span className="font-medium">{r.name}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Waiting funders — collapsed by default */}
            {waiting.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowWaiting((v) => !v)}
                  className="text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white inline-flex items-center gap-1"
                >
                  Show what each funder still needs ({waitingCount}) <span className="text-gray-400">{showWaiting ? "▴" : "▾"}</span>
                </button>
                {showWaiting && (
                  <ul className="mt-1.5 space-y-1">
                    {waiting.map((r) => {
                      const hasMore = r.advisories.length > 0 || !!r.conditions;
                      const open = infoOpen.has(r.lenderId);
                      return (
                        <li key={r.lenderId} className="rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                            <span className="font-medium text-gray-900 dark:text-white">{r.name}</span>
                            {r.missing.map((m, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center rounded border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 px-1.5 py-px text-[11px]"
                              >
                                {shortMissing(m)}
                              </span>
                            ))}
                            <Link
                              to={`/admin/customers/${deal.customer_id}#documents`}
                              className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-0.5"
                              title="Upload the missing document(s) for this merchant"
                            >
                              <ArrowUpTrayIcon className="w-3 h-3" /> upload
                            </Link>
                            {hasMore && (
                              <button
                                type="button"
                                onClick={() => toggleInfo(r.lenderId)}
                                title="May also need / conditions"
                                className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 inline-flex items-center"
                              >
                                <InformationCircleIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {hasMore && open && (
                            <div className="mt-1 pl-0.5 space-y-0.5">
                              {r.advisories.length > 0 && (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">May also need: {r.advisories.join("; ")}</p>
                              )}
                              {r.conditions && (
                                <p className="text-[11px] text-gray-400">Conditions: {r.conditions}</p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <p className="text-[10px] text-gray-400">
              Advisory only — voided check &amp; conditional docs never block; Submit runs its own hard gate.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
