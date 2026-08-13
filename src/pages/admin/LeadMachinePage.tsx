import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
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
import { exportToCsv } from "@/lib/csv";

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
  /* From the lead_batch_overview view — per-batch aggregates over lead_records,
     so the batch table never counts 85k rows in the browser. Undefined when the
     row came straight off lead_batches (the ingest poller). */
  records?: number | null;
  dialable?: number | null;
  pushed?: number | null;
  errored?: number | null;
  skipped?: number | null;
  dup_of_prior?: number | null;
  /* When the maintained counters were last recomputed. They're kept current by
     the ingest/push functions; this only drifts if something else writes
     lead_records, so it's shown as a quiet note, not a warning. */
  counts_refreshed_at?: string | null;
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
    tag: "lm-ucc",
    columns: "business name, owner first/last, phone, email, address, city, state, zip, filing date, secured party",
  },
  {
    type: "aged",
    label: "Aged Leads",
    blurb: "Older applications resold at a discount — volume dialing, low cost per lead.",
    tag: "lm-aged",
    columns: "business name, owner first/last, phone, email, city, state, zip, monthly revenue, lead date",
  },
  {
    type: "trigger",
    label: "Trigger Leads",
    blurb: "Businesses that just took an action signalling a capital need — dial these first.",
    tag: "lm-trigger",
    columns: "business name, owner first/last, phone, email, city, state, zip, revenue, employees, SIC description",
  },
];

const TYPE_META: Record<string, { label: string; tag: string; chip: string }> = {
  ucc: {
    label: "UCC",
    tag: "lm-ucc",
    chip: "bg-ocean-blue/10 text-ocean-blue",
  },
  aged: {
    label: "Aged",
    tag: "lm-aged",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  trigger: {
    label: "Trigger",
    tag: "lm-trigger",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

const STATUS_META: Record<string, { label: string; chip: string }> = {
  loaded: { label: "loaded", chip: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  pushed: { label: "✓ pushed", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  skipped: { label: "skipped", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  error: { label: "error", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

/* Which list types actually CARRY each field — measured on the real book, not
   assumed. Filtering on a field a list doesn't have silently excludes every row
   of that list, which reads as "there are no Texas aged leads" when the truth is
   "aged files have no state column at all". The filter bar says so out loud. */
const FIELD_ONLY_ON: Record<string, { types: LeadType[]; label: string }> = {
  state: { types: ["ucc"], label: "UCC lists only" },
  city: { types: ["ucc"], label: "UCC lists only" },
  revenue: { types: ["ucc", "trigger"], label: "UCC + trigger only" },
  secured_party: { types: ["ucc"], label: "UCC lists only" },
};

/* Hardcoded so no DISTINCT ever runs over 250k rows (house law: aggregates come
   from counters, never from scans). Line types are stored VERBATIM as the vendor
   wrote them — capitalised — so these values must match exactly; only the label
   is prettified. */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI",
  "MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];
const LINE_TYPES: { value: string; label: string }[] = [
  { value: "Mobile", label: "Mobile" },
  { value: "Landline", label: "Landline" },
  { value: "Voip", label: "VoIP" },
  { value: "Toll-Free", label: "Toll-Free" },
];

const PAGE_SIZE = 25;
/* lead-push-ghl caps an explicit lead_ids[] at 5,000 — bigger sets have to go as
   server-side `filters`, which the fn re-runs itself. */
const MAX_LEAD_IDS = 5000;
/* Rows fetched per page while streaming an export. 85k rows = 85 round trips. */
const EXPORT_WINDOW = 1000;
/* PostgREST puts filters in the URL, so an `in.(...)` list has to stay short. */
const ID_WINDOW = 300;

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

/** Date + time, for the "counts as of …" stamp. */
function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

/** Normalise a search term for `search_text`. A term that is clearly a phone
 *  ("(305) 555-1212") is reduced to bare digits, because phones are stored as a
 *  bare last-10 and the punctuation would match nothing. Everything else just
 *  loses the characters that confuse a LIKE pattern. */
function searchTerm(s: string): string {
  const trimmed = s.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 7 && /^[\d\s()+.-]+$/.test(trimmed)) return digits.slice(-10);
  return trimmed.replace(/[%_\\]/g, " ").trim();
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

  /* The one ingest path — both the file upload and the already-in-the-bucket
     files land here. The FUNCTION creates the batch row (batch_code comes from
     next_lead_batch_code server-side), so nothing is pre-inserted here. */
  const beginIngest = async (opts: {
    storagePath: string;
    leadType: LeadType;
    label?: string | null;
    fileName?: string;
    fileSize?: number;
  }) => {
    setPhase("ingesting");
    setUploadMsg("Starting ingest…");
    const { data, error } = await supabase.functions.invoke("lead-file-ingest", {
      body: {
        action: "start",
        storage_path: opts.storagePath,
        lead_type: opts.leadType,
        label: opts.label || null,
        ...(opts.fileName ? { file_name: opts.fileName } : {}),
        ...(opts.fileSize ? { file_size: opts.fileSize } : {}),
      },
    });
    if (error) throw new Error(await fnErrorMessage(error));
    const res = data as { ok?: boolean; batch_id?: string; batch_code?: string; error?: string } | null;
    if (res?.ok === false || !res?.batch_id) throw new Error(res?.error || "ingest did not start");
    pollBatch(res.batch_id);
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
      await beginIngest({
        storagePath: path,
        leadType: type,
        label: label.trim(),
        fileName: file.name,
        fileSize: file.size,
      });
    } catch (e) {
      setPhase("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const ingestStaged = async (f: StagedFile) => {
    setErr(null);
    setBatch(null);
    try {
      await beginIngest({
        storagePath: f.path,
        leadType: f.leadType,
        label: f.name,
        fileName: f.name.split("/").pop(),
        fileSize: f.size ?? undefined,
      });
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

  /* Ingest counters, with the semantics the backend actually writes:
       total_rows    — data rows read from the file (ticks during the run)
       dup_rows      — rows dropped as an IN-FILE duplicate phone (finalize only)
       ingested_rows — rows stored = total − dup (finalize only). Includes rows
                       with no phone; those are stored as status='skipped'.
     ingested_rows / dup_rows are written at finalize, so they are only rendered
     once the batch is `ready`. Bytes are the honest progress bar until then. */
  const running = phase === "ingesting";
  const total = n0(batch?.total_rows);
  const ingested = n0(batch?.ingested_rows);
  const dupes = n0(batch?.dup_rows);
  const bytesTotal = n0(batch?.bytes_total);
  const pct = bytesTotal > 0 ? Math.min(100, Math.round((n0(batch?.byte_offset) / bytesTotal) * 100)) : null;

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
                disabled={phase === "uploading" || running}
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
                  One file per batch. Only a phone column is required — everything else is mapped when it's there.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Batch code:{" "}
                <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100 font-semibold">
                  {plannedCode}
                </code>{" "}
                <span className="text-gray-400">
                  — the server mints the final code (a second list the same day gets a -2).
                </span>
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

            {/* Files already sitting in the bucket — no re-upload needed. */}
            <StagedFiles onIngest={ingestStaged} />
          </>
        ) : phase === "uploading" ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">{uploadMsg}</p>
        ) : running ? (
          <div className="space-y-1.5">
            {pct != null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-ocean-blue transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {total > 0 ? `Read ${total.toLocaleString()} rows so far…` : batch?.message || uploadMsg || "Ingesting…"}
              {pct != null && <span className="text-gray-400"> · {pct}% of the file</span>}
            </p>
            <p className="text-[11px] text-gray-400">
              This keeps running if you leave the page — the batch below shows the result either way.
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
              {total.toLocaleString()} rows read · {dupes.toLocaleString()} dropped as duplicate phones inside the file
              · {ingested.toLocaleString()} stored. How many of those are dialable is in the batch row below.
            </p>
            <button onClick={reset} className="text-xs text-ocean-blue hover:underline">
              Load another list
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Files already in the lead-uploads bucket ──────────────────────────────────
   The owner's purchased files get dropped into the bucket directly; ingesting one
   needs no re-upload, just a lead_type and its path. Anything already ingested is
   shown as such (matched on storage_path) so the same file isn't loaded twice. */
interface StagedFile {
  path: string;
  name: string;
  size: number | null;
  leadType: LeadType;
}

/** Guess the list type from the filename — the owner's files are named for it. */
function guessType(name: string): LeadType {
  const n = name.toLowerCase();
  if (n.includes("ucc")) return "ucc";
  if (n.includes("trigger") || n.includes("trig")) return "trigger";
  return "aged";
}

function StagedFiles({ onIngest }: { onIngest: (f: StagedFile) => void }) {
  const [files, setFiles] = useState<StagedFile[] | null>(null);
  const [ingestedPaths, setIngestedPaths] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.storage.from("lead-uploads").list("raw", {
        limit: 50,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (cancelled) return;
      if (error || !data) {
        setFiles([]);
        return;
      }
      const list = data
        .filter((o) => o.name.toLowerCase().endsWith(".csv"))
        .map((o) => ({
          path: `raw/${o.name}`,
          name: o.name,
          size: (o.metadata?.size as number | undefined) ?? null,
          leadType: guessType(o.name),
        }));
      setFiles(list);
      // Which of these already produced a batch — so "load" isn't offered twice.
      if (list.length > 0) {
        const { data: done } = await supabase
          .from("lead_batches")
          .select("storage_path")
          .in("storage_path", list.map((f) => f.path));
        if (!cancelled && done) {
          setIngestedPaths(new Set((done as { storage_path: string | null }[]).map((d) => d.storage_path ?? "")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!files || files.length === 0) return null;

  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Already in the bucket — no upload needed
      </p>
      {files.map((f) => {
        const already = ingestedPaths.has(f.path);
        const meta = TYPE_META[f.leadType];
        return (
          <div key={f.path} className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded-full font-semibold ${meta.chip}`}>{meta.label}</span>
            <span className="text-gray-700 dark:text-gray-200 font-medium">{f.name}</span>
            {f.size != null && (
              <span className="text-gray-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
            )}
            {already ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ already loaded</span>
            ) : (
              <button
                onClick={() => {
                  if (armed === f.path) {
                    setArmed(null);
                    onIngest(f);
                  } else setArmed(f.path);
                }}
                className={`btn-ghost btn-sm ${armed === f.path ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-ocean-blue"}`}
                title={`Ingest ${f.name} as a ${meta.label} list`}
              >
                {armed === f.path ? "⚠️ Tap again — load it →" : "Load into Supabase"}
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-gray-400">
        Type is read from the filename. A file that already produced a batch is marked, so nothing gets loaded twice.
      </p>
    </div>
  );
}

/* ── The process, at a glance ─────────────────────────────────────────────────
   The one thing that confuses people here is WHEN tags happen: they are not on
   the file and not on the upload — they're chosen per SLICE at push time. This
   strip exists to make that unmissable, so it leads the page. */
function ProcessStrip() {
  const steps: {
    key: string;
    title: string;
    sub: string;
    chip?: string;
    chipClass?: string;
    tone: string;
    arrow?: string;
  }[] = [
    {
      key: "csv",
      title: "Raw CSV",
      sub: "the list you bought",
      tone: "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800",
      arrow: "upload / load a staged file",
    },
    {
      key: "supabase",
      title: "Supabase",
      sub: "staged as a batch — e.g. UCC-20260813",
      chip: "no tags yet · nothing sent anywhere",
      chipClass: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
      tone: "border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10",
      arrow: "you filter a slice — state, revenue, line type…",
    },
    {
      key: "push",
      title: "Tag + Push",
      sub: "lm-<type> + batch tag (inert), plus your campaign tag — that one dials",
      chip: "⬅ tags are applied HERE",
      chipClass: "bg-amber-500 text-white",
      tone: "border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-400",
      arrow: "contacts land tagged",
    },
    {
      key: "vibereach",
      title: "VibeReach",
      sub: "the contact record, carrying its tags",
      tone: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20",
      arrow: "HotProspector syncs by tag",
    },
    {
      key: "dial",
      title: "The dialer",
      sub: "the campaign dials that tag",
      tone: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20",
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {steps.map((st, i) => (
          <div key={st.key} className="flex items-stretch gap-1 shrink-0">
            <div className={`w-44 rounded-xl border p-3 flex flex-col justify-between ${st.tone}`}>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{st.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-600 dark:text-gray-300">{st.sub}</p>
              </div>
              {st.chip && (
                <span
                  className={`mt-2 inline-block self-start text-[10px] px-1.5 py-0.5 rounded-full font-bold ${st.chipClass}`}
                >
                  {st.chip}
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className="flex flex-col items-center justify-center w-28 shrink-0 px-1">
                <span className="text-[10px] leading-tight text-center text-gray-500 dark:text-gray-400">
                  {st.arrow}
                </span>
                <span className="text-gray-400 dark:text-gray-500 text-lg leading-none">→</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
        <li>
          • Uploading applies <strong>no tags</strong> and sends nothing — it just stages the rows here.
        </li>
        <li>
          • Tags are chosen when you <strong>push a filtered slice</strong> — different slices of one file can go to
          different campaigns with different tags.
        </li>
        <li>
          • Every pushed lead always carries its <strong>lm-type tag + batch tag</strong> automatically — those are
          provenance and dial nothing — plus your campaign tag, which is the one a dialer campaign targets.
        </li>
      </ul>
    </section>
  );
}

/* ================================================================== */
/* The page                                                            */
/* ================================================================== */
export default function LeadMachinePage() {
  const [backendMissing, setBackendMissing] = useState(false);

  /* ── Batches ── */
  const [batches, setBatches] = useState<LeadBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);

  const [batchesError, setBatchesError] = useState<string | null>(null);

  /* Read the VIEW. It used to aggregate lead_records live per batch — 10.3s
     against an 8s statement_timeout, so it failed 100% of the time and rendered
     as "No lists uploaded yet". It now serves maintained counters off the 3-row
     lead_batches table and never touches lead_records: measured 7.2ms.

     Do NOT go back to counting per batch in the client: `count(*) where
     batch_id=… and phone is not null` measured 4.5s PER BATCH even as superuser,
     because it walks 80k rows — and under RLS each of those rows additionally
     costs an is_admin_or_super() call. A selective predicate with a LIMIT is
     cheap here; anything that touches the whole book is not. */
  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    const { data, error } = await supabase
      .from("lead_batch_overview")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setBatchesLoading(false);
    if (error) {
      if (isMissingRelation(error)) {
        setBackendMissing(true);
        return;
      }
      // An error is NOT an empty list. Keep whatever we last had on screen and
      // say what went wrong — never fall through to the empty state.
      setBatchesError(
        /timeout|57014|canceling statement/i.test(error.message || "")
          ? "the batch list took too long and the server cut it off — try again"
          : error.message || "could not load the batch list",
      );
      return;
    }
    setBackendMissing(false);
    setBatchesError(null);
    setBatches((data as LeadBatch[]) ?? []);
  }, []);

  /* The counters are maintained by the ingest/push functions, so anything that
     writes lead_records outside them (a manual fix, a reset) leaves them stale.
     This recalculates ONE batch on demand — it scans that batch (~3s on 85k),
     which is why it's an explicit action and never on a timer. */
  const [refreshingBatch, setRefreshingBatch] = useState<string | null>(null);
  const recountBatch = useCallback(
    async (batchId: string) => {
      setRefreshingBatch(batchId);
      const { error } = await supabase.rpc("lead_batch_refresh_counts", { p_batch_id: batchId });
      setRefreshingBatch(null);
      if (error) {
        setBatchesError(`recount failed: ${error.message}`);
        return;
      }
      await loadBatches();
    },
    [loadBatches],
  );

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  /* A batch that's still ingesting keeps changing, so poll the list until every
     batch is terminal, then stop. No timer at all in the steady state. */
  const anyIngesting = useMemo(
    () => batches.some((b) => ["uploaded", "ingesting"].includes((b.status || "").toLowerCase())),
    [batches],
  );
  useEffect(() => {
    if (!anyIngesting) return;
    const t = setInterval(() => void loadBatches(), 5000);
    return () => clearInterval(t);
  }, [anyIngesting, loadBatches]);

  /* ── Lead browser filters ── */
  const [fTypes, setFTypes] = useState<LeadType[]>([]);
  const [fBatch, setFBatch] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [fStates, setFStates] = useState<string[]>([]);
  const [fLines, setFLines] = useState<string[]>([]);
  const [fRevMin, setFRevMin] = useState("");
  const [fRevMax, setFRevMax] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fHasEmail, setFHasEmail] = useState(false);
  const [fSecured, setFSecured] = useState("");
  const [stateDraft, setStateDraft] = useState("");
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
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* The batch a filter is pinned to (drives the batch tag chip + the batch table
     highlight). Only meaningful when exactly one batch is selected. */
  const pinnedBatch = useMemo(() => batches.find((b) => b.id === fBatch) ?? null, [batches, fBatch]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (fTypes.length) n++;
    if (fBatch) n++;
    if (dSearch.trim()) n++;
    if (fStates.length) n++;
    if (fLines.length) n++;
    if (dRevMin.trim()) n++;
    if (dRevMax.trim()) n++;
    if (fStatus) n++;
    if (fHasEmail) n++;
    if (dSecured.trim()) n++;
    if (dTag.trim()) n++;
    if (!fExcludeDups) n++; // "include duplicates" is the deviation from default
    return n;
  }, [fTypes, fBatch, dSearch, fStates, fLines, dRevMin, dRevMax, fStatus, fHasEmail, dSecured, dTag, fExcludeDups]);

  const clearFilters = useCallback(() => {
    setFTypes([]);
    setFBatch("");
    setFSearch("");
    setFStates([]);
    setFLines([]);
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
    (select: string, opts: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {}) => {
      let q = supabase
        .from("lead_records")
        .select(select, opts)
        .order(sortKey, { ascending: sortAsc, nullsFirst: false })
        // TIEBREAKER, and it is not optional. The ingester inserts in windows, so
        // a THOUSAND rows share one created_at (verified on the live book) and
        // revenue/state tie even harder. Without a unique final sort key, Postgres
        // is free to return ties in any order, and every paged read — the table's
        // Next button, the export walk, the push id-gather — would silently
        // duplicate some rows and skip others. The PK makes the order total.
        .order("id", { ascending: true });
      if (fTypes.length) q = q.in("lead_type", fTypes);
      if (fBatch) q = q.eq("batch_id", fBatch);
      if (fStates.length) q = q.in("state", fStates);
      if (fLines.length) q = q.in("line_type", fLines);
      if (fStatus) q = q.eq("status", fStatus);
      if (fHasEmail) q = q.not("email", "is", null);
      if (fExcludeDups) q = q.eq("is_dup_of_prior", false);
      if (dRevMin.trim() && !isNaN(Number(dRevMin))) q = q.gte("revenue", Number(dRevMin));
      if (dRevMax.trim() && !isNaN(Number(dRevMax))) q = q.lte("revenue", Number(dRevMax));
      if (dSecured.trim()) q = q.ilike("secured_party", `%${dSecured.trim()}%`);
      // Tag containment hits the push_tags GIN index — the same filter the push fn runs.
      if (dTag.trim()) q = q.contains("push_tags", [kebab(dTag)]);
      // ONE predicate against the generated `search_text` column (first/last/
      // company/email/phone concatenated), which carries a GIN trigram index.
      // The old 5-column OR could use no index at all — measured 2,474ms against
      // 358ms — and on a loaded server that was enough to blow the 8s statement
      // timeout and surface as "no leads match".
      const t = searchTerm(dSearch);
      if (t) q = q.ilike("search_text", `%${t}%`);
      return q;
    },
    [
      fTypes,
      fBatch,
      fStates,
      fLines,
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
    // ESTIMATED, not exact. An exact count is a full scan of every matching row —
    // measured at 3.8s on the live 193k-row book, on top of the page fetch. The
    // planner's estimate is instant and is only ever used to size the pager and
    // label the browse; the number the PUSH promises comes from lead-push-ghl's
    // own count action, which is exact by construction.
    /* NO count option on this request — not even "estimated". PostgREST's
       estimated count silently falls back to an EXACT count when the planner's
       estimate is small, and an exact count here scans the whole book with the
       RLS predicate evaluated per row (~250k is_admin_or_super() calls). That
       blows the 8s statement timeout and takes the ROWS DOWN WITH IT, because
       it's the same request — which is how a healthy 48ms page turned into an
       error banner. Rows are fetched alone; the number arrives separately. */
    const { data, error } = await buildFilteredQuery(LEAD_SELECT).range(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE - 1,
    );
    setLeadsLoading(false);
    if (error) {
      if (isMissingRelation(error)) {
        setBackendMissing(true);
        return;
      }
      // A failed fetch is NOT "no leads match". Keep the last good page on
      // screen and say what happened.
      setLeadsError(
        /timeout|57014|canceling statement/i.test(error.message || "")
          ? "that query took too long and the server cut it off — narrow the filters, or try again"
          : error.message || "could not load leads",
      );
      return;
    }
    setLeadsError(null);
    const rows = (data as unknown as LeadRecord[]) ?? [];

    // An empty page PAST the end is a paging artifact, not a result.
    if (rows.length === 0 && page > 0) {
      setPage((p) => Math.max(0, p - 1));
      return;
    }
    setLeads(rows);
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
    fTypes,
    fBatch,
    dSearch,
    fStates,
    fLines,
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

  /* The count is an ESTIMATE (see loadLeads), so pagination can't be derived from
     it alone — an over-estimate would offer a page that doesn't exist, an
     under-estimate would hide the tail. "Next" therefore keys off whether THIS
     page came back full, which is always true. */
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [countingPush, setCountingPush] = useState(false);
  const [countError, setCountError] = useState(false);

  const totalPages = filteredCount == null ? null : Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const hasNextPage = leads.length === PAGE_SIZE;

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

  /* A tag typed into the box but not yet committed (no Enter / comma / blur)
     still counts. Without this, typing a tag and clicking Push does NOTHING the
     first time: the blur that commits the tag happens on the same mouse press
     that lands on a still-disabled button, so the click is swallowed. */
  const effectiveTags = useMemo(() => {
    if (tags.length > 0) return tags;
    const pending = kebab(tagDraft);
    return pending ? [pending] : [];
  }, [tags, tagDraft]);

  const addTag = (raw: string) => {
    const k = kebab(raw);
    if (!k) return;
    setTags((prev) => (prev.includes(k) ? prev : [...prev, k]));
    setTagDraft("");
  };

  /* What the push will actually touch: the checkbox subset when one exists,
     otherwise the whole filtered set. */
  const usingSelection = selectedIds.size > 0;
  const pushCount = usingSelection ? selectedIds.size : (filteredCount ?? 0);

  /* THE ONE COUNT, and it never rides along with a data request.

     lead-push-ghl {action:'count'} runs server-side under the service role, so
     it pays no per-row RLS cost, and it runs the IDENTICAL filter code the push
     runs — so the number on screen and the number pushed agree by construction.
     It resolves independently of the rows: while it's in flight the header
     shows "…", and if it fails the table is untouched. */
  /* The same filter set, in the shape lead-push-ghl runs server-side. Every
     control on the filter bar has a server equivalent, so a set too big for an
     explicit id list still pushes as exactly what's on screen. */
  const serverFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (fTypes.length) f.lead_type = fTypes; // the fn accepts string | string[]
    if (fStates.length) f.state = fStates; // the fn accepts string | string[]
    if (fLines.length) f.line_type = fLines;
    if (fStatus) f.status = fStatus;
    if (fHasEmail) f.has_email = true;
    if (dRevMin.trim() && !isNaN(Number(dRevMin))) f.min_revenue = Number(dRevMin);
    if (dRevMax.trim() && !isNaN(Number(dRevMax))) f.max_revenue = Number(dRevMax);
    if (dSecured.trim()) f.secured_party_ilike = dSecured.trim();
    if (dTag.trim()) f.push_tags_contains = kebab(dTag);
    if (searchTerm(dSearch)) f.search = searchTerm(dSearch);
    if (fExcludeDups) f.exclude_dups = true;
    return f;
  }, [fTypes, fStates, fLines, fStatus, fHasEmail, dRevMin, dRevMax, dSecured, dTag, dSearch, fExcludeDups]);

  /* RE-TAG. A normal push drains rows still marked `loaded` — which is exactly
     what makes it un-double-pushable, and also means it would find nothing in a
     slice that's already been pushed. Filtering to pushed/errored leads is only
     ever asking for the other thing: add these tags to contacts already in
     VibeReach. So that filter selects re-tag mode, and the panel says so. */
  const retagMode = fStatus === "pushed" || fStatus === "error";

  /* Ask the function for the count whenever the filter set changes. Debounced,
     cancelled on change, and completely decoupled from the row fetch. */
  useEffect(() => {
    if (backendMissing || pushRunning) return;
    let cancelled = false;
    setCountingPush(true);
    setCountError(false);
    const t = setTimeout(() => {
      void (async () => {
        const body: Record<string, unknown> = { action: "count", filters: serverFilters };
        if (fBatch) body.batch_id = fBatch;
        if (retagMode) body.retag = true;
        /* Broad counts (e.g. two line types = 237k rows) scan without an index
           and land near the server's limit, so they fail intermittently — seen
           live: one failure, then three identical successes. One retry turns
           that blip into a non-event. Rows are unaffected either way. */
        const ask = async () => {
          const { data, error } = await supabase.functions.invoke("lead-push-ghl", { body });
          const res = (data as { ok?: boolean; count?: number } | null) ?? null;
          return error || !res || typeof res.count !== "number" ? null : res.count;
        };
        let n = await ask();
        if (n == null && !cancelled) {
          await new Promise((r) => setTimeout(r, 1200));
          if (!cancelled) n = await ask();
        }
        if (cancelled) return;
        setCountingPush(false);
        if (n == null) {
          setCountError(true);
          return;
        }
        setFilteredCount(n);
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [serverFilters, fBatch, retagMode, backendMissing, pushRunning]);

  /* The count the button promises. In re-tag mode already-pushed rows ARE the
     target, so the "still loaded" eligibility count doesn't apply. */
  const plannedPush = usingSelection ? selectedIds.size : (filteredCount ?? 0);
  const tooBigForIds = !usingSelection && plannedPush > MAX_LEAD_IDS;

  /* The auto tags the edge fn adds server-side, shown as fixed chips so the
     closer/owner sees the full tag set before firing. */
  const autoTypeTag = fTypes.length === 1 ? TYPE_META[fTypes[0]]?.tag : null;
  const autoBatchTag = pinnedBatch?.batch_code ? kebab(pinnedBatch.batch_code) : null;

  /* ── CSV export ─────────────────────────────────────────────────────────────
     Exports the CURRENT filtered set (or the checkbox selection) — every page,
     not the 25 on screen. Rows stream in a page at a time so an 85k-row pull
     shows real progress instead of hanging. Two shapes:
       · "email campaign" — the columns an email tool wants, has-email forced on
       · "full"           — every stored column
     Both always carry batch_code, lead_type and the tags, because a slice is
     useless if you can't tell which list and which push it came from. */
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  /* batch_id → batch_code for the export's Batch column. Read once off the batch
     list (small table) rather than embedding a join into an 85k-row scan. */
  const batchCodeById = useMemo(() => {
    const m = new Map<string, string>();
    batches.forEach((b) => m.set(b.id, b.batch_code));
    return m;
  }, [batches]);

  /* A short, readable name for what's being exported: the batch code if one is
     pinned, else the type, else "leads". */
  const exportSlug = useMemo(() => {
    if (pinnedBatch?.batch_code) return kebab(pinnedBatch.batch_code);
    if (fTypes.length === 1) return fTypes[0];
    if (fTypes.length > 1) return fTypes.join("-");
    return "leads";
  }, [pinnedBatch, fTypes]);

  const runExport = useCallback(
    async (preset: "email" | "full") => {
      setExportErr(null);
      setExportNote(null);
      setExportProgress({ done: 0, total: 0 });
      try {
        const emailOnly = preset === "email";
        // The email preset FORCES has-email in the query itself rather than
        // relying on a state update landing first — and mirrors it into the
        // filter bar so the screen agrees with the file.
        if (emailOnly && !fHasEmail) setFHasEmail(true);

        const ids = usingSelection ? Array.from(selectedIds) : null;
        const rows: LeadRecord[] = [];

        if (ids) {
          setExportProgress({ done: 0, total: ids.length });
          for (let i = 0; i < ids.length; i += ID_WINDOW) {
            let q = supabase.from("lead_records").select(LEAD_SELECT).in("id", ids.slice(i, i + ID_WINDOW));
            if (emailOnly) q = q.not("email", "is", null);
            const { data, error } = await q;
            if (error) throw error;
            rows.push(...((data as unknown as LeadRecord[]) ?? []));
            setExportProgress({ done: Math.min(i + ID_WINDOW, ids.length), total: ids.length });
          }
        } else {
          // No count query at all — see loadLeads. The bar grows against what
          // has actually been fetched, and the total firms up as pages arrive.
          const total = 0;
          setExportProgress({ done: 0, total });
          // Page over the deterministic sort. (A keyset walk on the PK was tried
          // and is WORSE here: the PK is a random uuid, so ordering by it makes
          // the planner abandon the selective filter index and scan the heap in
          // random order — measured 16s for one page vs 2.3s this way.)
          for (let offset = 0; ; offset += EXPORT_WINDOW) {
            let q = buildFilteredQuery(LEAD_SELECT).range(offset, offset + EXPORT_WINDOW - 1);
            if (emailOnly) q = q.not("email", "is", null);
            const { data, error } = await q;
            if (error) throw error;
            const page = (data as unknown as LeadRecord[]) ?? [];
            rows.push(...page);
            setExportProgress({ done: rows.length, total: Math.max(total, rows.length) });
            if (page.length < EXPORT_WINDOW) break; // drained
          }
        }

        if (rows.length === 0) {
          setExportNote(
            emailOnly
              ? "Nothing to export — no lead in this set has an email address."
              : "Nothing to export — no lead matches these filters.",
          );
          return;
        }

        const tagsOf = (l: LeadRecord) => (l.push_tags ?? []).join(";");
        const batchOf = (l: LeadRecord) => (l.batch_id ? (batchCodeById.get(l.batch_id) ?? "") : "");

        const flat: Record<string, unknown>[] = emailOnly
          ? rows.map((l) => ({
              email: l.email ?? "",
              first_name: l.first_name ?? "",
              last_name: l.last_name ?? "",
              company: l.company ?? "",
              state: l.state ?? "",
              lead_type: l.lead_type ?? "",
              batch_code: batchOf(l),
              tags: tagsOf(l),
            }))
          : rows.map((l) => ({
              batch_code: batchOf(l),
              lead_type: l.lead_type ?? "",
              company: l.company ?? "",
              first_name: l.first_name ?? "",
              last_name: l.last_name ?? "",
              phone: l.phone ?? "",
              line_type: l.line_type ?? "",
              email: l.email ?? "",
              city: l.city ?? "",
              state: l.state ?? "",
              zip: l.zip ?? "",
              revenue: l.revenue ?? "",
              employees: l.employees ?? "",
              sic_description: l.sic_description ?? "",
              filing_date: l.filing_date ?? "",
              secured_party: l.secured_party ?? "",
              is_dup_of_prior: l.is_dup_of_prior ? "yes" : "no",
              status: l.status ?? "",
              pushed_at: l.pushed_at ?? "",
              ghl_contact_id: l.ghl_contact_id ?? "",
              tags: tagsOf(l),
            }));

        // e.g. ucc-20260813-emails-20260814.csv
        const name = `${exportSlug}-${emailOnly ? "emails" : "full"}-${todayCode()}.csv`;
        exportToCsv(name, flat);
        setExportNote(`${flat.length.toLocaleString()} rows exported to ${name}`);
      } catch (e) {
        setExportErr(e instanceof Error ? e.message : String(e));
      } finally {
        setExportProgress(null);
      }
    },
    [batchCodeById, buildFilteredQuery, exportSlug, fHasEmail, selectedIds, usingSelection],
  );

  const runPush = useCallback(async () => {
    setPushArmed(false);
    setPushRunning(true);
    setPushErr(null);
    setPushResult(null);
    setPushProgress({ done: 0, total: plannedPush });
    try {
      // The fn REQUIRES a non-empty tags[] — the auto tags it adds server-side
      // don't satisfy it, so the UI blocks the button until there's at least one.
      if (effectiveTags.length === 0) throw new Error("Add at least one tag before pushing.");

      // How the set is expressed to the server:
      //   · a checkbox selection, or any set that fits, goes as explicit ids —
      //     that honours EVERY on-screen filter, search included;
      //   · a bigger set goes as server-side filters, which the fn re-runs and
      //     self-continues through — every filter here has a server equivalent.
      const body: Record<string, unknown> = { action: "start", tags: effectiveTags };
      if (retagMode) body.retag = true;
      // ALWAYS forward the status filter, even on the id path. The fn resolves
      // status as: filters.status → exactly that set; else retag → widens to
      // loaded|pushed|error; else loaded. Sending retag without a status would
      // therefore silently widen the run past what the browser showed.
      if (fStatus) body.filters = { status: fStatus };
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
        // serverFilters already carries status, so this supersedes the stub above.
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
        const tagList = [autoTypeTag, autoBatchTag, ...effectiveTags].filter(Boolean).join(", ");
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
    fStatus,
    loadBatches,
    loadLeads,
    plannedPush,
    selectedIds,
    effectiveTags,
    retagMode,
    serverFilters,
    tooBigForIds,
    usingSelection,
  ]);

  const input =
    "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  /* Warn when an ACTIVE filter can only ever match some list types — without it
     the empty result looks like "no such leads" instead of "wrong list type". */
  const narrowingFilters = useMemo(() => {
    const active: string[] = [];
    if (fStates.length) active.push("state");
    if (dRevMin.trim() || dRevMax.trim()) active.push("revenue");
    if (dSecured.trim()) active.push("secured_party");
    // Types actually in play: the selection, or all three when nothing is picked.
    const inPlay: LeadType[] = fTypes.length ? fTypes : ["ucc", "aged", "trigger"];
    return active
      .map((f) => ({ field: f, ...FIELD_ONLY_ON[f] }))
      .filter((f) => f.types && !inPlay.every((t) => f.types.includes(t)));
  }, [fStates, dRevMin, dRevMax, dSecured, fTypes]);

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

      {/* The model, before anything else: where tags come from. */}
      <ProcessStrip />

      {/* Naming convention — the one rule that makes the tags dialable. */}
      <div className="rounded-xl border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 px-4 py-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
        <p className="font-semibold text-gray-800 dark:text-gray-100">How lists are named and tagged</p>
        <p>
          Every batch is <code className="px-1 rounded bg-white/70 dark:bg-gray-800">TYPE-YYYYMMDD</code> —{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">UCC-{todayCode()}</code>,{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">AGED-{todayCode()}</code>,{" "}
          <code className="px-1 rounded bg-white/70 dark:bg-gray-800">TRIG-{todayCode()}</code>. Every pushed contact
          gets the <strong>type tag</strong> (<code>lm-ucc</code> / <code>lm-aged</code> / <code>lm-trigger</code>),
          the <strong>batch tag</strong>, plus <strong>your campaign tags</strong>.
        </p>
        <p>
          The <code>lm-*</code> tags are <strong>provenance only — they are inert and dial nothing</strong>. Dialing is
          driven <strong>only by the campaign tag you type</strong>, so a list sits harmlessly in VibeReach until you
          point a HotProspector campaign at your own tag.
        </p>
        <p>
          <strong className="text-gray-800 dark:text-gray-100">Exports</strong> follow the same filters as the push, and
          always carry <code>batch_code</code>, <code>lead_type</code> and a <code>tags</code> column (semicolon-
          separated), so an exported slice can always be traced back to the list and the push it came from.
        </p>
        <p className="text-gray-400">
          Different surface from{" "}
          <Link to="/admin/lead-import" className="text-ocean-blue hover:underline">
            Lead Import
          </Link>
          , which maps a CSV onto merchants/deals for the closer pipeline. This one is bulk lists for outbound dialing.
        </p>
      </div>

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
                    <th className={th}>Rows read</th>
                    <th className={th}>Stored</th>
                    <th className={th}>Dialable</th>
                    <th className={th}>Pushed</th>
                    <th className={th}>No phone</th>
                    <th className={th}>Seen before</th>
                    <th className={th}>Status</th>
                    <th className={th}>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {batchesLoading && batches.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : batchesError && batches.length === 0 ? (
                    /* A FAILED query is not an empty list. This must never read
                       as "no lists uploaded" — that wording is reserved for a
                       result the server actually confirmed was empty. */
                    <tr>
                      <td colSpan={11} className="py-6 px-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
                          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                          <span>
                            <strong>Couldn't load your lists</strong> — this is a load failure, not an empty account.
                            Your batches are still there. ({batchesError})
                          </span>
                          <button onClick={() => void loadBatches()} className="btn-ghost btn-sm">
                            Try again
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : batches.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-400">
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
                      /* Mid-ingest, total_rows is a lagging checkpoint and the
                         finalize-only counters (ingested_rows / dup_rows) are
                         still 0 — so the stored/dialable/skipped columns only
                         mean anything once the batch is terminal. Seen live:
                         a running batch read "20,000 read / 28,000 stored". */
                      const settled = !["uploaded", "ingesting"].includes(st);

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
                            {!settled && <span className="text-gray-400"> so far</span>}
                            {settled && n0(b.dup_rows) > 0 && (
                              <span
                                className="block text-[10px] text-gray-400"
                                title="Rows dropped because the same phone appeared earlier in this same file"
                              >
                                −{n0(b.dup_rows).toLocaleString()} dupes in file
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-gray-900 dark:text-white font-semibold">
                            {settled ? n0(b.records).toLocaleString() : <span className="text-gray-400">—</span>}
                          </td>
                          <td
                            className="py-2.5 px-4 text-gray-900 dark:text-white font-semibold"
                            title="Has a phone number — the only rows the push can send"
                          >
                            {settled ? n0(b.dialable).toLocaleString() : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-2.5 px-4 text-emerald-600 dark:text-emerald-400 font-semibold">
                            {n0(b.pushed).toLocaleString()}
                            {n0(b.errored) > 0 && (
                              <span className="block text-[10px] text-rose-500">
                                {n0(b.errored).toLocaleString()} errored
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400">
                            {settled ? n0(b.skipped).toLocaleString() : <span className="text-gray-400">—</span>}
                          </td>
                          <td
                            className="py-2.5 px-4 text-gray-500 dark:text-gray-400"
                            title="Phone already seen in an earlier batch (or in the UCC pool) — these DID load; it's a filter, not a rejection"
                          >
                            {settled ? n0(b.dup_of_prior).toLocaleString() : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-2.5 px-4">
                            {!settled && n0(b.bytes_total) > 0 && (
                              <span className="block text-[10px] text-gray-400">
                                {Math.min(100, Math.round((n0(b.byte_offset) / n0(b.bytes_total)) * 100))}% of the file
                              </span>
                            )}
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

            {batches.length > 0 && batches[0].counts_refreshed_at && (
              <p className="text-[11px] text-gray-400 flex flex-wrap items-center gap-2">
                <span>Counts as of {fmtDateTime(batches[0].counts_refreshed_at)}.</span>
                <span>
                  Kept current by the ingest and push; recalculate one if something changed it outside them.
                </span>
                {batches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => void recountBatch(b.id)}
                    disabled={refreshingBatch != null}
                    className="text-ocean-blue hover:underline disabled:opacity-50"
                    title={`Recount ${b.batch_code} — scans that batch, a few seconds`}
                  >
                    {refreshingBatch === b.id ? `Recounting ${b.batch_code}…` : `Recount ${b.batch_code}`}
                  </button>
                ))}
              </p>
            )}
          </section>

          {/* ── 3. Lead browser ── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-2">
                3 · Lead browser
                <span
                  className="normal-case font-normal text-gray-400"
                  title="The exact count for these filters, from the same code the push runs — so this number and the push button always agree. Counts leads with a phone that haven't been pushed yet."
                >
                  ·{" "}
                  <strong className="text-gray-700 dark:text-gray-200">
                    {countError ? "—" : filteredCount == null ? "…" : filteredCount.toLocaleString()}
                  </strong>{" "}
                  dialable leads match
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
                {/* Multi-select: UCC + Trigger together, excluding Aged, etc.
                    Each pushed lead still gets the lm- tag for ITS OWN list, so a
                    mixed set tags correctly per lead. */}
                <div className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 flex flex-wrap gap-x-2 gap-y-0.5 w-40">
                  {LEAD_TYPES.map((t) => {
                    const on = fTypes.includes(t.type);
                    return (
                      <label
                        key={t.type}
                        className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 cursor-pointer whitespace-nowrap"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue"
                          checked={on}
                          onChange={(e) =>
                            setFTypes((prev) =>
                              e.target.checked ? [...prev, t.type] : prev.filter((x) => x !== t.type),
                            )
                          }
                        />
                        {TYPE_META[t.type].label}
                      </label>
                    );
                  })}
                </div>
                <span className="text-[10px] text-gray-400">
                  {fTypes.length === 0 ? "All lists" : `${fTypes.length} selected`}
                </span>
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
              {/* STATE — multi-select. Pick several at once (FL + TX + GA); each
                  selection becomes a removable chip and the set goes to the
                  server as an array. */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">State</label>
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 min-h-[2.4rem] w-56">
                  {fStates.map((st) => (
                    <span
                      key={st}
                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue font-semibold"
                    >
                      {st}
                      <button
                        onClick={() => setFStates((prev) => prev.filter((x) => x !== st))}
                        title={`Remove ${st}`}
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    list="lead-machine-states"
                    className="flex-1 min-w-[3.5rem] bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none"
                    placeholder={fStates.length ? "" : "any state"}
                    value={stateDraft}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                      // Two letters that name a real state commit immediately —
                      // picking from the list shouldn't also need Enter.
                      if (v.length === 2 && US_STATES.includes(v)) {
                        setFStates((prev) => (prev.includes(v) ? prev : [...prev, v]));
                        setStateDraft("");
                      } else setStateDraft(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && stateDraft === "" && fStates.length > 0) {
                        setFStates((prev) => prev.slice(0, -1));
                      }
                    }}
                  />
                </div>
                <datalist id="lead-machine-states">
                  {US_STATES.filter((st) => !fStates.includes(st)).map((st) => (
                    <option key={st} value={st} />
                  ))}
                </datalist>
                <span className="text-[10px] text-gray-400">
                  {fStates.length > 1 ? `${fStates.length} states · any of them` : "Type or pick · UCC lists only"}
                </span>
              </div>
              {/* LINE TYPE — the four values actually stored, as toggles. Free
                  text here meant only "Mobile" was ever really reachable. */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Line type</label>
                <div className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 flex flex-wrap gap-x-2 gap-y-0.5 w-44">
                  {LINE_TYPES.map((lt) => {
                    const on = fLines.includes(lt.value);
                    return (
                      <label
                        key={lt.value}
                        className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 cursor-pointer whitespace-nowrap"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 accent-ocean-blue"
                          checked={on}
                          onChange={(e) =>
                            setFLines((prev) =>
                              e.target.checked ? [...prev, lt.value] : prev.filter((x) => x !== lt.value),
                            )
                          }
                        />
                        {lt.label}
                      </label>
                    );
                  })}
                </div>
                <span className="text-[10px] text-gray-400">
                  {fLines.length === 0 ? "All lines · mobile connects best" : `${fLines.length} selected`}
                </span>
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
                <span className="text-[10px] text-gray-400">As stated · UCC + trigger only</span>
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
              {fTypes.includes("ucc") && (
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
                  <span className="text-[10px] text-gray-400">Who they already took capital from · UCC only</span>
                </div>
              )}
            </div>

            {/* A filter that only exists on some list types silently excludes the
                others — say so, with the fix, rather than showing a bare 0. */}
            {narrowingFilters.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  {narrowingFilters.map((f) => f.field).join(" and ")}{" "}
                  {narrowingFilters.length === 1 ? "exists" : "exist"} on{" "}
                  <strong>{narrowingFilters.map((f) => f.label).join(" / ")}</strong> — every lead from the other list
                  types is excluded by {narrowingFilters.length === 1 ? "that filter" : "those filters"}, however it
                  looks. Purchased aged files carry no state or revenue at all.
                </span>
              </p>
            )}

            {/* ── 4. Act on this set — push into VibeReach, or export it as CSV.
                Always present when there are leads (export needs no filter);
                goes sticky once a filter or a selection is driving it. ── */}
            {(leads.length > 0 || (filteredCount ?? 0) > 0) && (
              <div
                className={`rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/90 dark:bg-emerald-900/30 backdrop-blur p-4 space-y-3 shadow-sm ${
                  activeFilterCount > 0 || usingSelection ? "sticky top-0 z-20" : ""
                }`}
              >
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
                  {!usingSelection && countingPush && (
                    <span className="text-xs text-gray-400">· counting…</span>
                  )}
                  {!usingSelection && countError && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      · couldn't count this set — the leads below are unaffected
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
                  {autoTypeTag ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-semibold">
                      {autoTypeTag} <span className="text-gray-400">· auto</span>
                    </span>
                  ) : (
                    /* Mixed or unfiltered set: the type tag still lands, resolved
                       per lead from its own list, so it can't be named up front. */
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                      lm-&lt;list&gt; tag · auto, per lead
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
                  These tags drive HotProspector: campaigns dial by tag. Tags are forced to lowercase-kebab. The
                  <code>lm-*</code> type tag and the batch tag are added automatically and are{" "}
                  <strong>provenance only — neither one dials anything</strong>. Dialing happens only against a tag you
                  point a campaign at, which is why <strong>at least one tag of your own is required</strong>.
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
                    disabled={pushRunning || plannedPush === 0 || effectiveTags.length === 0}
                    title={
                      effectiveTags.length === 0
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
                  {effectiveTags.length === 0 && (
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

                  {/* Export — same set, different destination. No confirm: writing
                      a file changes nothing. */}
                  <span className="h-5 w-px bg-emerald-300/60 dark:bg-emerald-700/60" />
                  <button
                    onClick={() => void runExport("email")}
                    disabled={exportProgress != null}
                    className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                    title="Export the email-campaign columns for this set: Email, First/Last, Company, State, Lead type, Batch, Tags — leads with no email are left out"
                  >
                    <EnvelopeIcon className="w-4 h-4" />
                    Export emails (CSV)
                  </button>
                  <button
                    onClick={() => void runExport("full")}
                    disabled={exportProgress != null}
                    className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                    title="Export every stored column for this set, including batch code, tags and push status"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    Export full (CSV)
                  </button>
                </div>

                {exportProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ocean-blue/20">
                      <div
                        className="h-full rounded-full bg-ocean-blue transition-all"
                        style={{
                          width: `${exportProgress.total > 0 ? Math.round((exportProgress.done / exportProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      building the CSV — {exportProgress.done.toLocaleString()}
                      {exportProgress.total > 0 && <> / {exportProgress.total.toLocaleString()}</>} rows…
                    </p>
                  </div>
                )}
                {exportNote && <p className="text-sm text-ocean-blue">{exportNote}</p>}
                {exportErr && <p className="text-sm text-rose-600 dark:text-rose-400">export failed: {exportErr}</p>}

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

            {/* The table still shows the last good page, so the failure needs to
                be visible on its own rather than implied by stale rows. */}
            {leadsError && leads.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-300">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
                Showing the last page that loaded — the newest request failed ({leadsError}).
                <button onClick={() => void loadLeads()} className="btn-ghost btn-sm">
                  Try again
                </button>
              </p>
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
                  {leadsLoading && leads.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : leadsError && leads.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-6 px-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
                          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                          <span>
                            <strong>Couldn't load these leads</strong> — a load failure, not an empty result. Your
                            leads are still there. ({leadsError})
                          </span>
                          <button onClick={() => void loadLeads()} className="btn-ghost btn-sm">
                            Try again
                          </button>
                        </div>
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
                                  l.line_type.toLowerCase().includes("mobile") ||
                                  l.line_type.toLowerCase().includes("cell")
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

            {(hasNextPage || page > 0) && (
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>
                  {filteredCount == null ? "…" : filteredCount.toLocaleString()} leads · page {page + 1}
                  {totalPages != null && <> of {totalPages}</>}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <button className="btn-ghost btn-sm" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>
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
