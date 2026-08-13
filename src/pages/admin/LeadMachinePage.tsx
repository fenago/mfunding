import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  RectangleStackIcon,
  TagIcon,
  XMarkIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import * as tus from "tus-js-client";
import supabase from "@/supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/config";

/* ------------------------------------------------------------------ */
/* LEAD MACHINE — /admin/lead-machine                                  */
/*                                                                     */
/* The purchased-list pipeline, one screen:                            */
/*   upload the CSV → it lands in Supabase → filter / sort / search →  */
/*   tag → push into VibeReach (GoHighLevel), which HotProspector      */
/*   dials by tag.                                                     */
/*                                                                     */
/* Built against the lead-machine backend contract (tables            */
/* lead_batches / lead_records; storage bucket lead-uploads; edge fns  */
/* lead-file-ingest + lead-push-ghl). Every query degrades to a        */
/* "backend not deployed yet" state when a table is missing, so this   */
/* page is safe to ship ahead of the backend.                          */
/*                                                                     */
/* NOT the same surface as /admin/lead-import — that one maps a CSV    */
/* onto customers/deals for the closer pipeline. This one is bulk      */
/* purchased lists for the OUTBOUND dialer.                            */
/*                                                                     */
/* Compliance: internal surface, but still never "loan" — MCA products */
/* are "funding" / "capital" / "advances".                             */
/* ------------------------------------------------------------------ */

/* ── Backend contract (mirror of the lead-machine schema) ── */
type LeadType = "ucc" | "aged" | "trigger";

interface LeadBatch {
  id: string;
  batch_code: string;
  lead_type: LeadType | string;
  label: string | null;
  file_name: string | null;
  storage_path: string | null;
  status: "uploaded" | "ingesting" | "ready" | "failed" | string;
  total_rows: number | null;
  ingested_rows: number | null;
  dup_rows: number | null;
  pushed_rows: number | null;
  error: string | null;
  message: string | null;
  // The ingester streams the file and resumes on self-reinvoke, so bytes are the
  // truthful progress signal while rows are still being counted.
  byte_offset: number | null;
  bytes_total: number | null;
  created_at: string | null;
}

type LeadRecordStatus = "loaded" | "pushed" | "skipped" | "error";

interface LeadRecord {
  id: string;
  batch_id: string | null;
  lead_type: LeadType | string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null; // normalized last-10
  email: string | null;
  line_type: string | null; // 'mobile' | 'landline' | 'voip' | null
  state: string | null;
  city: string | null;
  zip: string | null;
  revenue: number | string | null; // numeric → string over PostgREST
  employees: number | null;
  sic_description: string | null;
  filing_date: string | null; // UCC lists
  secured_party: string | null; // UCC lists
  /* true when this phone already existed in an EARLIER batch (or in ph_ucc_leads)
     — the "exclude duplicates" toggle filters on it. */
  is_dup_of_prior: boolean | null;
  status: LeadRecordStatus | string;
  ghl_contact_id: string | null;
  pushed_at: string | null;
  push_tags: string[] | null;
  push_error: string | null;
}

/* lead_push_jobs — one row per Supabase→GHL push run. The worker is resumable
   (it only ever selects lead_records with status='loaded'), so the UI queues a
   job and polls this row rather than driving the loop itself. */
interface PushJob {
  id: string;
  status: "queued" | "running" | "complete" | "error" | "canceled" | string;
  target_count: number | null;
  pushed: number | null;
  errored: number | null;
  skipped: number | null;
  message: string | null;
}
const JOB_TERMINAL = new Set(["complete", "error", "canceled"]);

const LEAD_SELECT =
  "id,batch_id,lead_type,first_name,last_name,company,phone,email,line_type,state,city,zip," +
  "revenue,employees,sic_description,filing_date,secured_party,is_dup_of_prior,status," +
  "ghl_contact_id,pushed_at,push_tags,push_error";

/* The three list types. `columns` is what the buyer's file is expected to carry —
   the ingester matches header names case/space-insensitively. */
const LEAD_TYPES: {
  type: LeadType;
  label: string;
  blurb: string;
  tag: string;
  columns: string;
}[] = [
  {
    type: "ucc",
    label: "UCC Leads",
    blurb: "Merchants with an existing advance on file — the stacked-position list.",
    tag: "ucc-lead",
    columns: "business name, owner first/last, phone, email, address, city, state, zip, filing date, secured party",
  },
  {
    type: "aged",
    label: "Aged Leads",
    blurb: "Older applications resold at a discount — volume dialing, low cost per lead.",
    tag: "aged-lead",
    columns: "business name, owner first/last, phone, email, city, state, zip, monthly revenue, lead date",
  },
  {
    type: "trigger",
    label: "Trigger Leads",
    blurb: "Businesses that just took an action signalling a capital need — dial these first.",
    tag: "trigger-lead",
    columns: "business name, owner first/last, phone, email, city, state, zip, revenue, employees, SIC description",
  },
];

const TYPE_META: Record<string, { label: string; tag: string; chip: string }> = {
  ucc: {
    label: "UCC",
    tag: "ucc-lead",
    chip: "bg-ocean-blue/10 text-ocean-blue",
  },
  aged: {
    label: "Aged",
    tag: "aged-lead",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  trigger: {
    label: "Trigger",
    tag: "trigger-lead",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

const STATUS_META: Record<string, { label: string; chip: string }> = {
  loaded: { label: "loaded", chip: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  pushed: { label: "✓ pushed", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  skipped: { label: "skipped", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  error: { label: "error", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

const PAGE_SIZE = 25;
/* lead-push-ghl caps an explicit lead_ids[] at 5,000 — bigger sets have to go as
   server-side `filters`, which the fn re-runs itself. */
const MAX_LEAD_IDS = 5000;

/* ── Small helpers ── */

/** YYYYMMDD in local time — the batch-code stamp. */
function todayCode(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** A PostgREST "relation not found" error → backend not deployed. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST205" || err.code === "42P01" || /does not exist|find the table/i.test(err.message || "");
}

/** supabase-js hides the edge fn's real message inside error.context — dig it out. */
async function fnErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      /* body already consumed or not JSON — fall through */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** A count column that may legitimately be null on a batch still ingesting. */
function n0(v: number | null | undefined): number {
  return typeof v === "number" ? v : 0;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function fmtMoney(v: number | string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

/** (305) 555-1212 from a stored last-10. */
function fmtPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function fullName(l: LeadRecord): string {
  const n = [l.first_name, l.last_name].filter(Boolean).join(" ").trim();
  return n || "—";
}

/** Lowercase-kebab, the tag shape HotProspector campaigns target. */
function kebab(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** PostgREST or() filters break on commas/parens — strip them from user text. */
function safeTerm(s: string): string {
  return s.replace(/[,()*%]/g, " ").trim();
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* Resumable (TUS) upload to the private lead-uploads bucket. Purchased lists run
   from a few MB to a few hundred MB, so a single POST is fragile; TUS chunks at
   6MB and survives dropped connections. objectName excludes the bucket prefix;
   auth is the signed-in user's token (RLS-gated). */
async function uploadResumable(
  file: File,
  path: string,
  accessToken: string,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6MB chunks
      metadata: {
        bucketName: "lead-uploads",
        objectName: path,
        contentType: "text/csv",
        cacheControl: "3600",
      },
      onError: reject,
      onProgress,
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

/* Terminal ingest states — the poller stops here. lead_batches.status is
   CHECK-constrained to uploaded | ingesting | ready | failed. */
const DONE_STATES = new Set(["ready"]);
const FAIL_STATES = new Set(["failed"]);

type UploadPhase = "idle" | "uploading" | "ingesting" | "done" | "error";

/* ================================================================== */
/* Section 1 — Upload a list                                           */
/* ================================================================== */
function UploadPanel({ onIngested }: { onIngested: (batchId: string) => void }) {
  const [type, setType] = useState<LeadType>("ucc");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadMsg, setUploadMsg] = useState("");
  const [batch, setBatch] = useState<LeadBatch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const plannedCode = `${type.toUpperCase()}-${todayCode()}`;

  const pollBatch = (batchId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      const { data, error } = await supabase.from("lead_batches").select("*").eq("id", batchId).maybeSingle();
      if (error || !data) return;
      const b = data as LeadBatch;
      setBatch(b);
      const st = (b.status || "").toLowerCase();
      if (DONE_STATES.has(st) || FAIL_STATES.has(st)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (FAIL_STATES.has(st)) {
          setPhase("error");
          setErr(b.error || b.message || `ingest ${st}`);
        } else {
          setPhase("done");
          onIngested(batchId);
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2000);
  };

  const start = async () => {
    if (!file) return;
    setErr(null);
    setBatch(null);
    try {
      setPhase("uploading");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("not signed in — refresh and try again");
      const path = `${type}/${crypto.randomUUID()}/${file.name}`;
      await uploadResumable(file, path, token, (sent, total) => {
        const p = total > 0 ? Math.round((sent / total) * 100) : 0;
        setUploadMsg(`Uploading ${file.name} (${p}%)`);
      });

      setPhase("ingesting");
      setUploadMsg("Starting ingest…");
      const { data, error } = await supabase.functions.invoke("lead-file-ingest", {
        body: {
          storage_path: path,
          lead_type: type,
          label: label.trim() || null,
          file_name: file.name,
          file_size: file.size,
        },
      });
      if (error) throw new Error(await fnErrorMessage(error));
      const res = data as { ok?: boolean; batch_id?: string; batch_code?: string; error?: string } | null;
      if (res?.ok === false || !res?.batch_id) throw new Error(res?.error || "ingest did not start");
      pollBatch(res.batch_id);
    } catch (e) {
      setPhase("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    setFile(null);
    setLabel("");
    setPhase("idle");
    setBatch(null);
    setErr(null);
    setUploadMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const total = n0(batch?.total_rows);
  const ingested = n0(batch?.ingested_rows);
  const dupes = n0(batch?.dup_rows);
  /* The ingester streams the file, so bytes are the honest progress bar while
     total_rows is still being discovered; rows take over once it knows the count. */
  const bytesTotal = n0(batch?.bytes_total);
  const pct =
    bytesTotal > 0
      ? Math.min(100, Math.round((n0(batch?.byte_offset) / bytesTotal) * 100))
      : total > 0
        ? Math.min(100, Math.round((ingested / total) * 100))
        : null;
  /* Rows in the file that produced no lead — no usable phone, unparseable, etc.
     Derived, because the batch keeps no explicit skipped counter. */
  const unusable = total > 0 ? Math.max(0, total - ingested) : 0;

  const input =
    "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">1 · Upload a list</h2>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
        {/* Type picker — three big option cards, each stating its expected columns. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {LEAD_TYPES.map((t) => {
            const active = type === t.type;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => setType(t.type)}
                disabled={phase === "uploading" || phase === "ingesting"}
                className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-60 ${
                  active
                    ? "border-ocean-blue bg-ocean-blue/5 dark:bg-ocean-blue/10 ring-1 ring-ocean-blue"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-900 dark:text-white text-sm">{t.label}</span>
                  {active && <CheckCircleIcon className="w-4 h-4 text-ocean-blue shrink-0" />}
                </div>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{t.blurb}</p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">Expected columns</p>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">{t.columns}</p>
                <span
                  className={`mt-2 inline-block text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${TYPE_META[t.type].chip}`}
                >
                  tags as {t.tag}
                </span>
              </button>
            );
          })}
        </div>

        {phase === "idle" || phase === "error" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Label (optional)
                </label>
                <input
                  className={`${input} w-64`}
                  placeholder="e.g. Lead Tycoons — FL restaurants"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <span className="text-[10px] text-gray-400">Who you bought it from / what's in it</span>
              </div>
              <div className="flex flex-col gap-0.5 grow min-w-[16rem]">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">CSV file</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPhase("idle");
                    setErr(null);
                  }}
                  className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:rounded-md file:border-0 file:bg-ocean-blue/10 file:px-2 file:py-1.5 file:text-xs file:font-semibold file:text-ocean-blue"
                />
                <span className="text-[10px] text-gray-400">
                  One file per batch. Rows without a usable phone are skipped and counted.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Batch code:{" "}
                <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100 font-semibold">
                  {plannedCode}
                </code>{" "}
                <span className="text-gray-400">— the server confirms the final code when ingest starts.</span>
              </span>
              <button
                onClick={start}
                disabled={!file}
                className="btn-primary btn-sm inline-flex items-center gap-1.5 ml-auto"
              >
                <ArrowUpTrayIcon className="w-4 h-4" /> Upload &amp; load into Supabase
              </button>
            </div>
            {err && (
              <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> {err}
              </p>
            )}
          </>
        ) : phase === "uploading" ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">{uploadMsg}</p>
        ) : phase === "ingesting" ? (
          <div className="space-y-1.5">
            {pct != null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-ocean-blue transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {total > 0
                ? `Ingesting ${ingested.toLocaleString()} of ${total.toLocaleString()}…`
                : batch?.message || uploadMsg || "Ingesting…"}
            </p>
          </div>
        ) : (
          /* done */
          <div className="space-y-2">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4 shrink-0" />
              {ingested.toLocaleString()} leads loaded
              {batch?.batch_code ? (
                <>
                  {" "}
                  into{" "}
                  <code className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    {batch.batch_code}
                  </code>
                </>
              ) : null}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {total.toLocaleString()} rows in the file · {unusable.toLocaleString()} skipped (no usable phone) ·{" "}
              {dupes.toLocaleString()} already seen in an earlier batch
            </p>
            <button onClick={reset} className="text-xs text-ocean-blue hover:underline">
              Upload another list
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ================================================================== */
/* The page                                                            */
/* ================================================================== */
export default function LeadMachinePage() {
  const [backendMissing, setBackendMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* ── Batches ── */
  const [batches, setBatches] = useState<LeadBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    const { data, error } = await supabase
      .from("lead_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setBatchesLoading(false);
    if (error) {
      if (isMissingRelation(error)) {
        setBackendMissing(true);
        return;
      }
      setLoadError(error.message);
      return;
    }
    setBackendMissing(false);
    setLoadError(null);
    setBatches((data as LeadBatch[]) ?? []);
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  /* ── Lead browser filters ── */
  const [fType, setFType] = useState<"" | LeadType>("");
  const [fBatch, setFBatch] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [fState, setFState] = useState("");
  const [fLine, setFLine] = useState("");
  const [fRevMin, setFRevMin] = useState("");
  const [fRevMax, setFRevMax] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fHasEmail, setFHasEmail] = useState(false);
  const [fSecured, setFSecured] = useState("");
  const [fTag, setFTag] = useState("");
  /* Duplicates are excluded by DEFAULT — a phone that already came in on an
     earlier list is a second dial to the same merchant. Unticking it is the
     deliberate deviation, so that's what counts as an active filter. */
  const [fExcludeDups, setFExcludeDups] = useState(true);
  const [sortKey, setSortKey] = useState<"created_at" | "revenue" | "state" | "filing_date" | "company">("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  const dSearch = useDebounced(fSearch);
  const dSecured = useDebounced(fSecured);
  const dTag = useDebounced(fTag);
  const dRevMin = useDebounced(fRevMin);
  const dRevMax = useDebounced(fRevMax);

  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* The batch a filter is pinned to (drives the batch tag chip + the batch table
     highlight). Only meaningful when exactly one batch is selected. */
  const pinnedBatch = useMemo(() => batches.find((b) => b.id === fBatch) ?? null, [batches, fBatch]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (fType) n++;
    if (fBatch) n++;
    if (dSearch.trim()) n++;
    if (fState) n++;
    if (fLine) n++;
    if (dRevMin.trim()) n++;
    if (dRevMax.trim()) n++;
    if (fStatus) n++;
    if (fHasEmail) n++;
    if (dSecured.trim()) n++;
    if (dTag.trim()) n++;
    if (!fExcludeDups) n++; // "include duplicates" is the deviation from default
    return n;
  }, [fType, fBatch, dSearch, fState, fLine, dRevMin, dRevMax, fStatus, fHasEmail, dSecured, dTag, fExcludeDups]);

  const clearFilters = useCallback(() => {
    setFType("");
    setFBatch("");
    setFSearch("");
    setFState("");
    setFLine("");
    setFRevMin("");
    setFRevMax("");
    setFStatus("");
    setFHasEmail(false);
    setFSecured("");
    setFTag("");
    setFExcludeDups(true);
  }, []);

  /* Single source of truth for the filtered lead_records query — the table, the
     count, and the push id-gather all build from this, so "N leads" on screen is
     exactly what gets pushed. Callers add .range() for pagination. */
  const buildFilteredQuery = useCallback(
    (select: string, opts: { count?: "exact"; head?: boolean } = {}) => {
      let q = supabase
        .from("lead_records")
        .select(select, opts)
        .order(sortKey, { ascending: sortAsc, nullsFirst: false });
      if (fType) q = q.eq("lead_type", fType);
      if (fBatch) q = q.eq("batch_id", fBatch);
      if (fState) q = q.eq("state", fState);
      if (fLine) q = q.eq("line_type", fLine);
      if (fStatus) q = q.eq("status", fStatus);
      if (fHasEmail) q = q.not("email", "is", null);
      if (fExcludeDups) q = q.eq("is_dup_of_prior", false);
      if (dRevMin.trim() && !isNaN(Number(dRevMin))) q = q.gte("revenue", Number(dRevMin));
      if (dRevMax.trim() && !isNaN(Number(dRevMax))) q = q.lte("revenue", Number(dRevMax));
      if (dSecured.trim()) q = q.ilike("secured_party", `%${dSecured.trim()}%`);
      // Tag containment hits the push_tags GIN index — the same filter the push fn runs.
      if (dTag.trim()) q = q.contains("push_tags", [kebab(dTag)]);
      const t = safeTerm(dSearch);
      if (t) {
        q = q.or(
          [
            `company.ilike.*${t}*`,
            `first_name.ilike.*${t}*`,
            `last_name.ilike.*${t}*`,
            `email.ilike.*${t}*`,
            `phone.ilike.*${t}*`,
          ].join(","),
        );
      }
      return q;
    },
    [
      fType,
      fBatch,
      fState,
      fLine,
      fStatus,
      fHasEmail,
      fExcludeDups,
      dRevMin,
      dRevMax,
      dSecured,
      dTag,
      dSearch,
      sortKey,
      sortAsc,
    ],
  );

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    const { data, error, count } = await buildFilteredQuery(LEAD_SELECT, { count: "exact" }).range(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE - 1,
    );
    setLeadsLoading(false);
    if (error) {
      if (isMissingRelation(error)) {
        setBackendMissing(true);
        return;
      }
      setLoadError(error.message);
      setLeads([]);
      setLeadCount(0);
      return;
    }
    setLoadError(null);
    setLeads((data as unknown as LeadRecord[]) ?? []);
    setLeadCount(count ?? 0);
  }, [buildFilteredQuery, page]);

  useEffect(() => {
    if (!backendMissing) void loadLeads();
  }, [loadLeads, backendMissing]);

  // Any filter change resets to page 1 and drops the selection (a selection that
  // isn't visible would silently drive the push).
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [
    fType,
    fBatch,
    dSearch,
    fState,
    fLine,
    dRevMin,
    dRevMax,
    fStatus,
    fHasEmail,
    fExcludeDups,
    dSecured,
    dTag,
    sortKey,
    sortAsc,
  ]);

  const totalPages = Math.max(1, Math.ceil(leadCount / PAGE_SIZE));

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPageSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));
  const someOnPageSelected = leads.some((l) => selectedIds.has(l.id));
  const toggleSelectAllOnPage = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });

  const sortBy = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "company" || key === "state");
    }
  };
  const sortArrow = (key: typeof sortKey) => (sortKey === key ? (sortAsc ? " ↑" : " ↓") : "");

  /* ── Tags + push ── */
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [pushArmed, setPushArmed] = useState(false);
  const [pushRunning, setPushRunning] = useState(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [pushErr, setPushErr] = useState<string | null>(null);
  // The job poller — cleared on unmount so leaving the page doesn't leak an interval.
  const pushPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (pushPollRef.current) clearInterval(pushPollRef.current);
    },
    [],
  );

  // The armed confirm disarms itself after 5s (house pattern — no browser popups).
  useEffect(() => {
    if (!pushArmed) return;
    const t = setTimeout(() => setPushArmed(false), 5000);
    return () => clearTimeout(t);
  }, [pushArmed]);

  const addTag = (raw: string) => {
    const k = kebab(raw);
    if (!k) return;
    setTags((prev) => (prev.includes(k) ? prev : [...prev, k]));
    setTagDraft("");
  };

  /* What the push will actually touch: the checkbox subset when one exists,
     otherwise the whole filtered set. */
  const usingSelection = selectedIds.size > 0;
  const pushCount = usingSelection ? selectedIds.size : leadCount;

  /* The server only pushes rows still marked `loaded` that HAVE a phone, so the
     filtered count can overstate the run. This is the honest number, computed off
     the same filtered query, and it's what the button promises. */
  const [pushEligible, setPushEligible] = useState<number | null>(null);
  useEffect(() => {
    if (backendMissing) return;
    let cancelled = false;
    void (async () => {
      const { count, error } = await buildFilteredQuery("id", { count: "exact", head: true })
        .eq("status", "loaded")
        .not("phone", "is", null);
      if (!cancelled) setPushEligible(error ? null : (count ?? 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [buildFilteredQuery, backendMissing]);

  /* The same filter set, in the shape lead-push-ghl runs server-side. Every
     control on the filter bar has a server equivalent, so a set too big for an
     explicit id list still pushes as exactly what's on screen. */
  const serverFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (fType) f.lead_type = fType;
    if (fState) f.state = fState;
    if (fLine) f.line_type = fLine;
    if (fStatus) f.status = fStatus;
    if (fHasEmail) f.has_email = true;
    if (dRevMin.trim() && !isNaN(Number(dRevMin))) f.min_revenue = Number(dRevMin);
    if (dRevMax.trim() && !isNaN(Number(dRevMax))) f.max_revenue = Number(dRevMax);
    if (dSecured.trim()) f.secured_party_ilike = dSecured.trim();
    if (dTag.trim()) f.push_tags_contains = kebab(dTag);
    if (safeTerm(dSearch)) f.search = safeTerm(dSearch);
    if (fExcludeDups) f.exclude_dups = true;
    return f;
  }, [fType, fState, fLine, fStatus, fHasEmail, dRevMin, dRevMax, dSecured, dTag, dSearch, fExcludeDups]);

  /* RE-TAG. A normal push drains rows still marked `loaded` — which is exactly
     what makes it un-double-pushable, and also means it would find nothing in a
     slice that's already been pushed. Filtering to pushed/errored leads is only
     ever asking for the other thing: add these tags to contacts already in
     VibeReach. So that filter selects re-tag mode, and the panel says so. */
  const retagMode = fStatus === "pushed" || fStatus === "error";

  /* The count the button promises. In re-tag mode already-pushed rows ARE the
     target, so the "still loaded" eligibility count doesn't apply. */
  const plannedPush = usingSelection ? selectedIds.size : retagMode ? leadCount : (pushEligible ?? leadCount);
  const tooBigForIds = !usingSelection && plannedPush > MAX_LEAD_IDS;

  /* The auto tags the edge fn adds server-side, shown as fixed chips so the
     closer/owner sees the full tag set before firing. */
  const autoTypeTag = fType ? TYPE_META[fType]?.tag : null;
  const autoBatchTag = pinnedBatch?.batch_code ? kebab(pinnedBatch.batch_code) : null;

  const runPush = useCallback(async () => {
    setPushArmed(false);
    setPushRunning(true);
    setPushErr(null);
    setPushResult(null);
    setPushProgress({ done: 0, total: plannedPush });
    try {
      // The fn REQUIRES a non-empty tags[] — the auto tags it adds server-side
      // don't satisfy it, so the UI blocks the button until there's at least one.
      if (tags.length === 0) throw new Error("Add at least one tag before pushing.");

      // How the set is expressed to the server:
      //   · a checkbox selection, or any set that fits, goes as explicit ids —
      //     that honours EVERY on-screen filter, search included;
      //   · a bigger set goes as server-side filters, which the fn re-runs and
      //     self-continues through — every filter here has a server equivalent.
      const body: Record<string, unknown> = { action: "start", tags };
      if (retagMode) body.retag = true;
      if (!tooBigForIds) {
        let ids: string[] = [];
        if (usingSelection) {
          ids = Array.from(selectedIds);
        } else {
          const WINDOW = 1000;
          let offset = 0;
          while (ids.length < MAX_LEAD_IDS) {
            const want = Math.min(WINDOW, MAX_LEAD_IDS - ids.length);
            const res = await buildFilteredQuery("id").range(offset, offset + want - 1);
            if (res.error) throw res.error;
            const rows = (res.data as unknown as { id: string }[]) ?? [];
            ids.push(...rows.map((r) => r.id));
            if (rows.length < want) break; // drained
            offset += rows.length;
          }
        }
        if (ids.length === 0) {
          setPushResult("Nothing to push — no leads match the current filter.");
          return;
        }
        body.lead_ids = ids;
        setPushProgress({ done: 0, total: ids.length });
      } else {
        // Too big for an explicit id list — hand the fn the same filters instead;
        // it re-runs them server-side and self-continues until the set is done.
        body.filters = serverFilters;
        if (fBatch) body.batch_id = fBatch;
      }

      // Queue the job. The worker only ever selects lead_records still marked
      // `loaded`, so a re-push can never create a second contact for a merchant.
      const { data, error } = await supabase.functions.invoke("lead-push-ghl", { body });
      if (error) throw new Error(await fnErrorMessage(error));
      const res = (data as Record<string, unknown>) ?? {};
      if (res.ok === false) throw new Error(String(res.error || "push failed"));

      const jobId = typeof res.job_id === "string" ? res.job_id : null;
      const target = Number(res.target_count ?? 0) || 0;
      setPushProgress({ done: Number(res.pushed ?? 0) || 0, total: target || plannedPush });

      // A small push finishes inline (done: true); a big one self-reinvokes, so
      // poll the job row until it reaches a terminal state.
      let final: PushJob | null = null;
      if (jobId && res.done !== true) {
        final = await new Promise<PushJob | null>((resolve) => {
          const tick = async () => {
            const { data: jd } = await supabase
              .from("lead_push_jobs")
              .select("id,status,target_count,pushed,errored,skipped,message")
              .eq("id", jobId)
              .maybeSingle();
            const j = (jd as PushJob | null) ?? null;
            if (!j) return;
            setPushProgress({
              done: n0(j.pushed) + n0(j.errored),
              total: n0(j.target_count) || target || plannedPush,
            });
            if (JOB_TERMINAL.has(j.status)) {
              if (pushPollRef.current) clearInterval(pushPollRef.current);
              pushPollRef.current = null;
              resolve(j);
            }
          };
          pushPollRef.current = setInterval(() => void tick(), 2000);
          void tick();
        });
      }

      if (final && final.status === "error") throw new Error(final.message || "push job failed");
      if (final && final.status === "canceled") {
        setPushResult(final.message || "Push canceled.");
        return;
      }
      const pushed = final ? n0(final.pushed) : Number(res.pushed ?? 0) || 0;
      const errored = final ? n0(final.errored) : Number(res.errored ?? 0) || 0;
      const eligible = final ? n0(final.target_count) : target;

      if (eligible === 0) {
        setPushResult(
          retagMode
            ? "Nothing eligible — no contact in this set is in VibeReach yet, or none has a phone number."
            : "Nothing eligible — every lead in this set was already pushed, or has no phone number.",
        );
      } else {
        const tagList = [autoTypeTag, autoBatchTag, ...tags].filter(Boolean).join(", ");
        setPushResult(
          (retagMode
            ? `Tagged ${pushed.toLocaleString()} of ${eligible.toLocaleString()} contacts already in VibeReach`
            : `Pushed ${pushed.toLocaleString()} of ${eligible.toLocaleString()} into VibeReach`) +
            (errored > 0 ? ` · ${errored.toLocaleString()} errored` : "") +
            `. Tags: ${tagList} — target those tags in a HotProspector campaign to dial them.`,
        );
      }
      setSelectedIds(new Set());
      await Promise.all([loadLeads(), loadBatches()]);
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPushRunning(false);
      setPushProgress(null);
    }
  }, [
    autoBatchTag,
    autoTypeTag,
    buildFilteredQuery,
    fBatch,
    loadBatches,
    loadLeads,
    plannedPush,
    selectedIds,
    retagMode,
    serverFilters,
    tags,
    tooBigForIds,
    usingSelection,
  ]);

  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.state && set.add(l.state));
    return Array.from(set).sort();
  }, [leads]);

  const input =
    "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
  const th = "py-3 px-4 text-left";
  const thSortable = `${th} cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-200`;

  /* ── Render ── */
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <RectangleStackIcon className="w-6 h-6 text-ocean-blue" /> Lead Machine
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Upload a purchased list → it loads into Supabase → filter, sort and search it → tag it → push it into
            VibeReach for the dialer.
          </p>
        </div>
        <button onClick={() => void loadBatches()} className="btn-ghost inline-flex items-center gap-2 text-sm">
          <ArrowPathIcon className={`w-4 h-4 ${batchesLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Naming convention — the one rule that makes the tags dialable. */}
      <div className="rounded-xl border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 px-4 py-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
        <p className="font-semibold text-gray-800 dark:text-gray-100">How lists are named and tagged</p>
        <p>
          Every batch is <code className="px-1 rounded bg-white/70 dark:bg-gray-800">TYPE-YYYYMMDD</code> —{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">UCC-{todayCode()}</code>,{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">AGED-{todayCode()}</code>,{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">TRIG-{todayCode()}</code>. Every pushed contact
          gets the <strong>type tag</strong> (<code>ucc-lead</code> / <code>aged-lead</code> / <code>trigger-lead</code>
          ), the <strong>batch tag</strong>, plus <strong>your campaign tags</strong>. HotProspector campaigns dial by
          tag, so the tags you add here are how a list becomes a dial session.
        </p>
        <p className="text-gray-400">
          Different surface from{" "}
          <Link to="/admin/lead-import" className="text-ocean-blue hover:underline">
            Lead Import
          </Link>
          , which maps a CSV onto merchants/deals for the closer pipeline. This one is bulk lists for outbound dialing.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> Failed to load: {loadError}
        </div>
      )}

      {backendMissing ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-12 text-center">
          <DocumentArrowUpIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
          <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">Backend not deployed yet</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            The Lead Machine tables (<code>lead_batches</code>, <code>lead_records</code>) aren't live yet. This page
            populates automatically once the ingest backend is deployed.
          </p>
        </div>
      ) : (
        <>
          {/* ── 1. Upload ── */}
          <UploadPanel
            onIngested={(batchId) => {
              void loadBatches();
              setFBatch(batchId); // drop straight into the new batch
            }}
          />

          {/* ── 2. Batches ── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              2 · Batches
              <span className="normal-case font-normal text-gray-400"> · click one to filter the browser below</span>
            </h2>
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className={th}>Batch</th>
                    <th className={th}>Type</th>
                    <th className={th}>Label</th>
                    <th className={th}>Rows</th>
                    <th className={th}>Loaded</th>
                    <th className={th}>Pushed</th>
                    <th className={th}>Dupes</th>
                    <th className={th}>Status</th>
                    <th className={th}>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {batchesLoading ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : batches.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        No lists uploaded yet — start with the upload panel above.
                      </td>
                    </tr>
                  ) : (
                    batches.map((b) => {
                      const meta = TYPE_META[String(b.lead_type)] ?? {
                        label: String(b.lead_type ?? "—"),
                        tag: "",
                        chip: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
                      };
                      const active = fBatch === b.id;
                      const st = (b.status || "").toLowerCase();
                      return (
                        <tr
                          key={b.id}
                          onClick={() => setFBatch(active ? "" : b.id)}
                          className={`border-b border-gray-50 dark:border-gray-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 ${
                            active ? "bg-ocean-blue/5 dark:bg-ocean-blue/10" : ""
                          }`}
                        >
                          <td className="py-2.5 px-4 font-semibold text-gray-900 dark:text-white">{b.batch_code}</td>
                          <td className="py-2.5 px-4">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${meta.chip}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">{b.label || "—"}</td>
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">
                            {n0(b.total_rows).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-gray-900 dark:text-white font-semibold">
                            {n0(b.ingested_rows).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-emerald-600 dark:text-emerald-400 font-semibold">
                            {n0(b.pushed_rows).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400">
                            {n0(b.dup_rows).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                FAIL_STATES.has(st)
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                  : DONE_STATES.has(st)
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                              }`}
                            >
                              {b.status || "—"}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400">{fmtDate(b.created_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 3. Lead browser ── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-2">
                3 · Lead browser
                <span className="normal-case font-normal text-gray-400">
                  · <strong className="text-gray-700 dark:text-gray-200">{leadCount.toLocaleString()}</strong> leads
                  match
                </span>
                {activeFilterCount > 0 && (
                  <span className="normal-case text-xs px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue font-semibold">
                    {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
                  </span>
                )}
                {pinnedBatch && (
                  <span className="normal-case text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-semibold">
                    {pinnedBatch.batch_code}
                  </span>
                )}
              </h2>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
                  <TrashIcon className="w-4 h-4" /> Clear filters
                </button>
              )}
            </div>

            {/* Filter bar — every control maps to a real lead_records column and
                filters server-side, so the count above is the true set. */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex flex-wrap items-start gap-x-3 gap-y-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Search</label>
                <input
                  className={`${input} w-56`}
                  placeholder="name, business, phone, email"
                  value={fSearch}
                  onChange={(e) => setFSearch(e.target.value)}
                />
                <span className="text-[10px] text-gray-400">Matches any of the four</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">List type</label>
                <select className={input} value={fType} onChange={(e) => setFType(e.target.value as "" | LeadType)}>
                  <option value="">All types</option>
                  {LEAD_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-gray-400">Drives the auto type tag</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Batch</label>
                <select className={input} value={fBatch} onChange={(e) => setFBatch(e.target.value)}>
                  <option value="">All batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_code}
                      {b.label ? ` — ${b.label}` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-gray-400">One uploaded list</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">State</label>
                <input
                  list="lead-machine-states"
                  className={`${input} w-24`}
                  placeholder="any"
                  value={fState}
                  onChange={(e) => setFState(e.target.value.toUpperCase().slice(0, 2))}
                />
                <datalist id="lead-machine-states">
                  {stateOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <span className="text-[10px] text-gray-400">2-letter</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Line type</label>
                <select className={input} value={fLine} onChange={(e) => setFLine(e.target.value)}>
                  <option value="">Any line</option>
                  <option value="mobile">Mobile</option>
                  <option value="landline">Landline</option>
                  <option value="voip">VoIP</option>
                </select>
                <span className="text-[10px] text-gray-400">Mobile connects best</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Revenue</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    className={`${input} w-24`}
                    placeholder="min"
                    value={fRevMin}
                    onChange={(e) => setFRevMin(e.target.value)}
                  />
                  <span className="text-gray-400 text-xs">–</span>
                  <input
                    type="number"
                    min={0}
                    className={`${input} w-24`}
                    placeholder="max"
                    value={fRevMax}
                    onChange={(e) => setFRevMax(e.target.value)}
                  />
                </div>
                <span className="text-[10px] text-gray-400">As stated on the list</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Push status</label>
                <select className={input} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                  <option value="">Any status</option>
                  <option value="loaded">Loaded (not pushed)</option>
                  <option value="pushed">Pushed</option>
                  <option value="skipped">Skipped</option>
                  <option value="error">Error</option>
                </select>
                <span className="text-[10px] text-gray-400">Where the lead sits</span>
              </div>
              <div className="flex flex-col gap-0.5 justify-end pb-1">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fHasEmail}
                    onChange={(e) => setFHasEmail(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue"
                  />
                  Has email
                </label>
                <span className="text-[10px] text-gray-400">Email + phone = two channels</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Tag</label>
                <input
                  className={`${input} w-40`}
                  placeholder="pushed with tag…"
                  value={fTag}
                  onChange={(e) => setFTag(e.target.value)}
                />
                <span className="text-[10px] text-gray-400">Find a slice you already pushed</span>
              </div>
              <div className="flex flex-col gap-0.5 justify-end pb-1">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fExcludeDups}
                    onChange={(e) => setFExcludeDups(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue"
                  />
                  Exclude duplicates
                </label>
                <span className="text-[10px] text-gray-400">Phone already on an earlier list</span>
              </div>
              {/* UCC-only funder filter — meaningless on aged/trigger lists. */}
              {fType === "ucc" && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Secured party
                  </label>
                  <input
                    className={`${input} w-48`}
                    placeholder="funder name contains"
                    value={fSecured}
                    onChange={(e) => setFSecured(e.target.value)}
                  />
                  <span className="text-[10px] text-gray-400">Who they already took capital from</span>
                </div>
              )}
            </div>

            {/* ── 4. Push panel — sticky once there's something to push ── */}
            {(activeFilterCount > 0 || usingSelection) && (
              <div className="sticky top-0 z-20 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/90 dark:bg-emerald-900/30 backdrop-blur p-4 space-y-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ArrowUpTrayIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    {retagMode ? "Re-tag in VibeReach" : "Push to VibeReach"}
                  </h3>
                  <span className="text-sm text-gray-700 dark:text-gray-200">
                    <strong className="text-gray-900 dark:text-white">{pushCount.toLocaleString()}</strong> leads
                    selected
                    <span className="text-gray-500 dark:text-gray-400">
                      {" "}
                      ({usingSelection ? "checked rows" : "the current filtered set"})
                    </span>
                  </span>
                  {/* What will ACTUALLY go: the server pushes only rows still marked
                      `loaded` that have a phone, so this is the honest number. */}
                  {!retagMode && !usingSelection && pushEligible != null && pushEligible !== leadCount && (
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      ·{" "}
                      <strong className="text-emerald-700 dark:text-emerald-300">
                        {pushEligible.toLocaleString()}
                      </strong>{" "}
                      pushable
                      <span className="text-gray-500 dark:text-gray-400"> (not yet pushed, has a phone)</span>
                    </span>
                  )}
                  {usingSelection && (
                    <button onClick={() => setSelectedIds(new Set())} className="btn-ghost btn-sm">
                      Clear selection
                    </button>
                  )}
                </div>

                {/* Tags — auto chips are fixed; the free-text ones are yours. */}
                <div className="flex flex-wrap items-center gap-2">
                  <TagIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  {autoTypeTag && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-semibold">
                      {autoTypeTag} <span className="text-gray-400">· auto</span>
                    </span>
                  )}
                  {autoBatchTag ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-semibold">
                      {autoBatchTag} <span className="text-gray-400">· auto</span>
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                      batch tag · auto, per lead
                    </span>
                  )}
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold inline-flex items-center gap-1"
                    >
                      {t}
                      <button onClick={() => setTags((prev) => prev.filter((x) => x !== t))} title={`Remove ${t}`}>
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    className={`${input} w-52`}
                    placeholder="add a campaign tag…"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag(tagDraft);
                      }
                    }}
                    onBlur={() => addTag(tagDraft)}
                  />
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  These tags drive HotProspector: campaigns dial by tag. Tags are forced to lowercase-kebab. The type tag
                  and batch tag are added automatically — <strong>at least one tag of your own is required</strong>, so
                  every push is traceable to a campaign.
                </p>
                {retagMode && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    You've filtered to leads that are <strong>already in VibeReach</strong>, so this run adds the tags
                    above to those existing contacts instead of creating anything — nothing is pushed twice. Their tag
                    list becomes the union of what they had and what you add here.
                  </p>
                )}

                {/* Two-step inline confirm — NO browser popups (house rule). */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      if (pushArmed) void runPush();
                      else setPushArmed(true);
                    }}
                    disabled={pushRunning || plannedPush === 0 || tags.length === 0}
                    title={
                      tags.length === 0
                        ? "Add at least one campaign tag first — the push requires one"
                        : retagMode
                          ? "Add these tags to the contacts already in VibeReach"
                          : "Push this set into VibeReach"
                    }
                    className={`btn-primary inline-flex items-center gap-1.5 ${pushArmed ? "ring-2 ring-amber-400" : ""}`}
                  >
                    <BoltIcon className="w-4 h-4" />
                    {pushRunning
                      ? retagMode
                        ? "Tagging…"
                        : "Pushing…"
                      : pushArmed
                        ? retagMode
                          ? `⚠️ Tap again — tag ${plannedPush.toLocaleString()} contacts in VibeReach →`
                          : `⚠️ Tap again — push ${plannedPush.toLocaleString()} into VibeReach →`
                        : retagMode
                          ? `Tag ${plannedPush.toLocaleString()} already-pushed contacts`
                          : `Push ${plannedPush.toLocaleString()} to VibeReach`}
                  </button>
                  {tags.length === 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Add a campaign tag first — that tag is what the dialer targets.
                    </span>
                  )}
                  {tooBigForIds && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Over {MAX_LEAD_IDS.toLocaleString()} — this run goes from the filters, server-side, and continues
                      in the background.
                    </span>
                  )}
                </div>

                {pushProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-200/60 dark:bg-emerald-900/40">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${pushProgress.total > 0 ? Math.round((pushProgress.done / pushProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      pushed {pushProgress.done.toLocaleString()} / {pushProgress.total.toLocaleString()}…
                    </p>
                  </div>
                )}
                {pushResult && <p className="text-sm text-emerald-700 dark:text-emerald-300">{pushResult}</p>}
                {pushErr && <p className="text-sm text-rose-600 dark:text-rose-400">push failed: {pushErr}</p>}
                <p className="text-[11px] text-gray-400">
                  The push runs as a resumable job: only leads still marked <code>loaded</code> are sent, so a re-push
                  can never create a second contact for the same merchant — it updates the one already in VibeReach.
                  Pushed rows flip to <strong>pushed</strong> with their tags on the row below.
                </p>
              </div>
            )}

            {/* Lead table */}
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-3 px-4 w-8">
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                        }}
                        checked={allOnPageSelected}
                        onChange={toggleSelectAllOnPage}
                        disabled={leads.length === 0}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue disabled:opacity-30"
                        title="Select every lead on this page"
                      />
                    </th>
                    <th className={thSortable} onClick={() => sortBy("company")}>
                      Business{sortArrow("company")}
                    </th>
                    <th className={th}>Contact</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Email</th>
                    <th className={thSortable} onClick={() => sortBy("state")}>
                      State{sortArrow("state")}
                    </th>
                    <th className={thSortable} onClick={() => sortBy("revenue")}>
                      Revenue{sortArrow("revenue")}
                    </th>
                    <th className={th}>Industry</th>
                    <th className={thSortable} onClick={() => sortBy("filing_date")}>
                      Filed{sortArrow("filing_date")}
                    </th>
                    <th className={th}>Status</th>
                    <th className={th}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-400">
                        <MagnifyingGlassIcon className="w-6 h-6 mx-auto mb-1 text-gray-300 dark:text-gray-600" />
                        No leads match these filters.
                      </td>
                    </tr>
                  ) : (
                    leads.map((l) => {
                      const sm = STATUS_META[String(l.status)] ?? STATUS_META.loaded;
                      const checked = selectedIds.has(l.id);
                      return (
                        <tr
                          key={l.id}
                          className={`border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/40 ${
                            checked ? "bg-ocean-blue/5 dark:bg-ocean-blue/10" : ""
                          }`}
                        >
                          <td className="py-2.5 px-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRow(l.id)}
                              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue"
                            />
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-gray-900 dark:text-white max-w-[16rem] truncate">
                            {l.company || "—"}
                            {l.is_dup_of_prior && (
                              <span
                                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                title="This phone already came in on an earlier list — dialing it again is a repeat call"
                              >
                                dupe
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">{fullName(l)}</td>
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            {fmtPhone(l.phone)}
                            {l.line_type && (
                              <span
                                className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                  l.line_type === "mobile"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                                }`}
                              >
                                {l.line_type}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400 max-w-[14rem] truncate">
                            {l.email || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">
                            {l.state || "—"}
                            {l.city && <span className="text-gray-400"> · {l.city}</span>}
                          </td>
                          <td className="py-2.5 px-4 text-gray-900 dark:text-white font-semibold">
                            {fmtMoney(l.revenue)}
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400 max-w-[12rem] truncate">
                            {l.sic_description || "—"}
                            {l.employees != null && <span className="text-gray-400"> · {l.employees} emp</span>}
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {fmtDate(l.filing_date)}
                            {l.secured_party && (
                              <span className="block text-[10px] text-gray-400 truncate max-w-[10rem]">
                                {l.secured_party}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sm.chip}`}>
                              {sm.label}
                            </span>
                            {l.pushed_at && (
                              <span className="block text-[10px] text-gray-400">{fmtDate(l.pushed_at)}</span>
                            )}
                            {l.push_error && (
                              <span
                                className="block text-[10px] text-rose-500 truncate max-w-[10rem]"
                                title={l.push_error}
                              >
                                {l.push_error}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            {(l.push_tags ?? []).length === 0 ? (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-[14rem]">
                                {(l.push_tags ?? []).map((t) => (
                                  <span
                                    key={t}
                                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {leadCount > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>
                  {leadCount.toLocaleString()} leads · page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
