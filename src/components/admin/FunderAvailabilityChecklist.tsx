// Funder Availability — for the loaded merchant, shows each LIVE MCA funder in
// one of three tiers so the closer submits to funders that actually FIT, not
// "anybody":
//   ✅ FITS & READY   — docs on file AND every known underwriting-box criterion
//                       passes (position, revenue, negative days, NSFs, state…).
//   🟡 OUT OF BOX     — docs fine but the merchant fails ≥1 criterion; the
//                       specific reason(s) show, and these are DEPRIORITIZED
//                       (collapsed) and NOT counted in the headline "ready".
//   ⏳ WAITING ON DOCS — a hard-required doc is still missing (unchanged).
// Box-fit needs an AI-underwriting run on the deal; without one, every funder
// falls back to docs-only and the panel nudges to run the underwriter.
//
// It does NOT gate anything — FunderPicker keeps its own hard submit gate.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon,
  ArrowUpTrayIcon,
  TableCellsIcon,
  InformationCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { getFunderAvailability, type FunderReadiness } from "../../services/funderAvailability";
import type { DealWithCustomer } from "../../types/deals";

// "Bank statements (3mo)" is long for a chip — trim the noun to "Bank stmts".
const shortMissing = (m: string) => m.replace(/^Bank statements/, "Bank stmts");
// Strip the "(3mo)" qualifier so the same doc counts as one across funders.
const baseMissing = (m: string) => m.replace(/\s*\(.*\)$/, "").trim();

export default function FunderAvailabilityChecklist({ deal }: { deal: DealWithCustomer }) {
  const [rows, setRows] = useState<FunderReadiness[]>([]);
  const [hasUnderwriting, setHasUnderwriting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOutOfBox, setShowOutOfBox] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  // Which rows have their "unchecked / conditions / advisories" detail open.
  const [infoOpen, setInfoOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await getFunderAvailability(deal);
        if (!cancelled) {
          setRows(r.rows);
          setHasUnderwriting(r.hasUnderwriting);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to check funder availability");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // doc_checklist drives doc readiness; recompute when the closer ticks a box.
  }, [deal.id, deal.customer_id, JSON.stringify(deal.doc_checklist)]); // eslint-disable-line react-hooks/exhaustive-deps

  const fits = rows.filter((r) => r.tier === "fits_ready");
  const outOfBox = rows.filter((r) => r.tier === "out_of_box");
  const waiting = rows.filter((r) => r.tier === "waiting_docs");
  const fitCount = fits.length;
  const outCount = outOfBox.length;
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
            <span className="text-emerald-700 dark:text-emerald-300">✅ {fitCount} fit &amp; ready</span>
            {outCount > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-px">
                🟡 {outCount} out of box
              </span>
            )}
            {waitingCount > 0 && (
              <span className="rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-px">
                ⏳ {waitingCount} waiting on docs
              </span>
            )}
          </span>
        ) : null}
        <span className="text-[11px] text-gray-400">who actually fits this merchant right now?</span>
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
          <p className="text-sm text-gray-400">Checking each live funder's box + doc requirements…</p>
        ) : error ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
            <ExclamationTriangleIcon className="w-4 h-4" /> {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            No live MCA funders with structured requirements yet. Set them in Admin → Funder Matrix.
          </p>
        ) : (
          <>
            {/* No underwriting run → box-fit couldn't run; nudge to run it. */}
            {!hasUnderwriting && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-900/20 px-2 py-1">
                <SparklesIcon className="w-3.5 h-3.5" /> Showing document readiness only — run the AI underwriter for fit-checking (position, revenue, negative days…).
              </p>
            )}

            {/* Scoreboard summary — always the first thing you read */}
            <p className="text-[12px] text-gray-700 dark:text-gray-200">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">✅ {fitCount} fit &amp; ready</span>
              {outCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-amber-700 dark:text-amber-300">🟡 {outCount} out of box</span>
                </>
              )}
              {waitingCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-gray-600 dark:text-gray-300">⏳ {waitingCount} waiting on docs</span>
                  {topMissing && <span className="text-gray-500 dark:text-gray-400"> — mostly {topMissing}</span>}
                </>
              )}
            </p>

            {/* FITS & READY — compact green rows, listed first */}
            {fits.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {fits.map((r) => (
                  <li
                    key={r.lenderId}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 px-2 py-1 text-[12px] text-gray-900 dark:text-white"
                    title={r.unchecked.length > 0 ? `Unchecked (no data): ${r.unchecked.join(", ")}` : undefined}
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span className="font-medium">{r.name}</span>
                    {r.unchecked.length > 0 && (
                      <span className="text-[10px] text-gray-400">· {r.unchecked.length} unchecked</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* OUT OF BOX — deprioritized, collapsed by default, with reasons */}
            {outOfBox.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOutOfBox((v) => !v)}
                  className="text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:opacity-80 inline-flex items-center gap-1"
                >
                  🟡 Out of box — why each one doesn't fit ({outCount}) <span className="text-gray-400">{showOutOfBox ? "▴" : "▾"}</span>
                </button>
                {showOutOfBox && (
                  <ul className="mt-1.5 space-y-1">
                    {outOfBox.map((r) => {
                      const hasMore = r.unchecked.length > 0 || r.advisories.length > 0 || !!r.conditions;
                      const open = infoOpen.has(r.lenderId);
                      return (
                        <li key={r.lenderId} className="rounded-md border border-amber-200/70 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10 px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                            <span className="font-medium text-gray-700 dark:text-gray-200">{r.name}</span>
                            {r.boxReasons.map((reason, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center rounded border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 px-1.5 py-px text-[11px]"
                              >
                                {reason}
                              </span>
                            ))}
                            {hasMore && (
                              <button
                                type="button"
                                onClick={() => toggleInfo(r.lenderId)}
                                title="Unchecked criteria / conditions"
                                className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 inline-flex items-center"
                              >
                                <InformationCircleIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {hasMore && open && (
                            <div className="mt-1 pl-0.5 space-y-0.5">
                              {r.unchecked.length > 0 && (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">Unchecked (no data): {r.unchecked.join(", ")}</p>
                              )}
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

            {/* WAITING ON DOCS — collapsed by default */}
            {waiting.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowWaiting((v) => !v)}
                  className="text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white inline-flex items-center gap-1"
                >
                  ⏳ Show what each funder still needs ({waitingCount}) <span className="text-gray-400">{showWaiting ? "▴" : "▾"}</span>
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
              Advisory only — out-of-box funders aren't blocked (you can still submit knowingly); voided check &amp; conditional docs never block; Submit runs its own hard gate.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
