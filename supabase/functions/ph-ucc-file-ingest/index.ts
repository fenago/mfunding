// ph-ucc-file-ingest — the REPEATABLE, UI-driven bulk-FILE UCC ingest.
//
// Turns the CA / FL (and any future file-state) bulk load into a permanent,
// owner-operable feature: the owner uploads the state's unzipped CSV(s) to the
// ph-ucc-uploads bucket from /admin/ph-ucc, then this function streams them,
// keeps ONLY the funder-matched filings, applies the SAME freshness/termination
// filter as the API states, upserts into ph_ucc_filings, and rebuilds ph_ucc_leads.
// The NEXT month's file needs no agent — just an upload.
//
// GB-SCALE ARCHITECTURE (honest — see _shared/uccFile.ts for the full rationale):
// edge functions have ~256MB memory + a wall clock, so we never buffer the file.
// We STREAM each CSV from storage over HTTP Range, byte-accurately, and process in
// timed chunks; when the wall clock is near we persist an exact byte offset and
// SELF-REINVOKE to continue (the proven CO cursor-chain pattern). Memory is bounded
// by the MATCHED set (pass 1 stages only funder-alias hits — a tiny fraction), not
// the file size. A 470MB CA unzip or a multi-GB FL file ingests across as many
// self-reinvocations as the wall clock requires; nothing OOMs.
//
// PASSES (job.phase_index): 0 match_secured → 1 enrich_filings → 2 enrich_debtors
// → 3 finalize (flush staging into ph_ucc_filings + rebuild leads).
//
// AUTH: a signed-in staff user (closer/admin/super_admin) starts a job from the UI;
// continuations authenticate via the cron path (?secret=<GHL webhook secret> +
// anon-key Bearer), resolved from the vault. A service-role bearer deliberately
// fails the staff check — same contract as ph-ucc-ingest.
//
// INGEST ONLY: never dials, never skip-traces, never touches GHL. Downstream gates
// are unchanged and OFF by default.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  buildAliasNorms, clean, headerIndex, objectSize, pick, PROFILES,
  roleForPath, securedPartyIsFunder, splitDelimited, streamLines, toIsoDate,
  type RoleKind, type RoleSpec, type StateFileProfile,
} from "../_shared/uccFile.ts";

const BUDGET_MS = 50_000;            // stop consuming lines past this, then reinvoke
const STAGE_BATCH = 1000;            // matched-row insert batch (pass 0)
const ENRICH_BATCH = 2000;          // enrich RPC batch (pass 1 / 2)
const PHASES = ["match_secured", "enrich_filings", "enrich_debtors", "finalize"] as const;
const PHASE_ROLE: Record<number, RoleKind | null> = { 0: "secured", 1: "filings", 2: "debtors", 3: null };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BUCKET = "ph-ucc-uploads";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// A signed URL for a private-bucket object. Fetched with Range + no auth header —
// works regardless of the project's service-key format. Re-signed each chunk.
async function signedUrl(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`sign url failed for ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${SUPABASE_URL}${data.signedUrl}`;
}

// Read just the header line of a role file → {hdr map, byteEnd of header}.
async function readHeader(url: string, spec: RoleSpec): Promise<{ hdr: Record<string, number>; dataStart: number }> {
  if (!spec.hasHeader) return { hdr: {}, dataStart: 0 };
  for await (const { line, byteEnd } of streamLines(url, "", 0)) {
    return { hdr: headerIndex(line, spec.delimiter), dataStart: byteEnd };
  }
  return { hdr: {}, dataStart: 0 };
}

// Resolve the webhook secret (for self-reinvoke) from the vault.
async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

// Fire the next chunk without blocking the current response (self-reinvoke).
// budgetMs (optional ops knob) is carried through the whole chain so a smaller
// per-chunk budget stays in effect across every resume.
function reinvoke(secret: string, jobId: string, budgetMs?: number): void {
  const url = `${SUPABASE_URL}/functions/v1/ph-ucc-file-ingest?secret=${encodeURIComponent(secret)}`;
  const body: Record<string, unknown> = { action: "continue", job_id: jobId };
  if (budgetMs) body.budget_ms = budgetMs;
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  }).then(() => {}).catch((e) => console.error("[ph-ucc-file-ingest] reinvoke failed:", e));
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

type Job = {
  id: string; state: string; source_id: string | null; status: string;
  storage_paths: string[]; phase_index: number; byte_offset: number;
  rows_scanned: number; sp_matched: number; filings_upserted: number; leads_upserted: number;
};

async function loadJob(db: SupabaseClient, id: string): Promise<Job | null> {
  const { data } = await db.from("ph_ucc_ingest_jobs").select(
    "id,state,source_id,status,storage_paths,phase_index,byte_offset,rows_scanned,sp_matched,filings_upserted,leads_upserted",
  ).eq("id", id).maybeSingle();
  return (data as Job | null) ?? null;
}
async function patchJob(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("ph_ucc_ingest_jobs").update(patch).eq("id", id);
  if (error) console.error("[ph-ucc-file-ingest] job patch failed:", error.message);
}

// Find the uploaded path for a role (first match by filename hint).
function pathForRole(job: Job, profile: StateFileProfile, role: RoleKind): string | null {
  for (const p of job.storage_paths) if (roleForPath(p, profile) === role) return p;
  return null;
}

async function filingsHeld(db: SupabaseClient, state: string): Promise<number> {
  const { count } = await db.from("ph_ucc_filings").select("id", { count: "exact", head: true }).eq("state", state);
  return count ?? 0;
}
async function newestFor(db: SupabaseClient, state: string): Promise<string | null> {
  const { data } = await db.from("ph_ucc_filings").select("filed_date").eq("state", state)
    .order("filed_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return (data?.filed_date as string | null) ?? null;
}

// ── Process ONE chunk of the current phase. Returns after a budget window or EOF. ──
async function processChunk(db: SupabaseClient, job: Job, budgetMs: number): Promise<{ done: boolean }> {
  const profile = PROFILES[job.state];
  const started = Date.now();
  const phaseIdx = job.phase_index;

  // ── Phase 3: finalize (set-based; no streaming) ──
  if (phaseIdx >= 3) {
    const { data: fin, error: finErr } = await db.rpc("ph_ucc_finalize_file_job", {
      p_job_id: job.id, p_window_days: profile.windowDays,
    });
    if (finErr) throw new Error(`finalize failed: ${finErr.message}`);
    const filingsUpserted = Number(fin ?? 0);
    const { data: rb, error: rbErr } = await db.rpc("ph_ucc_rebuild_leads");
    const leadsUpserted = rbErr ? 0 : Number((Array.isArray(rb) ? rb[0]?.leads_upserted : rb?.leads_upserted) ?? 0);

    // Update the source card to reflect the fresh load.
    if (job.source_id) {
      await db.from("ph_ucc_sources").update({
        last_pull_at: new Date().toISOString(),
        last_rows: await filingsHeld(db, job.state),
        newest_filing_date: await newestFor(db, job.state),
        status: "active",
        notes: `File ingest ${new Date().toISOString()}: +${filingsUpserted} filing-rows (≤${profile.windowDays}d, non-terminated).`,
      }).eq("id", job.source_id);
    }
    await patchJob(db, job.id, {
      status: "complete", phase: "finalize", filings_upserted: filingsUpserted,
      leads_upserted: leadsUpserted, finished_at: new Date().toISOString(),
      message: `Complete — ${filingsUpserted} filings upserted, ${leadsUpserted} leads rebuilt.`,
    });
    return { done: true };
  }

  const role = PHASE_ROLE[phaseIdx]!;
  const spec = profile[role];
  const path = pathForRole(job, profile, role);

  // Missing file for this pass:
  if (!path) {
    if (role === "secured") {
      throw new Error("no secured-party file uploaded (required to detect MCA positions)");
    }
    // filings / debtors optional → advance to next phase.
    await patchJob(db, job.id, { phase_index: phaseIdx + 1, byte_offset: 0, message: `no ${role} file — skipped` });
    return { done: false };
  }

  const url = await signedUrl(db, path);
  const { hdr, dataStart } = await readHeader(url, spec);
  const totalBytes = await objectSize(url, "");
  const startByte = job.byte_offset > 0 ? job.byte_offset : dataStart;

  await patchJob(db, job.id, { phase: PHASES[phaseIdx], bytes_total: totalBytes, status: "processing" });

  let scanned = 0;
  let matched = 0;
  let lastByteEnd = startByte;
  let hitBudget = false;

  // Batches held in memory (bounded): pass 0 stages matched rows; pass 1/2 collect
  // enrich rows only for staged filing_nos.
  const stageBatch: { job_id: string; state: string; filing_no: string; secured_party_raw: string; raw: Record<string, unknown> }[] = [];
  const enrichBatch: Record<string, unknown>[] = [];

  // For pass 1/2 we only enrich filing_nos that were staged (the matched set).
  let stagedSet: Set<string> | null = null;
  if (phaseIdx === 1 || phaseIdx === 2) {
    stagedSet = new Set<string>();
    // Page through distinct staged filing_nos (bounded — it's the matched set).
    const pageSize = 10_000;
    for (let off = 0; ; off += pageSize) {
      const { data, error } = await db.from("ph_ucc_ingest_matches")
        .select("filing_no").eq("job_id", job.id).range(off, off + pageSize - 1);
      if (error) throw new Error(`load staged set failed: ${error.message}`);
      const rows = (data as { filing_no: string }[]) ?? [];
      for (const r of rows) stagedSet.add(r.filing_no);
      if (rows.length < pageSize) break;
    }
  }

  const flushStage = async () => {
    if (!stageBatch.length) return;
    const { error } = await db.from("ph_ucc_ingest_matches")
      .upsert(stageBatch.splice(0), { onConflict: "job_id,filing_no,secured_party_raw", ignoreDuplicates: true });
    if (error) throw new Error(`stage insert failed: ${error.message}`);
  };
  const flushEnrich = async (kind: "filings" | "debtors") => {
    if (!enrichBatch.length) return;
    const rows = enrichBatch.splice(0);
    const { error } = await db.rpc("ph_ucc_enrich_matches", { p_job_id: job.id, p_kind: kind, p_rows: rows });
    if (error) throw new Error(`enrich (${kind}) failed: ${error.message}`);
  };

  for await (const { line, byteEnd } of streamLines(url, "", startByte)) {
    if (!line) { lastByteEnd = byteEnd; continue; }
    const f = splitDelimited(line, spec.delimiter);
    scanned++;

    if (phaseIdx === 0) {
      const filingNo = pick(f, hdr, spec.columns.filing_no);
      const sp = pick(f, hdr, spec.columns.secured_party_raw);
      if (filingNo && sp && securedPartyIsFunder(sp, aliasNorms)) {
        stageBatch.push({
          job_id: job.id, state: job.state, filing_no: filingNo, secured_party_raw: sp,
          raw: { source: `${job.state}/file`, role: "secured" },
        });
        matched++;
        if (stageBatch.length >= STAGE_BATCH) await flushStage();
      }
    } else if (phaseIdx === 1) {
      const filingNo = pick(f, hdr, spec.columns.filing_no);
      if (filingNo && stagedSet!.has(filingNo)) {
        enrichBatch.push({
          filing_no: filingNo,
          filed_date: toIsoDate(pick(f, hdr, spec.columns.filed_date)),
          lapse_date: toIsoDate(pick(f, hdr, spec.columns.lapse_date ?? [])),
          status: pick(f, hdr, spec.columns.status ?? []),
        });
        matched++;
        if (enrichBatch.length >= ENRICH_BATCH) await flushEnrich("filings");
      }
    } else if (phaseIdx === 2) {
      const filingNo = pick(f, hdr, spec.columns.filing_no);
      if (filingNo && stagedSet!.has(filingNo)) {
        enrichBatch.push({
          filing_no: filingNo,
          debtor_name: pick(f, hdr, spec.columns.debtor_name),
          debtor_address: pick(f, hdr, spec.columns.debtor_address ?? []),
          debtor_city: pick(f, hdr, spec.columns.debtor_city ?? []),
          debtor_state: pick(f, hdr, spec.columns.debtor_state ?? []),
          debtor_zip: pick(f, hdr, spec.columns.debtor_zip ?? []),
        });
        matched++;
        if (enrichBatch.length >= ENRICH_BATCH) await flushEnrich("debtors");
      }
    }

    lastByteEnd = byteEnd;
    if (Date.now() - started > budgetMs) { hitBudget = true; break; }
  }

  // Flush whatever remains.
  if (phaseIdx === 0) await flushStage();
  else if (phaseIdx === 1) await flushEnrich("filings");
  else if (phaseIdx === 2) await flushEnrich("debtors");

  const tallies: Record<string, unknown> = {
    rows_scanned: (job.rows_scanned ?? 0) + scanned,
  };
  if (phaseIdx === 0) tallies.sp_matched = (job.sp_matched ?? 0) + matched;

  if (hitBudget) {
    // More of this file remains — persist the exact resume offset and continue.
    await patchJob(db, job.id, {
      ...tallies, byte_offset: lastByteEnd,
      message: `${PHASES[phaseIdx]}: scanned ${(job.rows_scanned ?? 0) + scanned} rows${totalBytes ? ` (${Math.floor((lastByteEnd / totalBytes) * 100)}%)` : ""}`,
    });
    return { done: false };
  }

  // EOF for this file → advance to the next phase.
  await patchJob(db, job.id, {
    ...tallies, phase_index: phaseIdx + 1, byte_offset: 0,
    message: `${PHASES[phaseIdx]} done (${(job.rows_scanned ?? 0) + scanned} rows scanned)`,
  });
  return { done: false };
}

// Loaded once per invocation (small — the active funder-alias dictionary).
let aliasNorms: string[] = [];
async function loadAliasNorms(db: SupabaseClient) {
  const { data, error } = await db.from("ph_ucc_funder_aliases").select("alias,active").eq("active", true);
  if (error) throw new Error(`load aliases failed: ${error.message}`);
  aliasNorms = buildAliasNorms((data as { alias: string; active?: boolean }[]) ?? []);
  if (!aliasNorms.length) throw new Error("no active funder aliases — nothing to match against");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";

  // ── Auth: trusted cron (secret) OR a signed-in staff user ──
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
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* none */ }
  const action = String(payload.action ?? "start");

  try {
    // ── START: create a job for an uploaded file set, kick the chain, return id ──
    if (action === "start") {
      const state = String(payload.state ?? "").toUpperCase();
      const paths = Array.isArray(payload.storage_paths) ? (payload.storage_paths as string[]) : [];
      if (!PROFILES[state]) return json({ error: `no file profile for state ${state}` }, 400);
      if (!paths.length) return json({ error: "storage_paths required" }, 400);

      const { data: src } = await db.from("ph_ucc_sources").select("id").eq("state", state).eq("kind", "file").maybeSingle();
      const fingerprint = `${state}|${[...paths].sort().join(",")}`;

      const { data: created, error: cErr } = await db.from("ph_ucc_ingest_jobs").insert({
        state, source_id: src?.id ?? null, origin: "upload", status: "processing",
        storage_paths: paths, phase_index: 0, byte_offset: 0, fingerprint,
        started_at: new Date().toISOString(), message: "queued", phase: "match_secured",
      }).select("id").single();
      if (cErr) throw new Error(`job create failed: ${cErr.message}`);
      const jobId = created.id as string;

      const secret = await webhookSecret(db);
      if (secret) reinvoke(secret, jobId);
      else console.error("[ph-ucc-file-ingest] no webhook secret — job will not self-continue");
      return json({ ok: true, job_id: jobId, state, message: "ingest started" });
    }

    // ── CONTINUE: process one budget window of the job, then chain or finish ──
    if (action === "continue") {
      const jobId = String(payload.job_id ?? "");
      if (!jobId) return json({ error: "job_id required" }, 400);
      const job = await loadJob(db, jobId);
      if (!job) return json({ error: "job not found" }, 404);
      if (job.status !== "processing") return json({ ok: true, skipped: true, status: job.status });
      if (!PROFILES[job.state]) return json({ error: `no profile for ${job.state}` }, 400);

      await loadAliasNorms(db);
      const budgetMs = Number(payload.budget_ms) > 0 ? Number(payload.budget_ms) : BUDGET_MS;
      const { done } = await processChunk(db, job, budgetMs);
      if (!done) {
        const secret = providedSecret || (await webhookSecret(db));
        if (secret) reinvoke(secret, jobId, budgetMs === BUDGET_MS ? undefined : budgetMs);
      }
      return json({ ok: true, job_id: jobId, done });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ph-ucc-file-ingest] FAILED", msg);
    // Best-effort: mark the job errored so the UI shows the truth.
    const jobId = String(payload.job_id ?? "");
    if (jobId) await patchJob(db, jobId, { status: "error", error: msg, finished_at: new Date().toISOString() });
    return json({ ok: false, error: msg }, 500);
  }
});
