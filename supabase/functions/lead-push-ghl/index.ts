// lead-push-ghl — the PUSH half of the LEAD MACHINE.
//
// Supabase holds the whole purchased book (lead_records). This function pushes a
// FILTERED SELECTION of it into GoHighLevel as TAGGED contacts. HotProspector then
// syncs by tag and the dialer campaigns dial by tag — the same proven path the PH
// UCC machine uses, generalized to any purchased list.
//
// TAGS ARE THE PROTOCOL. Every pushed contact gets, automatically:
//   • the TYPE tag   — ucc-lead | aged-lead | trigger-lead
//   • the BATCH tag  — the lowercased batch_code, e.g. ucc-20260813
// plus whatever campaign tags the caller passes (e.g. dial-aug-week3). The type +
// batch tags are added PER LEAD from that lead's own batch, so a push whose filter
// spans several batches still tags each contact with its true origin.
//
// UPSERT ONLY. POST /contacts/upsert dedupes on phone/email inside the location, so
// a merchant already in GHL is enriched and tagged, never duplicated. There is no
// blind create anywhere in this function.
//
// IDEMPOTENT BY CONSTRUCTION: the worker only ever selects lead_records with
// status='loaded' and stamps 'pushed' on success. A re-invoke, a resume after the
// wall clock, or a re-run of the same job can therefore never double-push a
// contact. A per-lead failure stamps status='error' + push_error and the run
// continues; those rows are visible in the UI and can be retried by resetting them.
//
// RE-TAG (retag:true) is the deliberate exception: it revisits rows that are
// already 'pushed' (and 'error' rows, which is how you retry them) to add a NEW
// tag to an already-pushed slice. GHL's upsert MERGES tags rather than replacing
// them, so the push sends — and push_tags stores — the UNION of the lead's
// existing tags and the new ones. That keeps lead_records.push_tags an exact
// mirror of the contact's tags in GHL, which the UI's tag filter and CSV export
// depend on. Because those rows never leave the selection, a retag job paginates
// on a stable id cursor (lead_push_jobs.cursor_id) instead of draining.
//
// RATE: ≤5 requests/sec by default (configurable up to 10), with the shared GHL
// client's 429/5xx retry + backoff. Long pushes run in self-reinvoking windows
// with live progress on lead_push_jobs.
//
// AUTH: verify_jwt at the gateway PLUS an in-code role check — admin/super_admin
// only. Continuations use the cron path (?secret=<GHL webhook secret> + anon
// Bearer). A service-role bearer deliberately fails the role check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, ghlErrorMessage, type GhlConfig,
} from "../_shared/ghl.ts";

const BUDGET_MS = 50_000;    // wall-clock window before self-reinvoke
const SELECT_CHUNK = 250;    // rows fetched per DB round-trip
const DEFAULT_RPS = 5;
const MAX_RPS = 10;
const MAX_LEAD_IDS = 5000;   // explicit selections are hand-picked, not whole files
const ID_WINDOW = 500;       // .in() window when an explicit id list is used

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (v: unknown): string | null => {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
};
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

function reinvoke(secret: string, jobId: string): void {
  const url = `${SUPABASE_URL}/functions/v1/lead-push-ghl?secret=${encodeURIComponent(secret)}`;
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: "continue", job_id: jobId }),
  }).then(() => {}).catch((e) => console.error("[lead-push-ghl] reinvoke failed:", e));
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

// ── Filters ───────────────────────────────────────────────────────────────────
// Both naming forms are accepted for the revenue bounds (min_revenue /
// revenue_min) because the UI and this function were specced independently — a
// silent mismatch there would push the wrong population, so neither name loses.
export interface LeadFilters {
  state?: string | string[];
  lead_type?: string | string[];
  line_type?: string | string[];
  status?: string | string[];          // explicit → cursor mode (see selectionMode)
  min_revenue?: number;
  max_revenue?: number;
  revenue_min?: number;
  revenue_max?: number;
  secured_party_ilike?: string;
  secured_party?: string;
  has_email?: boolean;
  push_tags_contains?: string | string[];
  search?: string;                     // name / company / phone / email
  exclude_dups?: boolean;
}

type Job = {
  id: string; batch_id: string | null; lead_ids: string[] | null;
  filters: LeadFilters; tags: string[]; limit_n: number | null; retag: boolean;
  cursor_id: string | null;
  status: string; target_count: number; pushed: number; errored: number; skipped: number;
};
const JOB_COLS = "id,batch_id,lead_ids,filters,tags,limit_n,retag,cursor_id,status,"
  + "target_count,pushed,errored,skipped";

/**
 * DRAIN vs CURSOR — the one thing to understand about this function.
 *
 * DRAIN (the default): select status='loaded', push, stamp 'pushed'. The row
 * leaves the selection, which is exactly what makes a resume or a re-run
 * incapable of double-pushing. No cursor needed.
 *
 * CURSOR (retag:true, or an explicit filters.status): the job deliberately
 * revisits rows that are ALREADY 'pushed' (to add a tag) or 'error' (to retry).
 * Those rows never leave the selection, so progress is tracked by a stable id
 * cursor persisted on the job instead.
 */
function isCursorMode(job: Job): boolean {
  return !!job.retag || job.filters?.status != null;
}
function statusesFor(job: Job): string[] {
  const explicit = asArray(job.filters?.status as string | string[] | undefined);
  if (explicit) return explicit.map((s) => s.toLowerCase());
  return job.retag ? ["loaded", "pushed", "error"] : ["loaded"];
}

const asArray = (v: string | string[] | undefined): string[] | null => {
  if (v == null) return null;
  const a = (Array.isArray(v) ? v : [v]).map((s) => String(s).trim()).filter(Boolean);
  return a.length ? a : null;
};

/** Apply a job's filters to a lead_records query. Shared by the count and the fetch
 * so "how many will go" and "what actually goes" can never disagree. */
// deno-lint-ignore no-explicit-any
function applyFilters(q: any, job: Job) {
  // A lead with no phone is not dialable and is never pushed, whatever the mode.
  q = q.in("status", statusesFor(job)).not("phone", "is", null);
  if (job.batch_id) q = q.eq("batch_id", job.batch_id);
  const f = job.filters ?? {};
  const st = asArray(f.state);
  if (st) q = q.in("state", st.map((s) => s.toUpperCase()));
  const lt = asArray(f.lead_type);
  if (lt) q = q.in("lead_type", lt.map((s) => s.toLowerCase()));
  const ln = asArray(f.line_type);
  if (ln) q = q.in("line_type", ln);

  const minRev = f.min_revenue ?? f.revenue_min;
  const maxRev = f.max_revenue ?? f.revenue_max;
  if (typeof minRev === "number") q = q.gte("revenue", minRev);
  if (typeof maxRev === "number") q = q.lte("revenue", maxRev);

  const sp = f.secured_party_ilike ?? f.secured_party;
  if (sp) q = q.ilike("secured_party", `%${sp}%`);

  if (typeof f.has_email === "boolean") {
    q = f.has_email ? q.not("email", "is", null) : q.is("email", null);
  }
  // Tag filter — hits the push_tags GIN index (array containment, ALL of them).
  const tagsIn = asArray(f.push_tags_contains);
  if (tagsIn) q = q.contains("push_tags", tagsIn.map((t) => t.toLowerCase()));

  if (f.search) {
    const s = f.search.replace(/[%,()]/g, " ").trim();
    if (s) {
      q = q.or(
        `first_name.ilike.%${s}%,last_name.ilike.%${s}%,company.ilike.%${s}%,` +
        `phone.ilike.%${s}%,email.ilike.%${s}%`,
      );
    }
  }
  if (f.exclude_dups) q = q.eq("is_dup_of_prior", false);
  return q;
}

interface LeadRow {
  id: string; batch_id: string; lead_type: string; status: string;
  phone: string | null; email: string | null;
  first_name: string | null; last_name: string | null; company: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  push_tags: string[] | null;
}
const LEAD_COLS = "id,batch_id,lead_type,status,phone,email,first_name,last_name,"
  + "company,address,city,state,zip,push_tags";

/** Count the rows a job will touch (respecting its limit). This is the SAME
 * filter code the push itself runs, which is why `action:'count'` is exposed to
 * the UI — "N leads" on screen and "N leads pushed" can never disagree. */
async function countTarget(db: SupabaseClient, job: Job): Promise<number> {
  if (job.lead_ids?.length) {
    let n = 0;
    for (let i = 0; i < job.lead_ids.length; i += ID_WINDOW) {
      const { count, error } = await applyFilters(
        db.from("lead_records").select("id", { count: "exact", head: true }), job,
      ).in("id", job.lead_ids.slice(i, i + ID_WINDOW));
      if (error) throw new Error(`count failed: ${error.message}`);
      n += count ?? 0;
    }
    return job.limit_n ? Math.min(n, job.limit_n) : n;
  }
  const { count, error } = await applyFilters(
    db.from("lead_records").select("id", { count: "exact", head: true }), job,
  );
  if (error) throw new Error(`count failed: ${error.message}`);
  const n = count ?? 0;
  return job.limit_n ? Math.min(n, job.limit_n) : n;
}

/**
 * Next slice for a job. DRAIN mode just takes the next `want` matching rows (the
 * ones it pushes leave the selection). CURSOR mode orders by id and walks past
 * `cursor`, because in that mode the rows it touches stay selectable.
 */
async function nextRows(
  db: SupabaseClient, job: Job, want: number, cursor: string | null,
): Promise<LeadRow[]> {
  const cursorMode = isCursorMode(job);
  // deno-lint-ignore no-explicit-any
  const shape = (q: any) => {
    q = cursorMode ? q.order("id", { ascending: true }) : q.order("created_at", { ascending: true });
    if (cursorMode && cursor) q = q.gt("id", cursor);
    return q;
  };

  if (job.lead_ids?.length) {
    const out: LeadRow[] = [];
    for (let i = 0; i < job.lead_ids.length && out.length < want; i += ID_WINDOW) {
      const { data, error } = await shape(
        applyFilters(db.from("lead_records").select(LEAD_COLS), job),
      ).in("id", job.lead_ids.slice(i, i + ID_WINDOW)).limit(want - out.length);
      if (error) throw new Error(`fetch failed: ${error.message}`);
      out.push(...((data as unknown as LeadRow[]) ?? []));
    }
    return out;
  }
  const { data, error } = await shape(
    applyFilters(db.from("lead_records").select(LEAD_COLS), job),
  ).limit(want);
  if (error) throw new Error(`fetch failed: ${error.message}`);
  return (data as unknown as LeadRow[]) ?? [];
}

/** batch_id → lowercased batch_code, for the automatic per-lead batch tag. */
async function batchTagMap(db: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!ids.length) return map;
  const { data, error } = await db.from("lead_batches").select("id,batch_code").in("id", ids);
  if (error) throw new Error(`batch lookup failed: ${error.message}`);
  for (const b of (data as { id: string; batch_code: string }[]) ?? []) {
    map[b.id] = b.batch_code.toLowerCase();
  }
  return map;
}

/**
 * The FULL final tag set for a contact: the automatic type tag + the batch tag +
 * the caller's tags, UNIONED with whatever this lead was already pushed with.
 *
 * The union is what makes a re-tag push honest. GHL's upsert merges tags rather
 * than replacing them, so a re-push that sent only the new tag would leave the
 * contact holding old+new while lead_records.push_tags held only new — and the
 * UI's tag filter/export would then disagree with GHL. Sending and storing the
 * union keeps both sides identical.
 */
function tagsFor(lead: LeadRow, batchTag: string | undefined, userTags: string[]): string[] {
  const out = [
    `${lead.lead_type}-lead`,
    ...(batchTag ? [batchTag] : []),
    ...userTags,
    ...(lead.push_tags ?? []),
  ].map((t) => t.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(out));
}

/** Push one lead. Returns the stamp patch for lead_records. */
async function pushOne(
  cfg: GhlConfig, lead: LeadRow, tags: string[], batchCode: string | undefined,
): Promise<Record<string, unknown>> {
  const email = lead.email && EMAIL_RE.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
  const res = await upsertContact(cfg, {
    firstName: clean(lead.first_name),
    lastName: clean(lead.last_name),
    companyName: clean(lead.company),
    phone: lead.phone ? `+1${lead.phone}` : undefined,
    email: email ?? undefined,
    address1: clean(lead.address),
    city: clean(lead.city),
    state: clean(lead.state),
    postalCode: clean(lead.zip),
    tags,
    source: `Lead Machine${batchCode ? ` ${batchCode.toUpperCase()}` : ""}`,
  });
  const contactId = res.data?.contact?.id ?? null;
  if (!res.ok || !contactId) {
    return {
      status: "error",
      push_error: (res.ok ? "upsert returned no contact id" : ghlErrorMessage(res.error)).slice(0, 500),
      push_tags: tags,
    };
  }
  return {
    status: "pushed",
    ghl_contact_id: contactId,
    pushed_at: new Date().toISOString(),
    push_tags: tags,
    push_error: null,
  };
}

async function patchJob(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("lead_push_jobs").update(patch).eq("id", id);
  if (error) console.error("[lead-push-ghl] job patch failed:", error.message);
}

/**
 * Run one wall-clock window of a job. Returns done=true when there is nothing
 * left to push (filter exhausted or the job's limit reached).
 */
async function runWindow(
  db: SupabaseClient, cfg: GhlConfig, job: Job, rps: number, budgetMs: number,
): Promise<{ done: boolean; pushed: number; errored: number }> {
  const started = Date.now();
  const cursorMode = isCursorMode(job);
  let pushed = 0, errored = 0, wavesSinceReport = 0;
  let cursor = job.cursor_id;
  const touchedBatches = new Set<string>();
  // DRAIN mode only: leads already attempted in THIS window. A lead whose stamp
  // write failed stays 'loaded' and would otherwise be re-selected forever here.
  // CURSOR mode doesn't need this — the id cursor always moves forward.
  const attempted = new Set<string>();

  for (;;) {
    const remaining = job.limit_n != null
      ? job.limit_n - (job.pushed + job.errored + pushed + errored)
      : Number.MAX_SAFE_INTEGER;
    if (remaining <= 0) return { done: true, pushed, errored };

    const want = Math.min(SELECT_CHUNK, remaining);
    const fetched = await nextRows(db, job, cursorMode ? want : want + attempted.size, cursor);
    const rows = cursorMode ? fetched : fetched.filter((r) => !attempted.has(r.id)).slice(0, want);
    if (!fetched.length) return { done: true, pushed, errored };
    if (!rows.length) {
      // Everything still selectable failed to stamp — hand off to a fresh invocation.
      console.error("[lead-push-ghl] all selectable rows already attempted this window", job.id);
      return { done: false, pushed, errored };
    }
    if (!cursorMode) for (const r of rows) attempted.add(r.id);

    const tagMap = await batchTagMap(db, Array.from(new Set(rows.map((r) => r.batch_id))));

    // Waves of `rps` requests, each wave taking at least a second → ≤ rps req/sec.
    for (let i = 0; i < rows.length; i += rps) {
      const waveStart = Date.now();
      const wave = rows.slice(i, i + rps);
      const results = await Promise.all(wave.map(async (lead) => {
        const batchTag = tagMap[lead.batch_id];
        const tags = tagsFor(lead, batchTag, job.tags);
        try {
          return { lead, patch: await pushOne(cfg, lead, tags, batchTag) };
        } catch (e) {
          return {
            lead,
            patch: {
              status: "error",
              push_error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
              push_tags: tags,
            },
          };
        }
      }));

      for (const { lead, patch } of results) {
        const { error } = await db.from("lead_records").update(patch).eq("id", lead.id);
        if (error) {
          // GHL took the contact but we failed to stamp: report loudly. The row
          // stays 'loaded' so the next run reconciles it (upsert makes that safe).
          console.error("[lead-push-ghl] stamp failed", JSON.stringify({ lead_id: lead.id, error: error.message }));
          errored++;
        } else if (patch.status === "pushed") { pushed++; touchedBatches.add(lead.batch_id); }
        else { errored++; touchedBatches.add(lead.batch_id); }
      }

      // Advance the cursor PER WAVE, not per chunk: bailing on the budget
      // mid-chunk with a chunk-end cursor would silently skip the untouched tail.
      if (cursorMode) cursor = wave[wave.length - 1].id;

      const progress = () => ({
        pushed: job.pushed + pushed, errored: job.errored + errored,
        ...(cursorMode ? { cursor_id: cursor } : {}),
        message: `pushed ${job.pushed + pushed}${job.target_count ? ` of ${job.target_count}` : ""}`,
      });

      // Progress every ~10 waves (~50 contacts / ~10s) — live enough for the UI
      // without a DB write per contact.
      if (++wavesSinceReport >= 10) {
        wavesSinceReport = 0;
        await patchJob(db, job.id, progress());
      }

      if (Date.now() - started > budgetMs) {
        await patchJob(db, job.id, progress());
        for (const b of touchedBatches) await db.rpc("lead_batch_refresh_counts", { p_batch_id: b });
        return { done: false, pushed, errored };
      }
      const elapsed = Date.now() - waveStart;
      if (elapsed < 1000 && i + rps < rows.length) await sleep(1000 - elapsed);
    }

    for (const b of touchedBatches) await db.rpc("lead_batch_refresh_counts", { p_batch_id: b });
    await patchJob(db, job.id, {
      pushed: job.pushed + pushed, errored: job.errored + errored,
      ...(cursorMode ? { cursor_id: cursor } : {}),
      message: `pushed ${job.pushed + pushed}${job.target_count ? ` of ${job.target_count}` : ""}`,
    });
    if (Date.now() - started > budgetMs) return { done: false, pushed, errored };
  }
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
  const rps = Math.min(Math.max(Number(payload.rps) || DEFAULT_RPS, 1), MAX_RPS);
  const budgetMs = Number(payload.budget_ms) > 0 ? Number(payload.budget_ms) : BUDGET_MS;

  try {
    if (action === "status") {
      const { data } = await db.from("lead_push_jobs").select("*")
        .eq("id", String(payload.job_id ?? "")).maybeSingle();
      return data ? json({ ok: true, job: data }) : json({ error: "job not found" }, 404);
    }

    if (action === "start") {
      const tags = Array.isArray(payload.tags)
        ? (payload.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
      if (!tags.length) return json({ error: "tags[] is required and must be non-empty" }, 400);

      const idsRaw = payload.lead_ids;
      const leadIds = Array.isArray(idsRaw)
        ? Array.from(new Set(idsRaw.filter((x): x is string => typeof x === "string" && !!x)))
        : null;
      if (leadIds && leadIds.length > MAX_LEAD_IDS) {
        return json({ error: `lead_ids capped at ${MAX_LEAD_IDS} — use filters for a whole batch` }, 400);
      }
      const batchId = clean(payload.batch_id);
      if (!batchId && !leadIds?.length && !payload.filters) {
        return json({ error: "one of batch_id, lead_ids[] or filters is required" }, 400);
      }

      const { data: created, error: cErr } = await db.from("lead_push_jobs").insert({
        batch_id: batchId,
        lead_ids: leadIds,
        filters: (payload.filters as Record<string, unknown>) ?? {},
        tags,
        limit_n: Number(payload.limit) > 0 ? Number(payload.limit) : null,
        retag: payload.retag === true,
        status: "running",
        message: "counting",
        created_by: callerId,
      }).select(JOB_COLS).single();
      if (cErr) throw new Error(`job create failed: ${cErr.message}`);
      const job = created as unknown as Job;

      const target = await countTarget(db, job);
      await patchJob(db, job.id, { target_count: target, message: `queued — ${target} eligible` });
      job.target_count = target;

      if (target === 0) {
        await patchJob(db, job.id, {
          status: "complete", finished_at: new Date().toISOString(),
          message: "nothing eligible — 0 rows matched (already pushed, or filtered out)",
        });
        return json({ ok: true, job_id: job.id, target_count: 0, pushed: 0, errored: 0, done: true });
      }

      // Small pushes run inline so the UI gets a real answer immediately.
      const cfg = await getGhlConfig(db);
      const { done, pushed, errored } = await runWindow(db, cfg, job, rps, budgetMs);
      if (done) {
        await patchJob(db, job.id, {
          status: "complete", finished_at: new Date().toISOString(),
          message: `Complete — ${job.pushed + pushed} pushed, ${job.errored + errored} errored.`,
        });
      } else {
        const secret = await webhookSecret(db);
        if (secret) reinvoke(secret, job.id);
        else await patchJob(db, job.id, { status: "error", error: "no webhook secret — cannot self-continue" });
      }
      return json({
        ok: true, job_id: job.id, target_count: target, pushed, errored, done,
        mode: isCursorMode(job) ? "retag" : "push",
        auto_tags_note: "each contact also gets <lead_type>-lead and its lowercased batch code",
      });
    }

    // ── count: the SAME filter code the push runs, so the UI's "N leads" and the
    // push's target_count are the same number by construction. No writes. ──
    if (action === "count") {
      const job = {
        id: "", batch_id: clean(payload.batch_id), lead_ids: Array.isArray(payload.lead_ids)
          ? (payload.lead_ids as string[]).slice(0, MAX_LEAD_IDS) : null,
        filters: (payload.filters as LeadFilters) ?? {}, tags: [],
        limit_n: Number(payload.limit) > 0 ? Number(payload.limit) : null,
        retag: payload.retag === true, cursor_id: null,
        status: "", target_count: 0, pushed: 0, errored: 0, skipped: 0,
      } as Job;
      const count = await countTarget(db, job);
      return json({ ok: true, count, mode: isCursorMode(job) ? "retag" : "push" });
    }

    if (action === "continue") {
      const jobId = String(payload.job_id ?? "");
      if (!jobId) return json({ error: "job_id required" }, 400);
      const { data } = await db.from("lead_push_jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
      const job = data as unknown as Job | null;
      if (!job) return json({ error: "job not found" }, 404);
      if (job.status !== "running") return json({ ok: true, skipped: true, status: job.status });

      const cfg = await getGhlConfig(db);
      const { done, pushed, errored } = await runWindow(db, cfg, job, rps, budgetMs);
      if (done) {
        await patchJob(db, jobId, {
          status: "complete", finished_at: new Date().toISOString(),
          message: `Complete — ${job.pushed + pushed} pushed, ${job.errored + errored} errored.`,
        });
      } else {
        const secret = providedSecret || (await webhookSecret(db));
        if (secret) reinvoke(secret, jobId);
        else await patchJob(db, jobId, { status: "error", error: "no webhook secret — cannot self-continue" });
      }
      return json({ ok: true, job_id: jobId, pushed, errored, done });
    }

    if (action === "cancel") {
      const jobId = String(payload.job_id ?? "");
      if (!jobId) return json({ error: "job_id required" }, 400);
      await patchJob(db, jobId, { status: "canceled", finished_at: new Date().toISOString(), message: "canceled" });
      return json({ ok: true, job_id: jobId, status: "canceled" });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lead-push-ghl] FAILED", msg);
    const jobId = String(payload.job_id ?? "");
    if (jobId) await patchJob(db, jobId, { status: "error", error: msg, finished_at: new Date().toISOString() });
    return json({ ok: false, error: msg }, 500);
  }
});
