// ph-ucc-file-ingest — the REPEATABLE, UI-driven bulk-FILE UCC ingest.
//
// Turns the manual CA / FL (and future file-state) bulk loads into a permanent,
// owner-operable feature: the owner uploads the state's unzipped CSV(s) to the
// ph-ucc-uploads bucket from /admin/ph-ucc, then this function streams them,
// keeps ONLY the funder-matched filings (using the SAME per-state matching +
// freshness/termination the manual loaders use — see _shared/uccFile.ts, a
// faithful port of scripts/ph_ucc_ca_loader.py and ph_ucc_fl_loader.py), upserts
// into ph_ucc_filings, and rebuilds ph_ucc_leads. Next month's file needs no agent.
//
// GB-SCALE (honest): edge functions have ~256MB memory + a wall clock, so we never
// buffer the file. We STREAM each CSV from storage over HTTP Range via signed URLs,
// byte-accurately, in timed chunks; when the wall clock is near we persist an exact
// byte offset and SELF-REINVOKE (the proven CO cursor-chain pattern). Memory is
// bounded by the MATCHED set (pass "secured" stages only funder hits), not file
// size. A 470MB CA unzip / multi-GB FL file ingests across many auto-continued
// chunks; nothing OOMs.
//
// PASS PLAN is per-state (profile.passes): CA = secured → filings → debtors →
// amendments → finalize; FL = secured → filings → debtors → finalize.
//
// AUTH: a signed-in staff user (closer/admin/super_admin) starts a job from the
// UI; continuations use the cron path (?secret=<GHL webhook secret> + anon Bearer),
// resolved from the vault. A service-role bearer deliberately fails the staff check
// — same contract as ph-ucc-ingest. INGEST ONLY: never dials/skip-traces/touches GHL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  buildAliasNorms, clean, debtorRank, headerIndex, objectSize, type PassKind, pick,
  PROFILES, rawVal, roleForPath, securedPartyIsFunder, splitDelimited, type StateFileProfile,
  streamLines, toIsoDate,
} from "../_shared/uccFile.ts";

const BUDGET_MS = 50_000;   // stop consuming lines past this, then reinvoke
const STAGE_BATCH = 1000;   // matched-row insert batch (secured pass)
const ENRICH_BATCH = 2000;  // reduced-row enrich batch (filings/debtors/amendments)
const DELETE_BATCH = 1000;  // FL non-'Filed' delete batch

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BUCKET = "ph-ucc-uploads";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function signedUrl(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`sign url failed for ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${SUPABASE_URL}${data.signedUrl}`;
}

async function readHeader(url: string, delim: string): Promise<{ hdr: Record<string, number>; dataStart: number }> {
  for await (const { line, byteEnd } of streamLines(url, "", 0)) {
    return { hdr: headerIndex(line, delim), dataStart: byteEnd };
  }
  return { hdr: {}, dataStart: 0 };
}

async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

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

function pathForPass(job: Job, profile: StateFileProfile, kind: PassKind): string | null {
  for (const p of job.storage_paths) if (roleForPath(p, profile) === kind) return p;
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

// Loaded once per invocation (small — the active funder-alias dictionary, normalized
// in the state's matching mode with its floor + blocklist applied).
let aliasNorms: string[] = [];
async function loadAliasNorms(db: SupabaseClient, profile: StateFileProfile) {
  const { data, error } = await db.from("ph_ucc_funder_aliases").select("alias,active").eq("active", true);
  if (error) throw new Error(`load aliases failed: ${error.message}`);
  aliasNorms = buildAliasNorms((data as { alias: string; active?: boolean }[]) ?? [], profile.match);
  if (!aliasNorms.length) throw new Error("no active funder aliases after match filter — nothing to match against");
}

// Load the staged filing_no set for a job (the matched set — small, bounded).
async function loadStagedSet(db: SupabaseClient, jobId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const pageSize = 10_000;
  for (let off = 0; ; off += pageSize) {
    const { data, error } = await db.from("ph_ucc_ingest_matches")
      .select("filing_no").eq("job_id", jobId).range(off, off + pageSize - 1);
    if (error) throw new Error(`load staged set failed: ${error.message}`);
    const rows = (data as { filing_no: string }[]) ?? [];
    for (const r of rows) set.add(r.filing_no);
    if (rows.length < pageSize) break;
  }
  return set;
}

// ── Process ONE budget window of the current pass. Returns after budget or EOF. ──
async function processChunk(db: SupabaseClient, job: Job, budgetMs: number): Promise<{ done: boolean }> {
  const profile = PROFILES[job.state];
  const started = Date.now();
  const phaseIdx = job.phase_index;

  // ── Finalize phase (past the last streaming pass) ──
  if (phaseIdx >= profile.passes.length) {
    const { data: fin, error: finErr } = await db.rpc("ph_ucc_finalize_file_job", {
      p_job_id: job.id, p_window_days: profile.windowDays,
      p_drop_lapsed: profile.dropLapsed, p_use_amend: !!profile.amendments,
    });
    if (finErr) throw new Error(`finalize failed: ${finErr.message}`);
    const filingsUpserted = Number(fin ?? 0);
    const { data: rb, error: rbErr } = await db.rpc("ph_ucc_rebuild_leads");
    const leadsUpserted = rbErr ? 0 : Number((Array.isArray(rb) ? rb[0]?.leads_upserted : rb?.leads_upserted) ?? 0);
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
      status: "complete", phase: "finalize", filings_upserted: filingsUpserted, leads_upserted: leadsUpserted,
      finished_at: new Date().toISOString(),
      message: `Complete — ${filingsUpserted} filings upserted, ${leadsUpserted} leads rebuilt.`,
    });
    return { done: true };
  }

  const kind = profile.passes[phaseIdx];
  const spec = kind === "amendments" ? profile.amendments! : profile[kind];
  const path = pathForPass(job, profile, kind);

  if (!path) {
    if (kind === "secured") throw new Error("no secured-party file uploaded (required to detect MCA positions)");
    // filings/debtors/amendments optional → advance.
    await patchJob(db, job.id, { phase_index: phaseIdx + 1, byte_offset: 0, message: `no ${kind} file — skipped` });
    return { done: false };
  }

  const url = await signedUrl(db, path);
  const { hdr, dataStart } = await readHeader(url, spec.delimiter);
  const totalBytes = await objectSize(url, "");
  const startByte = job.byte_offset > 0 ? job.byte_offset : dataStart;
  await patchJob(db, job.id, { phase: kind, bytes_total: totalBytes, status: "processing" });

  const stagedSet = kind === "secured" ? null : await loadStagedSet(db, job.id);

  // Per-filing_no reduction maps for the enrich passes (flushed by size).
  const stageBatch: { job_id: string; state: string; filing_no: string; secured_party_raw: string; raw: Record<string, unknown> }[] = [];
  const filingsMap = new Map<string, { filed_date: string | null; lapse_date: string | null; status: string | null }>();
  const debtorsMap = new Map<string, { rank: number; debtor_name: string; debtor_address: string | null; debtor_city: string | null; debtor_state: string | null; debtor_zip: string | null }>();
  const amendMap = new Map<string, { is_term: boolean; is_err: boolean }>();
  const deleteSet = new Set<string>();

  const flushStage = async () => {
    if (!stageBatch.length) return;
    const { error } = await db.from("ph_ucc_ingest_matches")
      .upsert(stageBatch.splice(0), { onConflict: "job_id,filing_no,secured_party_raw", ignoreDuplicates: true });
    if (error) throw new Error(`stage insert failed: ${error.message}`);
  };
  const flushEnrich = async (k: "filings" | "debtors" | "amendments", force = false) => {
    const map = k === "filings" ? filingsMap : k === "debtors" ? debtorsMap : amendMap;
    if (!force && map.size < ENRICH_BATCH) return;
    if (!map.size) return;
    const rows = Array.from(map, ([filing_no, v]) => ({ filing_no, ...v }));
    map.clear();
    const { error } = await db.rpc("ph_ucc_enrich_matches", { p_job_id: job.id, p_kind: k, p_rows: rows });
    if (error) throw new Error(`enrich (${k}) failed: ${error.message}`);
  };
  const flushDeletes = async (force = false) => {
    if (!deleteSet.size || (!force && deleteSet.size < DELETE_BATCH)) return;
    const ids = Array.from(deleteSet); deleteSet.clear();
    const { error } = await db.from("ph_ucc_ingest_matches").delete().eq("job_id", job.id).in("filing_no", ids);
    if (error) throw new Error(`drop non-fresh failed: ${error.message}`);
  };

  let scanned = 0, matched = 0, lastByteEnd = startByte, hitBudget = false;
  const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

  for await (const { line, byteEnd } of streamLines(url, "", startByte)) {
    if (!line) { lastByteEnd = byteEnd; continue; }
    const f = splitDelimited(line, spec.delimiter);
    scanned++;

    if (kind === "secured") {
      const filingNo = pick(f, hdr, spec.columns.filing_no);
      const sp = pick(f, hdr, spec.columns.secured_party_raw);
      if (filingNo && sp && securedPartyIsFunder(sp, aliasNorms, profile.match.mode)) {
        stageBatch.push({ job_id: job.id, state: job.state, filing_no: filingNo, secured_party_raw: sp, raw: { source: `${job.state}/file` } });
        matched++;
        if (stageBatch.length >= STAGE_BATCH) await flushStage();
      }
    } else {
      const filingNo = pick(f, hdr, spec.columns.filing_no);
      if (!filingNo || !stagedSet!.has(filingNo)) { lastByteEnd = byteEnd; continue; }

      if (kind === "filings") {
        const fs = profile.filings;
        if (fs.dropUnless && rawVal(f, hdr, fs.dropUnless.col) !== fs.dropUnless.keepValue) {
          deleteSet.add(filingNo);
          await flushDeletes();
          lastByteEnd = byteEnd; continue;
        }
        let fd: string | null = null;
        if (fs.filedGate) {
          if (rawVal(f, hdr, fs.filedGate.col) === fs.filedGate.value) fd = toIsoDate(pick(f, hdr, fs.columns.filed_date));
        } else fd = toIsoDate(pick(f, hdr, fs.columns.filed_date));
        const lapse = toIsoDate(pick(f, hdr, fs.columns.lapse_date));
        const status = pick(f, hdr, fs.columns.status);
        const prev = filingsMap.get(filingNo);
        filingsMap.set(filingNo, {
          filed_date: prev?.filed_date ?? fd,
          lapse_date: maxDate(prev?.lapse_date ?? null, lapse),
          status: prev?.status ?? status,
        });
        matched++;
        await flushEnrich("filings");
      } else if (kind === "debtors") {
        const ds = profile.debtors;
        const orgName = pick(f, hdr, ds.columns.debtor_name);
        let name = orgName;
        if (!name && ds.personCols) {
          const last = pick(f, hdr, ds.personCols.last), first = pick(f, hdr, ds.personCols.first);
          name = [last, first].filter(Boolean).join(", ") || null;
        }
        if (!name || name.length < 2) { lastByteEnd = byteEnd; continue; }
        let addr = pick(f, hdr, ds.columns.debtor_address);
        const addr2 = pick(f, hdr, ds.columns.debtor_address2 ?? []);
        if (addr2) addr = [addr, addr2].filter(Boolean).join(" ");
        const rank = debtorRank(ds, f, hdr, name.length, !!orgName);
        const prev = debtorsMap.get(filingNo);
        if (!prev || rank < prev.rank) {
          debtorsMap.set(filingNo, {
            rank, debtor_name: name, debtor_address: addr,
            debtor_city: pick(f, hdr, ds.columns.debtor_city),
            debtor_state: pick(f, hdr, ds.columns.debtor_state),
            debtor_zip: pick(f, hdr, ds.columns.debtor_zip),
          });
        }
        matched++;
        await flushEnrich("debtors");
      } else if (kind === "amendments") {
        const am = profile.amendments!;
        const action = rawVal(f, hdr, am.actionCol);
        const isTerm = am.terminationValues.includes(action);
        const isErr = am.reversalValues.includes(action);
        if (isTerm || isErr) {
          const prev = amendMap.get(filingNo) ?? { is_term: false, is_err: false };
          amendMap.set(filingNo, { is_term: prev.is_term || isTerm, is_err: prev.is_err || isErr });
          matched++;
          await flushEnrich("amendments");
        }
      }
    }

    lastByteEnd = byteEnd;
    if (Date.now() - started > budgetMs) { hitBudget = true; break; }
  }

  // Flush remainders.
  if (kind === "secured") await flushStage();
  else if (kind === "filings") { await flushEnrich("filings", true); await flushDeletes(true); }
  else if (kind === "debtors") await flushEnrich("debtors", true);
  else if (kind === "amendments") await flushEnrich("amendments", true);

  const tallies: Record<string, unknown> = { rows_scanned: (job.rows_scanned ?? 0) + scanned };
  if (kind === "secured") tallies.sp_matched = (job.sp_matched ?? 0) + matched;

  if (hitBudget) {
    await patchJob(db, job.id, {
      ...tallies, byte_offset: lastByteEnd,
      message: `${kind}: scanned ${(job.rows_scanned ?? 0) + scanned} rows${totalBytes ? ` (${Math.floor((lastByteEnd / totalBytes) * 100)}%)` : ""}`,
    });
    return { done: false };
  }
  await patchJob(db, job.id, {
    ...tallies, phase_index: phaseIdx + 1, byte_offset: 0,
    message: `${kind} done (${(job.rows_scanned ?? 0) + scanned} rows scanned)`,
  });
  return { done: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";

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
    if (!role || !["closer", "admin", "super_admin"].includes(role)) return json({ error: "Forbidden — staff only" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* none */ }
  const action = String(payload.action ?? "start");

  try {
    if (action === "start") {
      const state = String(payload.state ?? "").toUpperCase();
      const paths = Array.isArray(payload.storage_paths) ? (payload.storage_paths as string[]) : [];
      if (!PROFILES[state]) return json({ error: `no file profile for state ${state}` }, 400);
      if (!paths.length) return json({ error: "storage_paths required" }, 400);

      const { data: src } = await db.from("ph_ucc_sources").select("id").eq("state", state).eq("kind", "file").limit(1).maybeSingle();
      const fingerprint = `${state}|${[...paths].sort().join(",")}`;
      const { data: created, error: cErr } = await db.from("ph_ucc_ingest_jobs").insert({
        state, source_id: src?.id ?? null, origin: "upload", status: "processing",
        storage_paths: paths, phase_index: 0, byte_offset: 0, fingerprint,
        started_at: new Date().toISOString(), message: "queued", phase: PROFILES[state].passes[0],
      }).select("id").single();
      if (cErr) throw new Error(`job create failed: ${cErr.message}`);
      const jobId = created.id as string;

      const secret = await webhookSecret(db);
      if (secret) reinvoke(secret, jobId);
      else console.error("[ph-ucc-file-ingest] no webhook secret — job will not self-continue");
      return json({ ok: true, job_id: jobId, state, message: "ingest started" });
    }

    if (action === "continue") {
      const jobId = String(payload.job_id ?? "");
      if (!jobId) return json({ error: "job_id required" }, 400);
      const job = await loadJob(db, jobId);
      if (!job) return json({ error: "job not found" }, 404);
      if (job.status !== "processing") return json({ ok: true, skipped: true, status: job.status });
      const profile = PROFILES[job.state];
      if (!profile) return json({ error: `no profile for ${job.state}` }, 400);

      await loadAliasNorms(db, profile);
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
    const jobId = String(payload.job_id ?? "");
    if (jobId) await patchJob(db, jobId, { status: "error", error: msg, finished_at: new Date().toISOString() });
    return json({ ok: false, error: msg }, 500);
  }
});
