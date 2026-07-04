import { useCallback, useEffect, useState } from "react";
import { TableCellsIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import supabase from "@/supabase";
import {
  PRODUCT_TYPES,
  PROGRAM_FIELDS,
  PROGRAM_SELECT,
  fmtField,
  type LenderProgram,
} from "@/data/lenderPrograms";

type Lender = { id: string; company_name: string; status: string; website: string | null };
type MatrixRow = LenderProgram & { lender: Lender };

// Right-align money/number/percent cells; text/list stay left.
const isNumeric = (t: string) => t === "money" || t === "number" || t === "percent";

export default function FunderMatrixPage() {
  const [productType, setProductType] = useState("mca");
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("lender_programs")
        .select(`${PROGRAM_SELECT}, lender:lenders!inner(id, company_name, status, website)`)
        .eq("product_type", productType)
        .eq("is_active", true);
      if (err) throw err;
      const list = ((data ?? []) as unknown as MatrixRow[])
        .filter((r) => r.lender && r.lender.status === "live_vendor")
        .sort((a, b) => a.lender.company_name.localeCompare(b.lender.company_name));
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load programs");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [productType]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Dynamic: refetch on window focus so a lender flipping to "live" shows up.
  useEffect(() => {
    const onFocus = () => fetchRows();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchRows]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <TableCellsIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funder Approval Matrix</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                Side-by-side approval criteria for every live funder — modeled on a product-summary sheet.
                Muted amber cells flag missing criteria worth filling in.
              </p>
            </div>
            <button
              onClick={fetchRows}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 flex-shrink-0"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Product selector */}
      <div className="flex flex-wrap items-center gap-2 my-4">
        {PRODUCT_TYPES.map((p) =>
          p.active ? (
            <button
              key={p.value}
              onClick={() => setProductType(p.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                productType === p.value
                  ? "bg-ocean-blue text-white border-ocean-blue"
                  : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue"
              }`}
            >
              {p.label}
            </button>
          ) : (
            <span
              key={p.value}
              title="Coming soon"
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
            >
              {p.label} · soon
            </span>
          ),
        )}
        <span className="ml-auto text-sm text-gray-500">
          {loading ? "Loading…" : `${rows.length} live MCA program${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Matrix */}
      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          Loading approval matrix…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          No live funder programs yet. When a lender is set to <b>Live</b>, its MCA program appears here.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-3 px-4 font-semibold sticky left-0 bg-white dark:bg-gray-800 z-10 min-w-[180px]">
                  Funder
                </th>
                {PROGRAM_FIELDS.map((f) => (
                  <th
                    key={f.key}
                    title={f.label}
                    className={`py-3 px-3 font-semibold whitespace-nowrap ${
                      isNumeric(f.type) ? "text-right" : "text-left"
                    }`}
                  >
                    {f.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-gray-100 dark:border-gray-700/50 align-top hover:bg-gray-50 dark:hover:bg-gray-700/30"
                >
                  <td className="py-3 px-4 sticky left-0 bg-white dark:bg-gray-800 z-10 min-w-[180px]">
                    <Link
                      to={`/admin/lenders/${r.lender.id}`}
                      className="font-semibold text-ocean-blue hover:underline"
                    >
                      {r.lender.company_name}
                    </Link>
                  </td>
                  {PROGRAM_FIELDS.map((f) => {
                    const display = fmtField(f, r[f.key]);
                    const blank = display === "—";
                    return (
                      <td
                        key={f.key}
                        className={`py-3 px-3 ${isNumeric(f.type) ? "text-right tabular-nums" : "text-left"} ${
                          f.type === "list" || f.type === "text" ? "max-w-[220px]" : "whitespace-nowrap"
                        } ${
                          blank
                            ? "text-amber-500/70 dark:text-amber-500/60 italic"
                            : "text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
