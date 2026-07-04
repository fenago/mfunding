import { useCallback, useEffect, useState } from "react";
import { TableCellsIcon, ArrowPathIcon, ArrowsPointingOutIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  PRODUCT_TYPES,
  PROGRAM_FIELDS,
  PROGRAM_SELECT,
  fmtField,
  type LenderProgram,
  type ProgramField,
} from "@/data/lenderPrograms";

type Lender = { id: string; company_name: string; status: string; website: string | null };
type MatrixRow = LenderProgram & { lender: Lender };

// Right-align money/number/percent cells; text/list/bool/tri stay left.
const isNumeric = (t: string) => t === "money" || t === "number" || t === "percent";

// Quick filters over the structured doc columns — proves the queryability win.
type DocFilter = { id: string; label: string; test: (r: MatrixRow) => boolean };
const DOC_FILTERS: DocFilter[] = [
  { id: "voided", label: "Needs voided check", test: (r) => r.doc_voided_check === true },
  { id: "photo_id", label: "Needs photo ID", test: (r) => r.doc_photo_id === true },
  { id: "tax", label: "Needs tax return", test: (r) => r.doc_tax_financials === "required" },
  { id: "cc_if", label: "Accepts if-applicable CC", test: (r) => r.doc_cc_processing === "if_applicable" },
];

export default function FunderMatrixPage() {
  const { isAdmin } = useUserProfile();
  const [productType, setProductType] = useState("mca");
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popout, setPopout] = useState<{ title: string; content: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

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

  const toggleFilter = (id: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Optimistic local patch; persist via mustWrite. On failure, surface + refetch to revert.
  const patchDoc = (id: string, key: keyof LenderProgram, value: unknown) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const saveDoc = async (id: string, key: keyof LenderProgram, value: unknown) => {
    try {
      await mustWrite(
        "update funder docs",
        supabase
          .from("lender_programs")
          .update({ [key]: value, updated_at: new Date().toISOString() })
          .eq("id", id),
      );
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
      fetchRows(); // revert optimistic change to the persisted truth
    }
  };

  const filtered = rows.filter((r) =>
    DOC_FILTERS.every((f) => (activeFilters.has(f.id) ? f.test(r) : true)),
  );

  // Render one cell: doc columns are inline-editable for admins; everything else is read-only.
  const renderCell = (r: MatrixRow, f: ProgramField) => {
    const editable = f.doc && isAdmin;
    if (!editable) {
      const val = fmtField(f, r[f.key]);
      // Long list/text cells: clamp to a preview + a popout so the row never
      // grows to infinity. Everything stays readable via the ⤢ button.
      if ((f.type === "list" || f.type === "text") && val !== "—" && val.length > 48) {
        return (
          <div className="flex items-start gap-1">
            <span className="line-clamp-2 break-words">{val}</span>
            <button
              type="button"
              onClick={() => setPopout({ title: `${r.lender.company_name} — ${f.label}`, content: val })}
              title="View full"
              className="flex-shrink-0 text-ocean-blue hover:text-ocean-blue/70 mt-0.5"
            >
              <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }
      return val;
    }

    if (f.type === "bool") {
      return (
        <input
          type="checkbox"
          checked={r[f.key] === true}
          onChange={(e) => {
            patchDoc(r.id, f.key, e.target.checked);
            saveDoc(r.id, f.key, e.target.checked);
          }}
          className="w-4 h-4 text-ocean-blue rounded border-gray-300 focus:ring-ocean-blue cursor-pointer"
        />
      );
    }
    if (f.type === "tri") {
      return (
        <select
          value={(r[f.key] as string) ?? "no"}
          onChange={(e) => {
            patchDoc(r.id, f.key, e.target.value);
            saveDoc(r.id, f.key, e.target.value);
          }}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-blue"
        >
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (f.type === "number") {
      return (
        <input
          type="number"
          value={(r[f.key] as number | null) ?? ""}
          onChange={(e) =>
            patchDoc(r.id, f.key, e.target.value === "" ? null : Number(e.target.value))
          }
          onBlur={(e) => saveDoc(r.id, f.key, e.target.value === "" ? null : Number(e.target.value))}
          className="w-14 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-1 text-xs text-right tabular-nums text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-blue"
        />
      );
    }
    // text (doc_conditions / doc_other)
    return (
      <input
        type="text"
        value={(r[f.key] as string | null) ?? ""}
        onChange={(e) => patchDoc(r.id, f.key, e.target.value)}
        onBlur={(e) => saveDoc(r.id, f.key, e.target.value.trim() === "" ? null : e.target.value.trim())}
        placeholder="—"
        className="w-44 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-blue"
      />
    );
  };

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
                Side-by-side approval &amp; document criteria for every live funder — modeled on a
                product-summary sheet. Structured doc columns are editable inline{isAdmin ? "" : " (admins only)"};
                muted amber cells flag missing criteria worth filling in.
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
          {loading
            ? "Loading…"
            : `${filtered.length}${filtered.length !== rows.length ? ` / ${rows.length}` : ""} live MCA program${
                rows.length === 1 ? "" : "s"
              }`}
        </span>
      </div>

      {/* Doc-requirement quick filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Filter by docs:</span>
        {DOC_FILTERS.map((f) => {
          const on = activeFilters.has(f.id);
          return (
            <button
              key={f.id}
              onClick={() => toggleFilter(f.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                on
                  ? "bg-mint-green text-white border-mint-green"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-mint-green"
              }`}
            >
              {f.label}
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 underline"
          >
            Clear
          </button>
        )}
      </div>

      {saveError && (
        <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm text-red-700 dark:text-red-300">
          Could not save: {saveError}
        </div>
      )}

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
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          No funders match the selected doc filters.
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
              {filtered.map((r) => (
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
                    const cell = renderCell(r, f);
                    // Amber "missing" flag only for optional free-value columns — a false
                    // bool or "no" tri is a known answer, not a gap.
                    const blank =
                      typeof cell === "string" &&
                      cell === "—" &&
                      f.type !== "bool" &&
                      f.type !== "tri";
                    return (
                      <td
                        key={f.key}
                        className={`py-3 px-3 ${isNumeric(f.type) ? "text-right tabular-nums" : "text-left"} ${
                          f.type === "list" || f.type === "text" ? "max-w-[200px] align-top" : "whitespace-nowrap"
                        } ${
                          blank
                            ? "text-amber-500/70 dark:text-amber-500/60 italic"
                            : "text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full-content popout — so a long Details / Documents summary never has to
          expand the row; the cell stays compact and this shows the whole thing. */}
      {popout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPopout(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white pr-4">{popout.title}</h3>
              <button type="button" onClick={() => setPopout(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
              {popout.content.split(" · ").map((line, i) => (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="text-ocean-blue flex-shrink-0">•</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
