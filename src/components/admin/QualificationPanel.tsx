import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { type LenderProgram, PROGRAM_SELECT } from "@/data/lenderPrograms";
import { matchDeal, type DealCriteria, type MatchResult } from "@/services/lenderMatch";

// The subset of a deal we can prefill the what-if form from. Everything is
// optional so we can pass whatever the deal actually has.
export interface QualificationDeal {
  amount_requested?: number | null;
  requested_amount?: number | null;
  funding_amount?: number | null;
  credit_score?: number | null;
  monthly_revenue?: number | null;
  annual_revenue?: number | null;
  time_in_business?: number | null; // months
  time_in_business_months?: number | null;
}

interface FormState {
  amount: string;
  credit_score: string;
  monthly_revenue: string;
  annual_revenue: string;
  time_in_business_months: string;
}

// Row shape returned by the embedded lender join.
interface ProgramRow extends LenderProgram {
  lender?: { id: string; company_name: string; status: string } | null;
}

function numOrEmpty(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function initialForm(deal: QualificationDeal): FormState {
  return {
    amount: numOrEmpty(deal.amount_requested ?? deal.requested_amount ?? deal.funding_amount),
    credit_score: numOrEmpty(deal.credit_score),
    monthly_revenue: numOrEmpty(deal.monthly_revenue),
    annual_revenue: numOrEmpty(deal.annual_revenue),
    time_in_business_months: numOrEmpty(deal.time_in_business ?? deal.time_in_business_months),
  };
}

const FIELD_INPUT =
  "w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ocean-blue";

export default function QualificationPanel({ deal }: { deal: QualificationDeal }) {
  const [form, setForm] = useState<FormState>(() => initialForm(deal));
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form if the deal changes (e.g. after a fetch).
  useEffect(() => {
    setForm(initialForm(deal));
  }, [
    deal.amount_requested,
    deal.requested_amount,
    deal.funding_amount,
    deal.credit_score,
    deal.monthly_revenue,
    deal.annual_revenue,
    deal.time_in_business,
    deal.time_in_business_months,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("lender_programs")
        .select(`${PROGRAM_SELECT}, lender:lenders!inner(id, company_name, status)`)
        .eq("product_type", "mca")
        .eq("is_active", true);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setPrograms([]);
      } else {
        const rows = (data as unknown as ProgramRow[]) || [];
        setPrograms(rows.filter((r) => r.lender?.status === "live_vendor"));
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const criteria: DealCriteria = useMemo(
    () => ({
      amount: parseNum(form.amount),
      credit_score: parseNum(form.credit_score),
      monthly_revenue: parseNum(form.monthly_revenue),
      annual_revenue: parseNum(form.annual_revenue),
      time_in_business_months: parseNum(form.time_in_business_months),
    }),
    [form]
  );

  const results: MatchResult[] = useMemo(
    () => matchDeal(programs as LenderProgram[], criteria),
    [programs, criteria]
  );

  const qualified = results.filter((r) => r.evaluated > 0 && r.failCount === 0);
  const nearMiss = results.filter((r) => r.evaluated > 0 && r.failCount > 0);
  const noCriteria = results.filter((r) => r.evaluated === 0);

  const lenderName = (r: MatchResult) =>
    (r.program as ProgramRow).lender?.company_name || "Unknown lender";

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-5">
      {/* What-if criteria form */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { key: "amount" as const, label: "Requested amount" },
          { key: "credit_score" as const, label: "Credit score" },
          { key: "monthly_revenue" as const, label: "Avg monthly revenue" },
          { key: "annual_revenue" as const, label: "Annual revenue" },
          { key: "time_in_business_months" as const, label: "Time in business (mo)" },
        ].map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              {f.label}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={form[f.key]}
              onChange={set(f.key)}
              placeholder="—"
              className={FIELD_INPUT}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setForm(initialForm(deal))}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
          Reset to deal values
        </button>
        <span className="text-xs text-gray-400">
          Edit any value to run a what-if against the live funder matrix.
        </span>
      </div>

      {/* Summary + results */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-ocean-blue" />
          Loading live MCA programs…
        </div>
      ) : error ? (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/10 rounded-lg p-3">
          Failed to load programs: {error}
        </div>
      ) : programs.length === 0 ? (
        <div className="text-sm text-gray-500 py-4">
          No active MCA programs on live funders yet. Fill in each funder's approval matrix under
          Lenders to power this panel.
        </div>
      ) : (
        <>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            Qualifies for{" "}
            <span className="text-green-600">{qualified.length}</span> of{" "}
            {qualified.length + nearMiss.length} evaluated live MCA program
            {qualified.length + nearMiss.length === 1 ? "" : "s"}
            {noCriteria.length > 0 && (
              <span className="text-gray-400 font-normal">
                {" "}
                ({noCriteria.length} not yet evaluable)
              </span>
            )}
            .
          </div>

          {/* QUALIFIED */}
          {qualified.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-2">
                Qualified ({qualified.length})
              </h4>
              <div className="grid md:grid-cols-2 gap-3">
                {qualified.map((r) => (
                  <div
                    key={r.program.id}
                    className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10 p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Link
                        to={`/admin/lenders/${r.program.lender_id}`}
                        className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue hover:underline"
                      >
                        {lenderName(r)}
                      </Link>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        Qualified
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {r.checks.map((c, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-300"
                        >
                          <CheckCircleIcon className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                          <span>
                            <span className="font-medium">{c.label}:</span> {c.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NEAR-MISS / NOT QUALIFIED */}
          {nearMiss.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 mb-2">
                Not qualified ({nearMiss.length})
              </h4>
              <div className="grid md:grid-cols-2 gap-3">
                {nearMiss.map((r) => {
                  const fails = r.checks.filter((c) => !c.pass);
                  return (
                    <div
                      key={r.program.id}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Link
                          to={`/admin/lenders/${r.program.lender_id}`}
                          className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue hover:underline"
                        >
                          {lenderName(r)}
                        </Link>
                        <span className="text-xs text-gray-400">
                          {r.failCount} of {r.evaluated} failing
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {fails.map((c, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
                          >
                            <XCircleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              <span className="font-medium">{c.label}:</span> {c.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* NO EVALUABLE CRITERIA */}
          {noCriteria.length > 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Criteria not set yet — these live funders have no MCA approval matrix filled in, so
                they can't be evaluated:
              </p>
              <div className="flex flex-wrap gap-2">
                {noCriteria.map((r) => (
                  <Link
                    key={r.program.id}
                    to={`/admin/lenders/${r.program.lender_id}`}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
                  >
                    {lenderName(r)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
