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
// GHL LeadConnector v2 allows ~100 requests / 10s per location (10/s). We target
// 9/s so setter-facing traffic — webhooks, HP sync, workflow calls — always has
// headroom and never starves behind a bulk load. The old default of 5 came from
// the original brief's "throttle <=5 rps", NOT from observed 429s: across today's
// pushes GHL has returned zero 429s and zero leads errored.
const DEFAULT_RPS = 9;
const MAX_RPS = 10;
const MIN_RPS = 2;          // floor when backing off under sustained 429s
// CONCURRENCY IS A CONNECTION BUDGET, NOT JUST A SPEED KNOB. Each worker holds a
// DB connection for the whole of its push+stamp. Twelve of them, window after
// window, is what exhausted this instance's connection slots overnight and left
// GoTrue unable to get one — the owner was locked out of the app for 7 hours while
// the database itself sat nearly idle. Concurrency is therefore DERIVED from the
// requested rate: a deliberately slow background job also holds few connections.
const MAX_CONCURRENCY = 12;
function concurrencyFor(rps: number): number {
  return Math.max(2, Math.min(MAX_CONCURRENCY, Math.ceil(rps * 1.4)));
}
const MAX_LEAD_IDS = 5000;   // explicit selections are hand-picked, not whole files
const ID_WINDOW = 500;       // .in() window when an explicit id list is used

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * ── ACTIVE: "lm" (owner-approved 2026-08-13) ──────────────────────────────────
 *
 * WHY THIS IS NOT `<lead_type>-lead`. That naming made a Lead Machine push write
 * `ucc-lead` — a tag already carried by 1,092 contacts and already wired into the
 * LIVE PH UCC dialing population. Any Lead Machine test or mis-filtered push
 * therefore dropped purchased leads straight into a real dial list. It did, once:
 * a 24-lead UI test on 2026-08-13 put 24 real Texas businesses into that tag
 * before being cleaned up.
 *
 * `lm-<lead_type>` is namespaced to this machine and cannot collide with
 * ph-ucc-push-ghl's `ucc-lead`, which is separate and intentional and stays as is.
 *
 * Flipped with zero history to unify: at the time of the change every one of the
 * 249,923 lead_records was status='loaded' with push_tags NULL, so no contact
 * anywhere carried a Lead Machine `<type>-lead` tag. If that ever stops being
 * true, a retag:true push is how history gets unified — the tag set is forward-
 * only per row.
 *
 * "legacy" is kept as a one-constant escape hatch, not as a supported mode.
 */
const TYPE_TAG_MODE: "legacy" | "lm" = "lm";

/** The automatic per-lead type tag. See TYPE_TAG_MODE. */
function typeTag(leadType: string): string {
  return TYPE_TAG_MODE === "lm" ? `lm-${leadType}` : `${leadType}-lead`;
}

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

/** How quiet a 'running' job must be before the watchdog assumes its chain died.
 * A healthy window checkpoints well inside this; 3 minutes is long enough that a
 * slow window is never mistaken for a dead one. */
const PUSH_STALL_MS = 180_000;

function reinvoke(secret: string, jobId: string, rps?: number): void {
  const url = `${SUPABASE_URL}/functions/v1/lead-push-ghl?secret=${encodeURIComponent(secret)}`;
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    // rps MUST ride the chain. Without it every continuation reset to the default,
    // so a job started at 10/s silently ran the rest of its life at the default.
    body: JSON.stringify({ action: "continue", job_id: jobId, ...(rps ? { rps } : {}) }),
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
  /** Rows whose push_tags do NOT contain this tag — the backfill selector. */
  push_tags_missing?: string;
  search?: string;                     // name / company / phone / email
  exclude_dups?: boolean;
}

type Job = {
  id: string; batch_id: string | null; lead_ids: string[] | null;
  filters: LeadFilters; tags: string[]; limit_n: number | null; retag: boolean;
  cursor_id: string | null; campaign_id: string | null;
  status: string; target_count: number; pushed: number; errored: number; skipped: number;
  stamp_retries: number;
};
const JOB_COLS = "id,batch_id,lead_ids,filters,tags,limit_n,retag,cursor_id,status,"
  + "target_count,pushed,errored,skipped,stamp_retries,campaign_id";

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
  // ...EXCEPT when the filter is push_tags_missing, which makes the selection
  // self-draining again: a row is selected precisely because it LACKS the tag we
  // are about to give it, and every terminal path stamps push_tags (the error
  // return writes them too), so a processed row can never be selected twice.
  // Ordering is then pure cost, and not a small one — ORDER BY id forces the PK
  // index, which walked 17,987 rows to find 250 Landline rows still missing
  // lt-landline: 7,386ms per chunk and climbing as the run tags more of the
  // book, until every window times out and the job sits at pushed=0 forever.
  // Unordered, the identical fetch is 23ms on lead_records_status_idx. This is
  // the O(n^2) drain bug from the 85k push wearing a different hat.
  if (job.filters?.push_tags_missing) return false;
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

  // has_email means PRIMARY **OR** ANY EXTRA — an email campaign can mail any of
  // them, so "has an email" must mean "is reachable by email". The predicate lives
  // in the generated column has_any_email so this fn, the search RPC and the
  // export cannot drift apart: there is exactly one definition, in the schema.
  if (typeof f.has_email === "boolean") q = q.eq("has_any_email", f.has_email);
  // Tag filter — hits the push_tags GIN index (array containment, ALL of them).
  const tagsIn = asArray(f.push_tags_contains);
  if (tagsIn) q = q.contains("push_tags", tagsIn.map((t) => t.toLowerCase()));
  // "missing this tag" — lets a backfill touch ONLY the rows that still need it,
  // instead of re-pushing every contact to add one attribute.
  if (f.push_tags_missing) {
    q = q.not("push_tags", "cs", `{${f.push_tags_missing.trim().toLowerCase()}}`);
  }

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
  line_type: string | null;
  phone: string | null; email: string | null;
  first_name: string | null; last_name: string | null; company: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  push_tags: string[] | null;
  extra_phones: { phone: string }[] | null;
}
const LEAD_COLS = "id,batch_id,lead_type,status,line_type,phone,email,first_name,last_name,"
  + "company,address,city,state,zip,push_tags,extra_phones";

/** Count the rows a job will touch (respecting its limit). This is the SAME
 * filter code the push itself runs, which is why `action:'count'` is exposed to
 * the UI — "N leads" on screen and "N leads pushed" can never disagree. */
/** PostgREST sometimes returns an error object with an EMPTY message (an aborted
 * count reads as `count failed: ` and tells nobody anything). Build something
 * actionable out of whatever fields are present. */
// deno-lint-ignore no-explicit-any
function errText(e: any): string {
  const parts = [e?.message, e?.details, e?.hint, e?.code].filter((x) => x && String(x).trim());
  return parts.length ? parts.map(String).join(" | ") : "no message from PostgREST (usually an aborted/timed-out count)";
}

/**
 * A broad count is expensive here by nature: "has an email" matches 249,411 of
 * 249,923 rows, so counting it reads essentially the whole table (~6s measured).
 * On this shared instance that occasionally aborts, which surfaced as an empty
 * error and a failed push. One retry turns an intermittent failure into a slower
 * success; a genuine error still fails, now with a readable message.
 */
// deno-lint-ignore no-explicit-any
async function countWithRetry(build: () => any, what: string): Promise<number> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { count, error } = await build();
    if (!error) return count ?? 0;
    if (attempt === 2) throw new Error(`count failed (${what}): ${errText(error)}`);
    console.warn("[lead-push-ghl] count aborted, retrying:", errText(error));
    await sleep(750);
  }
  return 0;
}

async function countTarget(db: SupabaseClient, job: Job): Promise<number> {
  if (job.lead_ids?.length) {
    let n = 0;
    for (let i = 0; i < job.lead_ids.length; i += ID_WINDOW) {
      const slice = job.lead_ids.slice(i, i + ID_WINDOW);
      n += await countWithRetry(
        () => applyFilters(db.from("lead_records").select("id", { count: "exact", head: true }), job).in("id", slice),
        "ids",
      );
    }
    return job.limit_n ? Math.min(n, job.limit_n) : n;
  }
  const n = await countWithRetry(
    () => applyFilters(db.from("lead_records").select("id", { count: "exact", head: true }), job),
    "filters",
  );
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
    // DRAIN MODE IS DELIBERATELY UNORDERED. Ordering by created_at forced the
    // planner onto the (batch_id, created_at) index, where finding the next 250
    // un-pushed rows meant scanning past EVERY already-pushed row — O(pushed) per
    // chunk, O(n^2) over a run. That is what killed the 85k job at 59% (4.3s per
    // fetch and climbing, until it crossed the 8s statement timeout).
    //
    // Unordered, the partial index lead_records_drain_idx (batch_id WHERE
    // status='loaded' AND phone IS NOT NULL) answers it in ~2ms and SHRINKS as the
    // push progresses. Order is meaningless here anyway: a drained row leaves the
    // selection, so every row is visited exactly once whatever the sequence.
    if (cursorMode) {
      q = q.order("id", { ascending: true });
      if (cursor) q = q.gt("id", cursor);
    }
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
/** The line-type attribute tag, so the owner can slice mobile/landline INSIDE
 * VibeReach instead of only pre-push. Same class as lm-* — provenance/attribute,
 * dials nothing. Unknown/null line types get no tag rather than a junk one. */
const LINE_TYPE_TAG: Record<string, string> = {
  "mobile": "lt-mobile",
  "landline": "lt-landline",
  "voip": "lt-voip",
  "toll-free": "lt-tollfree",
};
function lineTypeTag(lineType: string | null): string | null {
  if (!lineType) return null;
  return LINE_TYPE_TAG[lineType.trim().toLowerCase()] ?? null;
}

/** Where the app lives, for the one-click deep link stamped on every contact. */
const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");

/**
 * The "open this merchant in the Revenue Playbook" link, stamped into a GHL
 * custom field so a setter can jump straight from the VibeReach contact panel
 * into the playbook with the deal already loaded.
 *
 * Deliberately the PHONE form (?phone=<last10>), not the contact-id form (?x=):
 * the phone is already on the row, so the link is computable BEFORE the upsert
 * and rides along in the same request. The id form would need a second API call
 * per contact to learn the id GHL just assigned — doubling this push's
 * rate-limited cost for no gain, since PlaybooksPage resolves both through the
 * same playbook-open-contact fn. lead_records.phone is stored as normalized
 * NANP last-10, which is exactly what dialDigits/the resolver match on.
 */
function playbookLink(lead: LeadRow): string | null {
  return lead.phone ? `${APP_URL}/admin/playbooks?phone=${lead.phone}` : null;
}

function tagsFor(lead: LeadRow, batchTag: string | undefined, userTags: string[]): string[] {
  const lt = lineTypeTag(lead.line_type);
  const out = [
    typeTag(lead.lead_type),
    ...(lt ? [lt] : []),
    ...(batchTag ? [batchTag] : []),
    ...userTags,
    ...(lead.push_tags ?? []),
  ].map((t) => t.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(out));
}

/** Push one lead. Returns the stamp patch for lead_records. */
async function pushOne(
  cfg: GhlConfig, lead: LeadRow, tags: string[], batchCode: string | undefined,
  onRateLimit?: (retryAfterMs: number | null) => void,
): Promise<Record<string, unknown>> {
  const email = lead.email && EMAIL_RE.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
  const link = playbookLink(lead);
  const customFields = link ? [{ key: "playbook_link", field_value: link }] : [];
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
    // Extra numbers ride along so a setter sees every way to reach the merchant.
    // GHL wants OBJECTS here (a string array 422s), and there is deliberately no
    // email equivalent: /contacts/upsert rejects additionalEmails outright, so
    // extra emails live in Supabase + the export rather than in a second API
    // call per contact that would double this push's rate-limited cost.
    ...((lead.extra_phones ?? []).length
      ? { additionalPhones: (lead.extra_phones ?? []).map((p) => ({ phone: `+1${p.phone}` })) }
      : {}),
    tags,
    customFields,
    source: `Lead Machine${batchCode ? ` ${batchCode.toUpperCase()}` : ""}`,
  }, onRateLimit);
  let contactId = res.data?.contact?.id ?? null;
  let isNew = res.data?.new;

  // GHL is stricter about email syntax than our validator: addresses like
  // "george@gs/interprises.info" pass ours and are rejected by theirs. Losing the
  // whole lead over a bad email throws away a perfectly dialable PHONE, so retry
  // once WITHOUT the address. The lead lands; only the email is dropped.
  if (!res.ok && email && /email must be an email/i.test(ghlErrorMessage(res.error))) {
    const retry = await upsertContact(cfg, {
      firstName: clean(lead.first_name),
      lastName: clean(lead.last_name),
      companyName: clean(lead.company),
      phone: lead.phone ? `+1${lead.phone}` : undefined,
      address1: clean(lead.address),
      city: clean(lead.city),
      state: clean(lead.state),
      postalCode: clean(lead.zip),
      ...((lead.extra_phones ?? []).length
        ? { additionalPhones: (lead.extra_phones ?? []).map((p) => ({ phone: `+1${p.phone}` })) }
        : {}),
      tags,
      customFields,
      source: `Lead Machine${batchCode ? ` ${batchCode.toUpperCase()}` : ""}`,
    }, onRateLimit);
    if (retry.ok && retry.data?.contact?.id) {
      contactId = retry.data.contact.id;
      isNew = retry.data.new;
      return {
        status: "pushed",
        ghl_contact_id: contactId,
        matched_existing: typeof isNew === "boolean" ? !isNew : null,
        pushed_at: new Date().toISOString(),
        push_tags: tags,
        push_error: "pushed without email — GHL rejected the address as invalid",
      };
    }
  }

  if (!res.ok || !contactId) {
    return {
      status: "error",
      push_error: (res.ok ? "upsert returned no contact id" : ghlErrorMessage(res.error)).slice(0, 500),
      push_tags: tags,
    };
  }
  // Did we CREATE this contact, or attach to one that already existed? GHL's
  // upsert dedupes on phone OR email, so a purchased lead can silently land on a
  // real merchant's existing record. Recording it is what lets a cleanup path
  // delete only what it created. `new === undefined` stays NULL — unknown, which
  // blocks deletion too (see the column comment).
  return {
    status: "pushed",
    ghl_contact_id: contactId,
    matched_existing: typeof isNew === "boolean" ? !isNew : null,
    pushed_at: new Date().toISOString(),
    push_tags: tags,
    push_error: null,
  };
}


/**
 * Token-bucket pacing with 429 feedback.
 *
 * The old shape was "waves of N requests, each wave padded to >=1 second". That
 * caps throughput at N/s even when everything is fast, AND it made the DB stamps
 * serial inside each wave, so slow stamps pushed the observed rate BELOW the cap
 * (measured 4.29/s against a nominal 5). A bucket decouples the two: requests are
 * paced by tokens, work runs concurrently, and stamps overlap instead of queueing.
 *
 * ADAPTIVE: a 429 halves the rate immediately (floor MIN_RPS) and honours
 * Retry-After by pausing the bucket; success ramps it back toward target slowly.
 * So a rate limit slows the push down rather than erroring leads out.
 */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private rate: number;
  private pausedUntil = 0;
  private backoffs = 0;
  constructor(private readonly target: number) {
    this.rate = target;
    this.tokens = target;
  }
  get currentRate(): number { return this.rate; }
  get backoffCount(): number { return this.backoffs; }
  note429(retryAfter: number | null): void {
    this.backoffs++;
    this.rate = Math.max(MIN_RPS, this.rate / 2);
    if (retryAfter && retryAfter > 0) {
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + retryAfter);
    }
    console.warn("[lead-push-ghl] 429 — rate halved", JSON.stringify({
      new_rate: Number(this.rate.toFixed(2)), retry_after_ms: retryAfter,
    }));
  }
  /** Slow recovery: ~1 token/sec of sustained success to climb back to target. */
  noteSuccess(): void {
    if (this.rate < this.target) this.rate = Math.min(this.target, this.rate + 0.02);
  }
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now < this.pausedUntil) { await sleep(this.pausedUntil - now); continue; }
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.lastRefill) / 1000) * this.rate);
      this.lastRefill = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(Math.max(20, Math.ceil(((1 - this.tokens) / this.rate) * 1000)));
    }
  }
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
  const limiter = new RateLimiter(rps);
  let pushed = 0, errored = 0, stampRetries = 0, sinceReport = 0;
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

    // ── Concurrent workers, paced by the shared token bucket ────────────────
    // Each worker takes the next lead, waits for a token, pushes, then stamps its
    // OWN row — so the DB writes overlap instead of serialising behind the wave
    // as they used to. The limiter (not CONCURRENCY) sets the rate.
    let nextIdx = 0;
    let bailed = false;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (bailed) return;
        const i = nextIdx++;
        if (i >= rows.length) return;
        const lead = rows[i];
        const batchTag = tagMap[lead.batch_id];
        const tags = tagsFor(lead, batchTag, job.tags);

        await limiter.acquire();
        let patch: Record<string, unknown>;
        try {
          patch = await pushOne(cfg, lead, tags, batchTag, (ra) => limiter.note429(ra));
          if (patch.status === "pushed") limiter.noteSuccess();
        } catch (e) {
          patch = {
            status: "error",
            push_error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
            push_tags: tags,
          };
        }

        const { error } = await db.from("lead_records").update(patch).eq("id", lead.id);
        if (error) {
          // GHL took the contact but our stamp did not land. This is NOT a failed
          // lead: the row stays 'loaded', so the drain re-selects and re-pushes it,
          // and the upsert matches the contact that already exists. Counting these
          // as `errored` overstated real failures to the owner — 11 of the first
          // 12 "errors" on the 85k push were this, and every one self-healed.
          console.error("[lead-push-ghl] stamp failed (row stays loaded, will retry)",
            JSON.stringify({ lead_id: lead.id, error: error.message }));
          stampRetries++;
        } else if (patch.status === "pushed") { pushed++; touchedBatches.add(lead.batch_id); }
        else { errored++; touchedBatches.add(lead.batch_id); }

        // Progress every ~50 completions — live enough for the UI without a DB
        // write per contact.
        if (++sinceReport >= 50) {
          sinceReport = 0;
          await patchJob(db, job.id, {
            pushed: job.pushed + pushed, errored: job.errored + errored,
            stamp_retries: (job.stamp_retries ?? 0) + stampRetries,
            message: `pushed ${job.pushed + pushed}${job.target_count ? ` of ${job.target_count}` : ""}`
              + (limiter.backoffCount ? ` (rate ${limiter.currentRate.toFixed(1)}/s after ${limiter.backoffCount} backoff(s))` : ""),
          });
        }
        if (Date.now() - started > budgetMs) { bailed = true; return; }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrencyFor(rps), rows.length) }, () => worker()),
    );

    // CURSOR MODE: only advance once the WHOLE chunk finished. Workers complete
    // out of order, so there is no safe "highest id done" mid-chunk — and
    // re-processing a chunk is harmless anyway (upsert + tag union are idempotent,
    // and drain mode has already left those rows non-selectable).
    if (cursorMode && !bailed && rows.length) cursor = rows[rows.length - 1].id;

    if (bailed) {
      await patchJob(db, job.id, {
        pushed: job.pushed + pushed, errored: job.errored + errored,
        stamp_retries: (job.stamp_retries ?? 0) + stampRetries,
        ...(cursorMode ? { cursor_id: cursor } : {}),
        message: `pushed ${job.pushed + pushed}${job.target_count ? ` of ${job.target_count}` : ""}`,
      });
      for (const b of touchedBatches) await db.rpc("lead_batch_refresh_counts", { p_batch_id: b });
      return { done: false, pushed, errored };
    }

    for (const b of touchedBatches) await db.rpc("lead_batch_refresh_counts", { p_batch_id: b });
    await patchJob(db, job.id, {
      pushed: job.pushed + pushed, errored: job.errored + errored,
      stamp_retries: (job.stamp_retries ?? 0) + stampRetries,
      ...(cursorMode ? { cursor_id: cursor } : {}),
      message: `pushed ${job.pushed + pushed}${job.target_count ? ` of ${job.target_count}` : ""}`,
    });
    if (Date.now() - started > budgetMs) return { done: false, pushed, errored };
  }
}

/**
 * EMERGENCY KILL SWITCH — set true to stop every push chain dead.
 *
 * The self-reinvoke chain cannot be stopped from the database once the database
 * itself is saturated: cancelling the job row requires a connection, and there are
 * none left. This flag is the out-of-band brake — it returns before ANY DB or GHL
 * work, so the chain starves itself within one window and connections drain.
 *
 * Flip to false and redeploy to resume normal operation.
 */
const PUSH_KILL_SWITCH = false;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (PUSH_KILL_SWITCH) {
    return json({
      ok: false,
      killed: true,
      error: "lead-push-ghl is disabled by PUSH_KILL_SWITCH (emergency brake). "
        + "No DB or GHL work was performed. Redeploy with the flag false to resume.",
    }, 503);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";

  // A job created DURING this request, so the error handler can still find it.
  // `start` has no job_id in its payload, so a timeout inside its inline window
  // used to fall through the timeout branch below and return a bare error — while
  // the job row it had just inserted sat at status='running' with no continuation
  // ever scheduled. The caller reasonably concluded nothing had started and
  // retried, and each retry stranded another orphan. Three of them accumulated on
  // 2026-08-14 before the fourth happened to survive.
  let createdJobId: string | null = null;

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
        // Which dial campaign this push feeds. The job row records the RUN; the
        // durable per-lead attribution is the campaign's dial_tag inside
        // lead_records.push_tags, which outlives the job row.
        campaign_id: clean(payload.campaign_id),
        status: "running",
        message: "counting",
        created_by: callerId,
      }).select(JOB_COLS).single();
      if (cErr) throw new Error(`job create failed: ${cErr.message}`);
      const job = created as unknown as Job;
      createdJobId = job.id;

      // COUNTING AT START IS OPT-OUT, for the same reason it is on the search RPC.
      // A retag count over ~25k rows carries a NOT-containment that no index can
      // serve, so `start` sat there counting until the CALLER timed out — while the
      // job it had already created ran on happily. The caller then believed the
      // pass never started, moved to the next one, and two live passes fought.
      // A background runner that already knows its target passes with_count:false.
      const wantCount = payload.with_count !== false;
      const target = wantCount ? await countTarget(db, job) : 0;
      await patchJob(db, job.id, {
        target_count: target,
        message: wantCount ? `queued — ${target} eligible` : "queued — target not counted (with_count:false)",
      });
      job.target_count = target;

      if (wantCount && target === 0) {
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
        if (secret) reinvoke(secret, job.id, rps);
        else await patchJob(db, job.id, { status: "error", error: "no webhook secret — cannot self-continue" });
      }
      return json({
        ok: true, job_id: job.id, target_count: target, pushed, errored, done,
        mode: isCursorMode(job) ? "retag" : "push",
        // Derived from typeTag() rather than written out, so this note can never
        // drift from what the push actually applied.
        auto_tags_note: `each contact also gets ${typeTag("<lead_type>")} and its lowercased batch code`,
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
        retag: payload.retag === true, cursor_id: null, campaign_id: null,
        status: "", target_count: 0, pushed: 0, errored: 0, skipped: 0, stamp_retries: 0,
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
        if (secret) reinvoke(secret, jobId, rps);
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

    // ── sweep: the WATCHDOG that makes the reinvoke chain self-healing ──
    // A self-reinvoke chain has one fatal weakness, and lead-file-ingest already
    // learned it the hard way: when the runtime KILLS a worker (HTTP 546
    // WORKER_LIMIT, an OOM, a deploy mid-flight) NO catch block runs, so nothing
    // marks the job failed and nothing schedules the next window. The job sits at
    // status='running' with a frozen updated_at, looking perfectly alive, and only
    // a human notices. That is exactly how the lt-landline pass died at 18,613 of
    // 24,437 on 2026-08-14 with the DB, GHL and the drain query all healthy.
    //
    // This finds those and hands them a fresh window. It is a no-op when every job
    // is healthy, and it deliberately only touches status='running' — a CANCEL
    // still wins, because a canceled job is no longer running and this never
    // resurrects it. rps is not persisted on the job, so a resumed window uses the
    // default; that is the safe direction (slower, not faster).
    if (action === "sweep") {
      const cutoff = new Date(Date.now() - PUSH_STALL_MS).toISOString();
      const { data: stalled, error: sErr } = await db.from("lead_push_jobs")
        .select("id,pushed,updated_at")
        .eq("status", "running").lt("updated_at", cutoff);
      if (sErr) throw new Error(`sweep query failed: ${sErr.message}`);
      const rows = (stalled as { id: string; pushed: number }[]) ?? [];
      const secret = providedSecret || (await webhookSecret(db));
      if (!secret && rows.length) return json({ error: "no webhook secret — cannot restart" }, 500);
      for (const j of rows) {
        console.warn("[lead-push-ghl] sweep restarting stalled job",
          JSON.stringify({ job_id: j.id, pushed: j.pushed }));
        await patchJob(db, j.id, { message: `watchdog restart at ${j.pushed} pushed` });
        reinvoke(secret, j.id);
      }
      return json({ ok: true, restarted: rows.length, jobs: rows.map((j) => ({ id: j.id, pushed: j.pushed })) });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const jobId = String(payload.job_id ?? createdJobId ?? "");

    // A STATEMENT TIMEOUT IS A SLOW WINDOW, NOT A BROKEN JOB. Killing the job on
    // one is how a 50,677-of-85,600 push ended up dead needing a manual resume.
    // The design is already resumable — only status='loaded' rows send — so the
    // right response is to hand off to a fresh window with a smaller budget and
    // let the chain carry on.
    const isTimeout = /57014|canceling statement|statement timeout/i.test(msg);
    if (isTimeout && jobId) {
      console.warn("[lead-push-ghl] window timed out — retrying in a fresh window", jobId);
      await patchJob(db, jobId, {
        message: `window timed out, retrying (${msg.slice(0, 80)})`,
      });
      const secret = providedSecret || (await webhookSecret(db));
      if (secret) {
        reinvoke(secret, jobId, rps);
        return json({ ok: true, job_id: jobId, retried_after_timeout: true }, 200);
      }
      // No secret: nothing can pick the job back up, so this IS terminal.
      await patchJob(db, jobId, {
        status: "error",
        error: `${msg} (and no webhook secret to self-continue)`,
        finished_at: new Date().toISOString(),
      });
      return json({ ok: false, error: msg }, 500);
    }

    console.error("[lead-push-ghl] FAILED", msg);
    if (jobId) await patchJob(db, jobId, { status: "error", error: msg, finished_at: new Date().toISOString() });
    return json({ ok: false, error: msg }, 500);
  }
});
