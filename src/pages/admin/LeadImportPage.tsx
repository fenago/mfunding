import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpTrayIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { parseCsv, type ParsedCsv } from "../../lib/csv";
import { mustWrite } from "../../supabase/writes";

// ---- source config (bulk_csv rows of inbound_lead_sources) -----------------
interface LeadSource {
  key: string;
  label: string;
  feed_type: string;
  qual_richness: string;
  creates_deal: boolean;
  temperature: string | null;
  default_status: string | null;
  first_call_sla_seconds: number | null;
  match_rule: Record<string, unknown> | null;
}

// ---- mappable target fields -----------------------------------------------
type FieldGroup = "identity" | "qual";
interface TargetField {
  key: string;
  label: string;
  group: FieldGroup;
  aliases: string[];
}

const TARGET_FIELDS: TargetField[] = [
  { key: "company_name", label: "Business name", group: "identity", aliases: ["business", "company", "dba", "merchant", "businessname", "companyname"] },
  { key: "contact_name", label: "Contact full name", group: "identity", aliases: ["contact", "owner", "fullname", "name"] },
  { key: "first_name", label: "First name", group: "identity", aliases: ["first", "firstname", "fname"] },
  { key: "last_name", label: "Last name", group: "identity", aliases: ["last", "lastname", "lname"] },
  { key: "phone", label: "Phone", group: "identity", aliases: ["phone", "cell", "mobile", "tel", "phonenumber"] },
  { key: "email", label: "Email", group: "identity", aliases: ["email", "e-mail", "emailaddress"] },
  { key: "address_city", label: "City", group: "identity", aliases: ["city", "town"] },
  { key: "address_state", label: "State", group: "identity", aliases: ["state", "st", "province"] },
  { key: "industry", label: "Industry", group: "identity", aliases: ["industry", "sic", "naics", "vertical"] },
  { key: "monthly_revenue", label: "Monthly revenue", group: "qual", aliases: ["revenue", "monthlyrevenue", "monthlysales", "grossrevenue", "sales"] },
  { key: "time_in_business", label: "Time in business (months)", group: "qual", aliases: ["tib", "timeinbusiness", "monthsinbusiness", "yearsinbusiness"] },
  { key: "credit_score", label: "Credit score / FICO", group: "qual", aliases: ["fico", "credit", "creditscore", "score"] },
  { key: "amount_requested", label: "Amount requested", group: "qual", aliases: ["amount", "amountrequested", "fundingamount", "requested", "capital"] },
  { key: "use_of_funds", label: "Use of funds", group: "qual", aliases: ["useoffunds", "purpose", "reason"] },
  { key: "existing_positions", label: "Existing positions", group: "qual", aliases: ["positions", "existingpositions", "openpositions", "stacks", "balances"] },
  { key: "lead_date", label: "Lead date", group: "qual", aliases: ["leaddate", "date", "created", "generatedon", "qualifieddate"] },
];

const CHUNK_SIZE = 500;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ImportResult {
  imported: number;
  merged: number;
  rejected: number;
  batch_id: string;
  sample_errors: string[];
}

export default function LeadImportPage() {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  // columnMap is target-field → csv header
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = sources.find((s) => s.key === sourceKey) || null;

  // Load bulk_csv sources.
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from("inbound_lead_sources")
        .select("key, label, feed_type, qual_richness, creates_deal, temperature, default_status, first_call_sla_seconds, match_rule")
        .eq("feed_type", "bulk_csv")
        .eq("is_active", true)
        .order("sort");
      if (e) setError(e.message);
      else setSources(data || []);
    })();
  }, []);

  // Fields to show for the selected source (identity always; qual only for full sources).
  const visibleFields = useMemo(() => {
    if (!source) return TARGET_FIELDS;
    return source.qual_richness === "full"
      ? TARGET_FIELDS
      : TARGET_FIELDS.filter((f) => f.group === "identity");
  }, [source]);

  // Auto-guess the column map from CSV headers, seeded by a saved template.
  const autoMap = useCallback(
    (headers: string[], src: LeadSource | null) => {
      const saved = (src?.match_rule?.column_map_template as Record<string, string> | undefined) || {};
      const map: Record<string, string> = {};
      for (const field of TARGET_FIELDS) {
        // Prefer a saved template mapping if that header still exists.
        if (saved[field.key] && headers.includes(saved[field.key])) {
          map[field.key] = saved[field.key];
          continue;
        }
        const hit = headers.find((h) => {
          const nh = norm(h);
          return nh === norm(field.key) || nh === norm(field.label) || field.aliases.includes(nh);
        });
        if (hit) map[field.key] = hit;
      }
      return map;
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.headers.length || !parsed.rows.length) {
        setError("Could not parse any rows from that file.");
        return;
      }
      setFileName(file.name);
      setCsv(parsed);
      setColumnMap(autoMap(parsed.headers, source));
    },
    [autoMap, source],
  );

  // Re-run auto-map when the source changes and a file is already loaded.
  useEffect(() => {
    if (csv && source) setColumnMap(autoMap(csv.headers, source));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean));
  const unmappedColumns = csv ? csv.headers.filter((h) => !mappedHeaders.has(h)) : [];
  const hasContactPath = !!(columnMap.phone || columnMap.email);
  const hasName = !!(columnMap.company_name || columnMap.contact_name || columnMap.first_name);
  const canImport = !!source && !!csv && hasContactPath && hasName && !importing;

  const sampleRows = useMemo(() => {
    if (!csv) return [];
    return csv.rows.slice(0, 3).map((raw) => {
      const out: Record<string, string> = {};
      for (const field of visibleFields) {
        const header = columnMap[field.key];
        if (header) out[field.label] = raw[header] ?? "";
      }
      return out;
    });
  }, [csv, columnMap, visibleFields]);

  async function runImport() {
    if (!source || !csv) return;
    setImporting(true);
    setError(null);
    setResult(null);
    const rows = csv.rows;
    const total = rows.length;
    const acc: ImportResult = { imported: 0, merged: 0, rejected: 0, batch_id: "", sample_errors: [] };
    setProgress({ done: 0, total });

    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const slice = rows.slice(i, i + CHUNK_SIZE);
        const { data, error: fnErr } = await supabase.functions.invoke("bulk-lead-import", {
          body: {
            source_key: source.key,
            column_map: columnMap,
            rows: slice,
            batch_id: acc.batch_id || undefined,
            total_rows: total,
            file_name: fileName,
          },
        });
        if (fnErr) throw new Error(fnErr.message);
        const r = data as ImportResult & { error?: string };
        if (r?.error) throw new Error(String(r.error));
        acc.imported += r.imported;
        acc.merged += r.merged;
        acc.rejected += r.rejected;
        acc.batch_id = r.batch_id;
        for (const e of r.sample_errors || []) if (acc.sample_errors.length < 5) acc.sample_errors.push(e);
        setProgress({ done: Math.min(i + CHUNK_SIZE, total), total });
      }

      // Remember the column map on the source so next time is one-click.
      await mustWrite(
        "save column-map template",
        supabase
          .from("inbound_lead_sources")
          .update({ match_rule: { ...(source.match_rule ?? {}), column_map_template: columnMap } })
          .eq("key", source.key),
      );

      setResult(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lead Import</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Bulk-import a Synergy CSV. Imported leads land on the{" "}
          <span className="font-medium">active MCA pipeline</span> as deals.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1 — source */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">1. Pick a source</h2>
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => (
            <button
              key={s.key}
              onClick={() => setSourceKey(s.key)}
              className={`px-3 py-2 rounded-lg border text-sm text-left ${
                sourceKey === s.key
                  ? "border-mint-green bg-mint-green/10 text-gray-900 dark:text-white"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <div className="font-medium">{s.label}</div>
              <div className="text-xs mt-0.5 flex items-center gap-1">
                <BoltIcon className="w-3.5 h-3.5 text-amber-500" /> Active pipeline · {s.temperature}
              </div>
            </button>
          ))}
        </div>
        {source && (
          <div className="mt-3 text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
            These leads enter the <b>Active MCA Pipeline</b> at stage{" "}
            <code className="text-xs">{source.default_status}</code>
            {source.first_call_sla_seconds
              ? <> with a first-call clock of {source.first_call_sla_seconds}s.</>
              : "."}
          </div>
        )}
      </div>

      {/* Step 2 — file */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">2. Upload CSV</h2>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition ${
            dragOver ? "border-mint-green bg-mint-green/5" : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
          }`}
        >
          <DocumentArrowUpIcon className="w-8 h-8 text-gray-400" />
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {fileName ? <span className="font-medium">{fileName}</span> : "Drag a .csv here, or click to browse"}
          </div>
          {csv && <div className="text-xs text-gray-500">{csv.rows.length.toLocaleString()} rows · {csv.headers.length} columns</div>}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      </div>

      {/* Step 3 — column map */}
      {csv && source && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">3. Map columns</h2>
          <p className="text-xs text-gray-500 mb-4">
            Map each field to a column from your CSV. At minimum a phone <b>or</b> email, plus a
            business or contact name.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleFields.map((field) => (
              <label key={field.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {field.label}
                  {(field.key === "phone" || field.key === "email") && <span className="text-gray-400"> *</span>}
                </span>
                <select
                  value={columnMap[field.key] || ""}
                  onChange={(e) =>
                    setColumnMap((m) => {
                      const next = { ...m };
                      if (e.target.value) next[field.key] = e.target.value;
                      else delete next[field.key];
                      return next;
                    })
                  }
                  className="input-field w-1/2 text-sm"
                >
                  <option value="">— none —</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {unmappedColumns.length > 0 && (
            <div className="mt-4 text-xs text-gray-500">
              <span className="font-medium">Unmapped CSV columns:</span> {unmappedColumns.join(", ")}
            </div>
          )}
          {!hasContactPath && (
            <div className="mt-3 text-xs text-red-600">Map a phone or email column to continue.</div>
          )}
          {!hasName && (
            <div className="mt-1 text-xs text-red-600">Map a business or contact name column to continue.</div>
          )}
        </div>
      )}

      {/* Step 4 — preview + import */}
      {csv && source && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">4. Preview & import</h2>
          <div className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
            <BoltIcon className="w-4 h-4" />
            <span>
              <b>{csv.rows.length.toLocaleString()}</b> rows will go to the{" "}
              <b>Active Pipeline</b>.
              {" "}Duplicates (by phone or email) are merged, not re-created.
            </span>
          </div>

          {sampleRows.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {Object.keys(sampleRows[0]).map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sampleRows.map((r, i) => (
                    <tr key={i}>
                      {Object.keys(sampleRows[0]).map((h) => (
                        <td key={h} className="px-3 py-2 text-gray-700 dark:text-gray-300">{r[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={runImport} disabled={!canImport} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
            <ArrowUpTrayIcon className="w-5 h-5" />
            {importing
              ? progress
                ? `Importing… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
                : "Importing…"
              : `Import ${csv.rows.length.toLocaleString()} leads`}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-green-300 dark:border-green-800 p-5 mb-6">
          <div className="flex items-center gap-2 mb-3 text-green-700 dark:text-green-400">
            <CheckCircleIcon className="w-6 h-6" />
            <h2 className="text-lg font-semibold">Import complete</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <Stat label="New" value={result.imported} />
            <Stat label="Merged (dupes)" value={result.merged} />
            <Stat label="Rejected" value={result.rejected} />
          </div>
          {result.sample_errors.length > 0 && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Sample rejects:</span> {result.sample_errors.join("; ")}
            </div>
          )}
          <div className="mt-3 text-sm">
            <Link to="/admin/deals" className="text-ocean-blue hover:underline">View the pipeline →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-4 py-3 text-center">
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
