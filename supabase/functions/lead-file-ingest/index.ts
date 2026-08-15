// lead-file-ingest — the INGEST half of the LEAD MACHINE.
//
// The owner buys lead files (UCC / AGED / TRIGGER, ~85k rows each), uploads the
// raw CSV to the private `lead-uploads` bucket from the admin UI, and calls this
// function. It streams the file out of storage and lands every row in
// `lead_records` under a server-coded `lead_batches` row. NOTHING is pushed
// anywhere here — the push to GoHighLevel is a separate, FILTERED decision made
// later by lead-push-ghl. Supabase is the book of record; GHL only ever receives
// the selection.
//
// 85k ROWS INSIDE AN EDGE FUNCTION (the honest part): edge functions have ~256MB
// and a wall clock, so the file is NEVER buffered. It is streamed over HTTP Range
// from a signed URL, byte-accurately; when the time budget is spent we persist the
// exact byte offset on the batch row and SELF-REINVOKE (the proven
// ph-ucc-file-ingest pattern). Memory is bounded by the 1,000-row insert chunk,
// not by file size.
//
// EVERY ROW IS KEPT. A row with no dialable NANP number is still stored, with
// status 'skipped' and the reason in push_error — purchased data is paid for, and
// a bad phone is not a reason to lose a record. In-file duplicate phones are
// dropped by the (batch_id, phone) unique index (ON CONFLICT DO NOTHING).
//
// AUTH: verify_jwt at the gateway PLUS an in-code role check — admin/super_admin
// only (buying and loading lead files is an owner function; closers are denied).
// Continuations use the cron path (?secret=<GHL webhook secret> + anon Bearer)
// resolved from the vault. A service-role bearer deliberately fails the role check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  cell, filingDate, headerIndexNorm, headerNames, type LeadType, LEAD_TYPES,
  extraEmailsFor, extraPhonesFor, normalizeLineType, normalizePhone, resolveColumns,
  resolveExtraColumns, splitDelimited, streamCsvRecords, toInt, toNum, upperState, validEmail,
  splitCombinedName,
} from "../_shared/leadCsv.ts";

// Window size is a RELIABILITY setting, not a speed one. At 50s/1000 rows the
// real trigger file killed a worker with HTTP 546 (WORKER_LIMIT — the runtime
// terminates the isolate for exceeding its memory/CPU budget). A killed worker
// never runs our catch block, so the batch stayed 'ingesting' forever with no
// reinvoke: alive-looking and actually dead. Smaller windows hand off long before
// the isolate accumulates enough to be killed.
const BUDGET_MS = 25_000;   // stop consuming rows past this, then self-reinvoke
const INSERT_BATCH = 500;   // rows per insert round-trip
const MIN_SPLIT = 50;       // stop halving a failing insert below this
const CHECKPOINT_EVERY = 10; // flushes between byte_offset checkpoints
/** A batch 'ingesting' with no progress for this long has lost its chain. */
const STALL_MS = 150_000;
const BUCKET = "lead-uploads";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function signedUrl(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`sign url failed for ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${SUPABASE_URL}${data.signedUrl}`;
}

async function objectSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const m = res.headers.get("content-range")?.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch { return null; }
}

async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

function reinvoke(secret: string, batchId: string, budgetMs?: number): void {
  const url = `${SUPABASE_URL}/functions/v1/lead-file-ingest?secret=${encodeURIComponent(secret)}`;
  const body: Record<string, unknown> = { action: "continue", batch_id: batchId };
  if (budgetMs) body.budget_ms = budgetMs;
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  }).then(() => {}).catch((e) => console.error("[lead-file-ingest] reinvoke failed:", e));
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

type Batch = {
  id: string; batch_code: string; lead_type: LeadType; status: string;
  storage_path: string | null; byte_offset: number; total_rows: number;
};
const BATCH_COLS = "id,batch_code,lead_type,status,storage_path,byte_offset,total_rows";

async function loadBatch(db: SupabaseClient, id: string): Promise<Batch | null> {
  const { data } = await db.from("lead_batches").select(BATCH_COLS).eq("id", id).maybeSingle();
  return (data as Batch | null) ?? null;
}
async function patchBatch(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("lead_batches").update(patch).eq("id", id);
  if (error) console.error("[lead-file-ingest] batch patch failed:", error.message);
}

/** Read the header line (one small Range request) and resolve the column map. */
async function readHeader(url: string): Promise<{
  cols: Record<string, number>; names: string[]; dataStart: number;
  extraCols: ReturnType<typeof resolveExtraColumns>;
}> {
  for await (const { line, byteEnd } of streamCsvRecords(url, 0)) {
      const hdr = headerIndexNorm(line);
      const cols = resolveColumns(hdr);
      return { cols, names: headerNames(line), dataStart: byteEnd, extraCols: resolveExtraColumns(hdr, cols) };
  }
  return { cols: {}, names: [], dataStart: 0, extraCols: { phones: [], emails: [] } };
}

type RecordRow = Record<string, unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Insert one chunk, surviving a busy database.
 *
 * A 1,000-row jsonb upsert is comfortably inside the statement timeout on a quiet
 * instance, but NOT when several 85k ingests stream at once — the first real run
 * of three parallel files killed a batch outright with "canceling statement due to
 * statement timeout". A whole purchased file must not be lost to write contention,
 * so a failed chunk is HALVED and retried (recursively, down to MIN_SPLIT rows)
 * before it is allowed to fail the batch. Smaller statements finish inside the
 * timeout, so the ingest degrades in throughput instead of dying.
 *
 * Re-inserting rows that already landed is harmless: (batch_id, phone) +
 * ON CONFLICT DO NOTHING makes every insert here idempotent.
 */
async function insertChunk(db: SupabaseClient, rows: RecordRow[], depth = 0): Promise<void> {
  const { error } = await db.from("lead_records")
    .upsert(rows, { onConflict: "batch_id,phone", ignoreDuplicates: true });
  if (!error) return;

  if (rows.length > MIN_SPLIT) {
    const mid = Math.floor(rows.length / 2);
    console.warn("[lead-file-ingest] insert failed — splitting", JSON.stringify({
      rows: rows.length, depth, error: error.message,
    }));
    await insertChunk(db, rows.slice(0, mid), depth + 1);
    await insertChunk(db, rows.slice(mid), depth + 1);
    return;
  }
  // Already small: the database is busy rather than the statement being too big.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(500 * attempt);
    const { error: retryErr } = await db.from("lead_records")
      .upsert(rows, { onConflict: "batch_id,phone", ignoreDuplicates: true });
    if (!retryErr) return;
    if (attempt === 3) throw new Error(`insert failed after retries: ${retryErr.message}`);
  }
}

/** Map one CSV record to a lead_records row. Never throws on bad data. */
function mapRow(
  batch: Batch, fields: string[], cols: Record<string, number>, names: string[],
  extraCols: ReturnType<typeof resolveExtraColumns>,
): RecordRow {
  const raw: Record<string, string> = {};
  for (let i = 0; i < names.length && i < fields.length; i++) {
    const v = (fields[i] ?? "").trim();
    if (v) raw[names[i] || `col${i}`] = v;
  }
  const phone = normalizePhone(cell(fields, cols, "phone"));
  const email = validEmail(cell(fields, cols, "email"));
  // The vendor files cram the whole name into FIRST NAME with LAST NAME empty,
  // and some rows invert it behind a comma ("MARTIN, DONALD RICHARD III"). Split
  // at load time so every future purchase is clean at birth; the untouched
  // original stays in `raw`, which is what made backfilling the 4,413 rows
  // already in the book possible.
  const splitName = splitCombinedName(
    cell(fields, cols, "first_name"),
    cell(fields, cols, "last_name"),
  );
  return {
    batch_id: batch.id,
    lead_type: batch.lead_type,
    phone,
    // Strictly ADDITIONAL — the primary is never repeated in these.
    extra_phones: extraPhonesFor(fields, extraCols.phones, phone, cols.line_type),
    extra_emails: extraEmailsFor(fields, extraCols.emails, email),
    line_type: normalizeLineType(cell(fields, cols, "line_type")),
    first_name: splitName.first,
    last_name: splitName.last,
    email,
    company: cell(fields, cols, "company"),
    title: cell(fields, cols, "title"),
    address: cell(fields, cols, "address"),
    city: cell(fields, cols, "city"),
    state: upperState(cell(fields, cols, "state")),
    zip: cell(fields, cols, "zip"),
    employees: toInt(cell(fields, cols, "employees")),
    revenue: toNum(cell(fields, cols, "revenue")),
    sic_code: cell(fields, cols, "sic_code"),
    sic_description: cell(fields, cols, "sic_description"),
    filing_date: filingDate(
      cell(fields, cols, "filing_day"), cell(fields, cols, "filing_month"),
      cell(fields, cols, "filing_year"), cell(fields, cols, "filing_date"),
    ),
    secured_party: cell(fields, cols, "secured_party"),
    raw,
    status: phone ? "loaded" : "skipped",
    push_error: phone ? null : "no dialable 10-digit phone in source row",
  };
}

/** One budget window of streaming. Returns done=true at EOF. */
async function processChunk(db: SupabaseClient, batch: Batch, budgetMs: number): Promise<{ done: boolean; scanned: number }> {
  if (!batch.storage_path) throw new Error("batch has no storage_path");
  const url = await signedUrl(db, batch.storage_path);
  const { cols, names, dataStart, extraCols } = await readHeader(url);
  if (cols.phone == null) {
    throw new Error(`no phone column found in header (saw: ${names.slice(0, 20).join(", ")})`);
  }
  const totalBytes = await objectSize(url);
  const startByte = batch.byte_offset > 0 ? batch.byte_offset : dataStart;
  await patchBatch(db, batch.id, { bytes_total: totalBytes, status: "ingesting" });

  const committed = batch.total_rows ?? 0; // rows counted by previous windows
  const pending: RecordRow[] = [];
  const started = Date.now();
  let scanned = 0, lastByteEnd = startByte, hitBudget = false, flushes = 0;

  // In-file duplicate phones are dropped by the (batch_id, phone) unique index.
  const flush = async () => {
    if (!pending.length) return;
    await insertChunk(db, pending.splice(0));
  };
  // total_rows and byte_offset are ALWAYS written together: `scanned` rows are
  // exactly the rows up to `lastByteEnd`, so any checkpoint is a consistent resume
  // point and a crash costs at most one checkpoint's worth of re-reading.
  const checkpoint = async () => {
    await patchBatch(db, batch.id, {
      total_rows: committed + scanned, byte_offset: lastByteEnd,
      message: `ingesting — ${committed + scanned} rows read`
        + `${totalBytes ? ` (${Math.floor((lastByteEnd / totalBytes) * 100)}%)` : ""}`,
    });
  };

  for await (const { line, byteEnd } of streamCsvRecords(url, startByte)) {
    if (line.trim()) {
      pending.push(mapRow(batch, splitDelimited(line, ","), cols, names, extraCols));
      scanned++;
      if (pending.length >= INSERT_BATCH) {
        await flush();
        lastByteEnd = byteEnd;
        if (++flushes % CHECKPOINT_EVERY === 0) await checkpoint();
        if (Date.now() - started > budgetMs) { hitBudget = true; break; }
        continue;
      }
    }
    lastByteEnd = byteEnd;
  }
  await flush();

  const total = committed + scanned;
  if (hitBudget) {
    await patchBatch(db, batch.id, {
      total_rows: total, byte_offset: lastByteEnd,
      message: `ingesting — ${total} rows read${totalBytes ? ` (${Math.floor((lastByteEnd / totalBytes) * 100)}%)` : ""}`,
    });
    return { done: false, scanned };
  }

  // ── EOF: finalize ──
  await patchBatch(db, batch.id, { total_rows: total, byte_offset: lastByteEnd });
  const { data: dupData, error: dupErr } = await db.rpc("lead_batch_mark_dups", { p_batch_id: batch.id });
  if (dupErr) console.error("[lead-file-ingest] mark_dups failed:", dupErr.message);
  const { data: counts, error: cErr } = await db.rpc("lead_batch_refresh_counts", { p_batch_id: batch.id });
  if (cErr) throw new Error(`count refresh failed: ${cErr.message}`);
  const c = (Array.isArray(counts) ? counts[0] : counts) as
    { ingested_rows: number; dup_rows: number } | null;
  await patchBatch(db, batch.id, {
    status: "ready", finished_at: new Date().toISOString(),
    message: `Ready — ${c?.ingested_rows ?? 0} records from ${total} rows`
      + `${(c?.dup_rows ?? 0) ? `, ${c!.dup_rows} in-file duplicate phone(s) dropped` : ""}`
      + `${dupData != null ? `, ${Number(dupData)} flagged as prior-source duplicates` : ""}.`,
  });
  return { done: true, scanned };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";

  let callerId: string | null = null;
  if (providedSecret) {
    const expected = await webhookSecret(db);
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — admin only" }, 403);
    }
    callerId = caller.id;
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* none */ }
  const action = String(payload.action ?? "start");

  try {
    // ── start: create the batch row (server-coded) and kick off the chain ──
    if (action === "start") {
      const leadType = String(payload.lead_type ?? "").toLowerCase() as LeadType;
      const storagePath = String(payload.storage_path ?? "");
      if (!LEAD_TYPES.includes(leadType)) {
        return json({ error: `lead_type must be one of ${LEAD_TYPES.join(", ")}` }, 400);
      }
      if (!storagePath) return json({ error: "storage_path required" }, 400);

      const { data: exists, error: exErr } = await db.storage.from(BUCKET)
        .createSignedUrl(storagePath, 60);
      if (exErr || !exists?.signedUrl) {
        return json({ error: `object not found in ${BUCKET}: ${storagePath}` }, 400);
      }

      const { data: code, error: codeErr } = await db.rpc("next_lead_batch_code", { p_lead_type: leadType });
      if (codeErr || !code) return json({ error: `batch code failed: ${codeErr?.message ?? "none"}` }, 500);

      const { data: created, error: cErr } = await db.from("lead_batches").insert({
        batch_code: code,
        lead_type: leadType,
        label: (payload.label as string | undefined) ?? null,
        file_name: (payload.file_name as string | undefined) ?? storagePath.split("/").pop() ?? null,
        file_size: Number(payload.file_size) > 0 ? Number(payload.file_size) : null,
        storage_path: storagePath,
        status: "ingesting",
        started_at: new Date().toISOString(),
        message: "queued",
        created_by: callerId,
      }).select("id,batch_code").single();
      if (cErr) throw new Error(`batch create failed: ${cErr.message}`);

      const secret = await webhookSecret(db);
      if (secret) reinvoke(secret, created.id as string);
      else console.error("[lead-file-ingest] no webhook secret — batch will not self-continue");
      return json({ ok: true, batch_id: created.id, batch_code: created.batch_code, lead_type: leadType });
    }

    // ── resume: restart a batch that died mid-stream ──
    // Safe to call at any time: the ingest restarts from the last checkpointed
    // byte_offset, and re-reading is idempotent (ON CONFLICT DO NOTHING), so the
    // worst case is re-scanning up to one checkpoint of already-landed rows.
    if (action === "resume") {
      const batchId = String(payload.batch_id ?? "");
      if (!batchId) return json({ error: "batch_id required" }, 400);
      const batch = await loadBatch(db, batchId);
      if (!batch) return json({ error: "batch not found" }, 404);
      if (batch.status === "ready") return json({ ok: true, skipped: true, status: "ready" });
      await patchBatch(db, batchId, {
        status: "ingesting", error: null, finished_at: null,
        message: `resuming from byte ${batch.byte_offset}`,
      });
      const secret = await webhookSecret(db);
      if (!secret) return json({ error: "no webhook secret — cannot self-continue" }, 500);
      reinvoke(secret, batchId);
      return json({ ok: true, batch_id: batchId, resumed_from_byte: batch.byte_offset });
    }

    // ── sweep: the WATCHDOG that makes the reinvoke chain self-healing ──
    // A self-reinvoke chain has one fatal weakness: if the runtime KILLS a worker
    // (HTTP 546 WORKER_LIMIT, an OOM, a deploy mid-flight) no catch block runs, so
    // nothing marks the batch failed and nothing schedules the next window — the
    // batch sits in 'ingesting' forever. This finds those and restarts them from
    // their last checkpoint. Wire it to a cron every few minutes; it is a no-op
    // when every batch is healthy.
    if (action === "sweep") {
      const cutoff = new Date(Date.now() - STALL_MS).toISOString();
      const { data: stalled, error: sErr } = await db.from("lead_batches")
        .select("id,batch_code,byte_offset,updated_at")
        .eq("status", "ingesting").lt("updated_at", cutoff);
      if (sErr) throw new Error(`sweep query failed: ${sErr.message}`);
      const rows = (stalled as { id: string; batch_code: string; byte_offset: number }[]) ?? [];
      const secret = await webhookSecret(db);
      if (!secret && rows.length) return json({ error: "no webhook secret — cannot restart" }, 500);
      for (const b of rows) {
        console.warn("[lead-file-ingest] sweep restarting stalled batch",
          JSON.stringify({ batch_code: b.batch_code, byte_offset: b.byte_offset }));
        await patchBatch(db, b.id, { message: `watchdog restart from byte ${b.byte_offset}` });
        reinvoke(secret, b.id);
      }
      return json({
        ok: true, restarted: rows.length,
        batches: rows.map((b) => ({ batch_code: b.batch_code, byte_offset: b.byte_offset })),
      });
    }

    // ── continue: one budget window, then reinvoke or finish ──
    if (action === "continue") {
      const batchId = String(payload.batch_id ?? "");
      if (!batchId) return json({ error: "batch_id required" }, 400);
      const batch = await loadBatch(db, batchId);
      if (!batch) return json({ error: "batch not found" }, 404);
      if (batch.status !== "ingesting") return json({ ok: true, skipped: true, status: batch.status });

      const budgetMs = Number(payload.budget_ms) > 0 ? Number(payload.budget_ms) : BUDGET_MS;
      const { done, scanned } = await processChunk(db, batch, budgetMs);
      if (!done) {
        const secret = providedSecret || (await webhookSecret(db));
        if (secret) reinvoke(secret, batchId, budgetMs === BUDGET_MS ? undefined : budgetMs);
        else await patchBatch(db, batchId, { status: "failed", error: "no webhook secret — cannot self-continue" });
      }
      return json({ ok: true, batch_id: batchId, done, scanned });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lead-file-ingest] FAILED", msg);
    const batchId = String(payload.batch_id ?? "");
    if (batchId) await patchBatch(db, batchId, { status: "failed", error: msg, finished_at: new Date().toISOString() });
    return json({ ok: false, error: msg }, 500);
  }
});
