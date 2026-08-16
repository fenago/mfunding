// ghl-create-opportunities — bulk-create GHL opportunities from tagged contacts.
//
// PURPOSE. Turn a TAGGED slice of the GoHighLevel contact book into opportunities
// in the MCA pipeline — used both for a one-time ~145K backfill and, ongoing, by a
// Lead Machine UI panel. It creates opportunities only; it never sends comms and
// never touches HotProspector.
//
// WHY OPPORTUNITIES AT ALL. Creating an MCA-pipeline opportunity is what makes a
// contact visible in the closer pipeline and (via the app's opportunity→deal sync)
// what can mint a deal. The DEFAULT stage is New Lead ON PURPOSE: a separate gate
// (owned by another agent) prevents New-Lead opportunities from auto-creating deals,
// so a 62K backfill populates the pipeline without flooding the deals table. This
// function is deliberately agnostic to that gate — it just creates at New Lead.
//
// ── IDEMPOTENCY (this WILL be re-run) — THREE LAYERS, LOW-CALL ────────────────
// 1) MARKER TAG (`mca-opp-created`, configurable). EVERY search excludes contacts
//    that already carry it (server-side `not_contains`), so the ~53,808 opps a prior
//    run already created — which carry the marker — drop out of the working set for
//    FREE, no per-contact lookup. Each returned contact's own tags are re-checked too.
// 2) FORWARD CURSOR. searchAfter is monotonic; within a run (and its auto_continue
//    chain) a contact is never re-examined, so no duplicate can be created even
//    WITHOUT writing a marker. This is what lets the bulk finish run write_marker:false
//    (one GHL call per opp instead of two) — see WRITE_MARKER below.
// 3) PERSISTED CURSOR. After every chunk the resume state (cursor + tallies) is saved
//    to platform_settings key `ghl_opp_backfill`, keyed by a run fingerprint
//    (tags+marker+pipeline). A fresh trigger with no cursor RESUMES from it instead of
//    restarting from the top, so an accidental re-trigger can't duplicate. Pass
//    restart:true to deliberately start the fingerprint over. (This is the cheap,
//    edge-feasible substitute for enumerating the whole pipeline's opportunities:
//    ~145K opps ≈ 1,450 GHL calls, which exceeds a single invocation's wall clock and
//    would repeat per auto_continue chunk — so we never do it.)
//
// ── WRITE_MARKER (call-budget lever) ──────────────────────────────────────────
// write_marker (default TRUE = classic UI behavior) attaches the marker on create,
// costing a 2nd GHL call/opp. The bulk finish sets it FALSE: layers 2+3 make the
// marker unnecessary for correctness, and halving the calls keeps a ~92K finish
// (~92K calls) comfortably under GHL's 200K/day cap.
//
// ── DAILY-CAP PARKING ─────────────────────────────────────────────────────────
// Every GHL response's x-ratelimit-daily-remaining is read; when it reaches
// daily_floor (default 500) the run STOPS cleanly (persists cursor, does NOT
// reinvoke) rather than spinning on 429s or blowing the cap. Resume after reset.
//
// ── STATE EXCLUSION ──────────────────────────────────────────────────────────
// exclude_states (default TX/CA/VA) are dropped. A BLANK/unknown state PASSES
// THROUGH (we only exclude an explicit match). Server-side this is `state not_eq`
// per excluded state (state codes are 2 chars, and GHL's `contains` needs ≥3, so
// `not_eq` is the only workable operator — verified live). Per-contact re-check too.
//
// ROBOTS. Contacts tagged `lt-source` (LT list-delivery / sender robots) are never
// touched — excluded server-side and re-checked per contact.
//
// ── SPLIT LEVERS (create mode) ───────────────────────────────────────────────
// OWNER: assign_user_id pins every opp to one GHL user; round_robin_user_ids
// rotates the owner deterministically by creation index (round-robin wins if both
// are given). Neither → opps are left unassigned. Set via the opp's `assignedTo`.
// EXTRA TAGS: extra_tags are added to each contact alongside the marker on create,
// so arbitrary split labels (heat / campaign / owner) can be stamped for filtering.
//
// ── MODES ────────────────────────────────────────────────────────────────────
// mode:"count"  — DRY RUN. Returns GLOBAL bucket totals in a handful of cheap
//                 total-only queries (no creates): { matched, skipped_state,
//                 already_created, to_create, next_cursor:null }.
// mode:"create" — Creates opportunities for up to ~`limit` contacts this call, then
//                 returns { created, skipped_state, skipped_existing, processed,
//                 next_cursor, done }. Caller loops with next_cursor until done.
//
// TAG FILTER SHAPE (verified live against /contacts/search):
//   1 tag  → [{ field:"tags", operator:"contains", value:"<tag>" }]
//   N tags → [{ group:"OR", filters:[ {contains t1}, {contains t2}, … ] }]  (OR, deduped)
// AND'd with not_contains<marker>, not_contains<lt-source>, and state not_eq<each>.
//
// ── AUTO-CONTINUE (headless, one-trigger completion) ──────────────────────────
// mode:"create" with auto_continue:true runs a THROTTLED chunk (≤limit creates or
// ~50s, whichever first) and then SELF-REINVOKES via the trusted-secret path with
// the returned next_cursor, until done. So a single server-side trigger finishes
// the whole ~92K backfill unattended — no open browser tab. Resumable + idempotent
// (cursor + marker tag), safe to re-trigger. rr_offset/chunk_index are carried
// across reinvokes so round-robin stays deterministic and progress is observable.
//
// AUTH: verify_jwt at the gateway PLUS one of two in-code paths:
//   • TRUSTED SECRET (headless/cron/self-reinvoke): ?secret=<GHL webhook_secret>
//     (or x-ghl-secret header) matched against get_ghl_config().webhook_secret /
//     env GHL_WEBHOOK_SECRET, with an anon-key Bearer at the gateway. No user JWT.
//   • USER JWT (the UI): admin / super_admin ONLY (NOT closers).
// A service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, createOpportunity,
  addContactTags, ghlErrorMessage, type GhlConfig,
} from "../_shared/ghl.ts";

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PIPELINE = "bG9ZEh4eP9x60E1CyaMx";                 // MFunding MCA Pipeline
const DEFAULT_STAGE = "d60d563a-9904-423f-9a8e-0d0df0b12976";   // New Lead
const DEFAULT_EXCLUDE = ["TX", "CA", "VA"];
const DEFAULT_MARKER = "mca-opp-created";
const ROBOT_TAG = "lt-source";

const DEFAULT_LIMIT = 100;      // creates per create-call before returning (modest — gentle chunks)
const MAX_LIMIT = 1000;
const PAGE_LIMIT = 100;         // GHL /contacts/search page size
const CONCURRENCY = 3;          // parallel creates per wave (each = 2 GHL calls) — kept LOW on purpose
const BUDGET_MS = 50_000;       // wall-clock window; the rest comes back as next_cursor / a self-reinvoke
const MAX_ERRORS_REPORTED = 50; // cap the per-error sample so the response stays small

// ── THROTTLE ──────────────────────────────────────────────────────────────────
// GHL rate-limits bulk work (LeadConnector v2 ~100 req / 10s per resource). An
// UNthrottled browser-driven run created ~53.8K opps overnight, generated ~107.6K
// webhook events, and is now getting HTTP 429. So creation here is PACED:
//   • CONCURRENCY=3 (≤6 GHL calls/wave) with a per-wave FLOOR so the steady rate
//     sits at ~3 calls/sec — well under the ceiling.
//   • On ANY 429 seen (via ghlFetch's onRateLimit hook), a caller-side COOLDOWN is
//     applied on TOP of ghlFetch's own per-call retry/backoff, so the whole run
//     slows down instead of continuing to push at a rate GHL is already refusing.
//     ghlFetch never DROPS a 429'd contact — it retries with backoff (Retry-After
//     honored); the cooldown just makes the next wave gentler.
const TARGET_RPS = 7;           // sustained GHL request ceiling we pace toward (well under 100/10s)
const COOLDOWN_BASE_MS = 3_000; // first 429 → add this much before the next wave
const COOLDOWN_MAX_MS = 30_000; // cap the escalating cooldown
const COOLDOWN_DECAY = 0.5;     // each clean wave halves the standing cooldown
const REINVOKE_ON_FAIL_MS = 45_000; // auto_continue: after a hard search failure, wait this long before resuming
const DEFAULT_MAX_CHUNKS = 5_000;   // auto_continue safety net (~92K/100 ≈ 920 chunks needed)
const DEFAULT_DAILY_FLOOR = 500;    // PARK (stop, don't reinvoke) when x-ratelimit-daily-remaining ≤ this

const STATE_KEY = "ghl_opp_backfill"; // platform_settings row that persists the resumable cursor

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SELF_FN = "ghl-create-opportunities";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A stable fingerprint for a backfill run (tags + marker + pipeline). The
 * persisted cursor is keyed by this so two different backfills don't clobber each
 * other's resume point. */
function runFingerprint(tags: string[], markerTag: string, pipelineId: string): string {
  return `${[...tags].sort().join("|")}::${markerTag}::${pipelineId}`;
}

/** Load the persisted resume state for this run fingerprint (or null). Free — this
 * is Supabase, not a GHL call. */
async function loadState(
  db: SupabaseClient, fp: string,
): Promise<{ cursor: string | null; created_total: number; done: boolean } | null> {
  const { data } = await db.from("platform_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  const v = (data?.value ?? null) as { fingerprint?: string; cursor?: string | null; created_total?: number; done?: boolean } | null;
  if (!v || v.fingerprint !== fp) return null;
  return { cursor: v.cursor ?? null, created_total: Number(v.created_total ?? 0), done: !!v.done };
}

/** Persist the resume state (cursor + tallies). Best-effort but LOUD on failure —
 * a lost cursor is what forces a re-enumeration/duplicate risk we're avoiding. */
async function saveState(db: SupabaseClient, fp: string, patch: Record<string, unknown>) {
  const nowIso = new Date().toISOString();
  const value = { fingerprint: fp, updated_at: nowIso, ...patch };
  const { error } = await db.from("platform_settings")
    .upsert({ key: STATE_KEY, value, updated_at: nowIso }, { onConflict: "key" });
  if (error) console.error("[ghl-create-opportunities] saveState failed:", error.message);
}

/** Resolve the trusted webhook secret (vault via get_ghl_config, env fallback). */
async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data: gc } = await db.rpc("get_ghl_config");
  return (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
}

/** Fire-and-forget self-reinvoke via the trusted-secret path (anon Bearer at the
 * gateway + ?secret in-code), mirroring ph-ucc-file-ingest. Optional delayMs lets
 * a post-429 resume wait for GHL to recover WITHOUT hammering (the runtime keeps
 * the promise alive via waitUntil). One trigger thus completes the whole list. */
function reinvoke(secret: string, body: Record<string, unknown>, delayMs = 0): void {
  const url = `${SUPABASE_URL}/functions/v1/${SELF_FN}?secret=${encodeURIComponent(secret)}`;
  const p = (async () => {
    try {
      if (delayMs > 0) await sleep(delayMs);
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("[ghl-create-opportunities] reinvoke failed:", e instanceof Error ? e.message : String(e));
    }
  })();
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

const clean = (v: unknown): string => (v ?? "").toString().trim();

/** Normalize a 2-letter state for comparison (upper, trimmed). */
const normState = (v: unknown): string => clean(v).toUpperCase();

interface GhlSearchContact {
  id: string;
  tags?: string[];
  state?: string | null;
  companyName?: string | null;
  businessName?: string | null;
  contactName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** Contact custom fields as GHL returns them on /contacts/search: [{ id, value }]
   * (value = string | string[]). Read to pull optional pass-through fields
   * (positions/score/funders) onto the opportunity; absent on lists that never
   * carried them, in which case those opp fields are simply skipped. */
  customFields?: Array<{ id?: string; value?: unknown }>;
  searchAfter?: unknown[];
}

// ── Opportunity custom-field id map (config-driven; deploy-safe before fields exist)
// Read at runtime from platform_settings key `ghl_opp_custom_field_map` (jsonb),
// the SAME decoupled pattern as the contact cf_* map (which get_ghl_config surfaces).
// Each logical name → a GHL OPPORTUNITY custom-field id. Any key that is absent/blank
// means that field is simply NOT stamped — so deploying now, before the fields are
// created in GHL and their ids persisted here, changes nothing (graceful skip). A
// missing field id NEVER fails an opportunity create.
interface OppFieldMap {
  lead_state?: string;
  lead_type?: string;
  active_positions?: string;
  mca_score?: string;
  current_funders?: string;
}

/** Load the opportunity custom-field id map from platform_settings. Free (Supabase,
 * not GHL). Absent/malformed row → {} → nothing gets stamped. */
async function loadOppFieldMap(db: SupabaseClient): Promise<OppFieldMap> {
  const { data } = await db.from("platform_settings")
    .select("value").eq("key", "ghl_opp_custom_field_map").maybeSingle();
  const v = (data?.value ?? null) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return {};
  const pick = (k: string): string | undefined => {
    const s = clean(v[k]);
    return s.length ? s : undefined;
  };
  return {
    lead_state: pick("lead_state"),
    lead_type: pick("lead_type"),
    active_positions: pick("active_positions"),
    mca_score: pick("mca_score"),
    current_funders: pick("current_funders"),
  };
}

/** Flatten a contact's custom fields into { cfId → string value } (arrays joined),
 * so an opportunity field can pull its value by the CONTACT custom-field id. */
function contactCfValues(c: GhlSearchContact): Record<string, string> {
  const out: Record<string, string> = {};
  const cf = Array.isArray(c.customFields) ? c.customFields : [];
  for (const f of cf) {
    if (!f || typeof f !== "object") continue;
    const id = clean(f.id);
    if (!id) continue;
    const raw = f.value;
    const val = Array.isArray(raw)
      ? raw.map((x) => clean(x)).filter((s) => s.length > 0).join(", ")
      : clean(raw);
    if (val) out[id] = val;
  }
  return out;
}

/** Build the OPPORTUNITY customFields array for one contact from the config map.
 * Only emits an entry when BOTH the opp field id (from the map) AND a value exist,
 * so an unconfigured map or a blank value yields [] and nothing is stamped. */
function buildOppCustomFields(
  c: GhlSearchContact, source: string | undefined, oppMap: OppFieldMap, cfg: GhlConfig,
): Array<{ id: string; field_value: string }> {
  const out: Array<{ id: string; field_value: string }> = [];
  const add = (id: string | undefined, val: string) => {
    if (id && val) out.push({ id, field_value: val });
  };
  // Lead State — the contact's 2-letter state (normalized upper). Filterable in the
  // Opportunities view once the field exists.
  add(oppMap.lead_state, normState(c.state));
  // Lead Type — the run's source label (Aged / UCC / Trigger). Unset if no source.
  add(oppMap.lead_type, source ?? "");
  // Optional pass-throughs, pulled from the contact's EXISTING custom fields by the
  // contact cf ids from the vault map. Purchased lists usually lack these → skipped.
  const cvals = contactCfValues(c);
  add(oppMap.active_positions, cfg.cfExistingPositions ? (cvals[cfg.cfExistingPositions] ?? "") : "");
  add(oppMap.mca_score, cfg.cfMcaScore ? (cvals[cfg.cfMcaScore] ?? "") : "");
  add(oppMap.current_funders, cfg.cfCurrentFunders ? (cvals[cfg.cfCurrentFunders] ?? "") : "");
  return out;
}

/** The opportunity name for a contact: company → business → contact name →
 * first+last → email → a stable fallback. Never empty (GHL rejects a blank name). */
function opportunityName(c: GhlSearchContact): string {
  const candidates = [
    clean(c.companyName),
    clean(c.businessName),
    clean(c.contactName),
    `${clean(c.firstName)} ${clean(c.lastName)}`.trim(),
    clean(c.email),
  ];
  return candidates.find((s) => s.length > 0) ?? "MCA Lead";
}

/** Build the positive tag filter: a single `contains`, or an OR group for many. */
function tagFilter(tags: string[]): Record<string, unknown> {
  if (tags.length === 1) {
    return { field: "tags", operator: "contains", value: tags[0] };
  }
  return {
    group: "OR",
    filters: tags.map((t) => ({ field: "tags", operator: "contains", value: t })),
  };
}

/** Base filter set shared by count + create: tags (OR) AND not-marker AND not-robot
 * AND (state not_eq each excluded). Optionally omit the state clauses (count uses
 * them to derive skipped_state by difference). */
function buildFilters(
  tags: string[], markerTag: string, excludeStates: string[], withState: boolean,
): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [
    tagFilter(tags),
    { field: "tags", operator: "not_contains", value: markerTag },
    { field: "tags", operator: "not_contains", value: ROBOT_TAG },
  ];
  if (withState) {
    for (const st of excludeStates) filters.push({ field: "state", operator: "not_eq", value: st });
  }
  return filters;
}

/** One /contacts/search page. Returns { total, contacts }. */
async function searchPage(
  cfg: GhlConfig, filters: Record<string, unknown>[], pageLimit: number, searchAfter?: unknown[],
) {
  const body: Record<string, unknown> = { locationId: cfg.locationId, pageLimit, filters };
  if (searchAfter && Array.isArray(searchAfter) && searchAfter.length) body.searchAfter = searchAfter;
  return await ghlFetch<{ contacts: GhlSearchContact[]; total: number }>(
    cfg, "POST", "/contacts/search", body,
  );
}

/** Cheap total-only count for a filter set (pageLimit 1). Throws on a hard error so
 * count mode reports a real failure rather than a silently-wrong zero. */
async function totalFor(cfg: GhlConfig, filters: Record<string, unknown>[]): Promise<number> {
  const res = await searchPage(cfg, filters, 1);
  if (!res.ok) throw new Error(`contacts/search failed: ${ghlErrorMessage(res.error)}`);
  return Number(res.data?.total ?? 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const reqUrl = new URL(req.url);

  // ── Auth: trusted secret (headless) OR signed-in admin/super_admin (the UI) ────
  // The secret path mirrors ph-ucc-push-ghl: ?secret / x-ghl-secret matched against
  // get_ghl_config().webhook_secret (env fallback). It carries NO user JWT, so it's
  // what cron / manual curl / the self-reinvoke use. Closers are never allowed here.
  const providedSecret = reqUrl.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  let trusted = false;
  if (providedSecret) {
    const expected = await webhookSecret(db);
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
    trusted = true;
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
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }

  // ── Inputs ────────────────────────────────────────────────────────────────
  const tagsRaw = (payload as { tags?: unknown }).tags;
  const tags = Array.isArray(tagsRaw)
    ? Array.from(new Set(tagsRaw.map((t) => clean(t)).filter((t) => t.length > 0)))
    : [];
  if (tags.length === 0) return json({ error: "tags[] is required (at least one tag)" }, 400);

  const mode = clean((payload as { mode?: unknown }).mode);
  if (mode !== "count" && mode !== "create") {
    return json({ error: 'mode must be "count" or "create"' }, 400);
  }

  const exRaw = (payload as { exclude_states?: unknown }).exclude_states;
  const excludeStates = (Array.isArray(exRaw)
    ? Array.from(new Set(exRaw.map((s) => normState(s)).filter((s) => s.length > 0)))
    : DEFAULT_EXCLUDE.slice());

  const pipelineId = clean((payload as { pipeline_id?: unknown }).pipeline_id) || DEFAULT_PIPELINE;
  const stageId = clean((payload as { stage_id?: unknown }).stage_id) || DEFAULT_STAGE;
  const markerTag = clean((payload as { marker_tag?: unknown }).marker_tag) || DEFAULT_MARKER;

  const rawValue = Number((payload as { value?: unknown }).value);
  const value = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 0;

  // Optional Opportunity Source label (e.g. "Aged" / "UCC" / "Trigger"). When
  // omitted we leave it unset — never invent one. Stamped on every created opp so
  // the Opportunities page can filter/save a view per lead type.
  const source = clean((payload as { source?: unknown }).source) || undefined;

  // ── Owner assignment (optional) ─────────────────────────────────────────────
  // assign_user_id pins every created opp to one GHL user. round_robin_user_ids
  // rotates the owner deterministically by creation index across the given users.
  // If both are given, round-robin wins (it's the more specific intent). If neither,
  // opportunities are left UNASSIGNED.
  const assignUserId = clean((payload as { assign_user_id?: unknown }).assign_user_id) || undefined;
  const rrRaw = (payload as { round_robin_user_ids?: unknown }).round_robin_user_ids;
  const roundRobin = Array.isArray(rrRaw)
    ? rrRaw.map((u) => clean(u)).filter((u) => u.length > 0)
    : [];

  // ── Extra tags (optional) ───────────────────────────────────────────────────
  // Added to each contact alongside the marker tag on create, so the owner can
  // stamp arbitrary split labels (heat, campaign, etc.) for later filtering. Never
  // includes the marker itself here — that's always added; extras are additive.
  const etRaw = (payload as { extra_tags?: unknown }).extra_tags;
  const extraTags = Array.isArray(etRaw)
    ? Array.from(new Set(etRaw.map((t) => clean(t)).filter((t) => t.length > 0 && t !== markerTag)))
    : [];

  const rawLimit = Number((payload as { limit?: unknown }).limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  // Cursor: the JSON-encoded searchAfter array of the last contact from a prior call.
  let cursor: unknown[] | undefined;
  const cursorRaw = (payload as { cursor?: unknown }).cursor;
  if (typeof cursorRaw === "string" && cursorRaw.trim().length) {
    try {
      const parsed = JSON.parse(cursorRaw);
      if (Array.isArray(parsed) && parsed.length) cursor = parsed;
    } catch {
      return json({ error: "cursor must be a JSON-encoded array (from a prior next_cursor)" }, 400);
    }
  }

  // ── Auto-continue (headless one-trigger completion) ─────────────────────────
  // When true and mode:"create", the function re-invokes ITSELF with next_cursor
  // (trusted-secret path) until done. chunk_index/max_chunks are a safety net;
  // rr_offset carries round-robin position across reinvokes so it stays balanced.
  const autoContinue = (payload as { auto_continue?: unknown }).auto_continue === true;
  const chunkIndex = Math.max(0, Math.floor(Number((payload as { chunk_index?: unknown }).chunk_index) || 0));
  const rawMaxChunks = Number((payload as { max_chunks?: unknown }).max_chunks);
  const maxChunks = Number.isFinite(rawMaxChunks) && rawMaxChunks > 0 ? Math.floor(rawMaxChunks) : DEFAULT_MAX_CHUNKS;
  const rrOffset = Math.max(0, Math.floor(Number((payload as { rr_offset?: unknown }).rr_offset) || 0));

  // write_marker: attach the per-contact marker tag on create (idempotency belt).
  // Default TRUE (the UI's classic 2-call behavior). The LOW-CALL bulk finish sets
  // it FALSE — halving GHL usage — because within an auto_continue chain the FORWARD
  // CURSOR already guarantees no contact is revisited, and the 53,808 already-created
  // opps carry the marker so they stay excluded server-side regardless. Cross-run
  // idempotency then rides on the persisted cursor (below), not a per-lead tag write.
  const writeMarker = (payload as { write_marker?: unknown }).write_marker !== false;

  // restart: ignore any persisted cursor and start this fingerprint from the top.
  const restart = (payload as { restart?: unknown }).restart === true;

  // Park the run when the GHL DAILY cap is nearly exhausted (read from response
  // headers) so we never spin on 429s and never blow the cap.
  const rawFloor = Number((payload as { daily_floor?: unknown }).daily_floor);
  const dailyFloor = Number.isFinite(rawFloor) && rawFloor >= 0 ? Math.floor(rawFloor) : DEFAULT_DAILY_FLOOR;

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // Secret needed to self-reinvoke headlessly. If invoked WITH a secret, reuse it;
  // if invoked via the UI's user JWT but auto_continue was asked for, resolve it.
  const selfSecret = autoContinue ? (providedSecret || (await webhookSecret(db))) : "";

  // ── Resume-by-persisted-cursor (create mode only) — SAFETY CRITICAL ─────────
  // Because the low-call path writes NO marker on new creates, the persisted cursor
  // is the SOLE dup-guard across triggers. So a bare re-trigger MUST resume from the
  // saved cursor and MUST NEVER scan from the top (a top scan with no markers would
  // re-create this run's opps). The ONLY way to start from zero is an explicit
  // restart:true. If a non-restart trigger finds NO saved cursor, we PARK and report
  // rather than guess — an operator then decides (restart:true to begin fresh).
  //
  // In-chain reinvokes always carry an explicit `cursor`, so they bypass this block.
  //
  // SCOPE: this persisted-cursor machinery is engaged ONLY when write_marker:false
  // (the marker-less bulk path, where the cursor is the sole dup-guard). When the
  // marker IS written (the UI's classic path), a top scan is safe — marked contacts
  // are excluded server-side — so we leave that flow exactly as it was: no persisted
  // state, no park guard, the client drives its own cursor loop.
  const usePersistedCursor = !writeMarker;
  const fingerprint = runFingerprint(tags, markerTag, pipelineId);
  let resumedFromState = false;
  let priorCreated = 0;
  if (mode === "create" && usePersistedCursor && !cursor) {
    const st = await loadState(db, fingerprint);
    if (restart) {
      // Explicit fresh start — begin from the top, overwriting any saved cursor as
      // chunks progress. This is the intended first-run trigger.
      priorCreated = 0;
    } else if (st && st.done) {
      return json({
        ok: true, mode: "create", done: true, resumed_from_state: true, already_complete: true,
        created: 0, next_cursor: null, fingerprint,
        note: "This backfill fingerprint is already marked done. Pass restart:true to run it again.",
      });
    } else if (st?.cursor) {
      try {
        const parsed = JSON.parse(st.cursor);
        if (Array.isArray(parsed) && parsed.length) { cursor = parsed; resumedFromState = true; }
      } catch { /* fall through to the missing-cursor guard below */ }
      if (!resumedFromState) {
        return json({
          ok: false, mode: "create", error: "saved cursor is corrupt — refusing to scan from the top",
          parked: true, fingerprint,
          note: "Pass restart:true to deliberately begin this fingerprint from the top.",
        }, 409);
      }
      priorCreated = st.created_total ?? 0;
    } else {
      // No cursor supplied, no saved state (or saved state carries no cursor and
      // isn't done). Refuse to scan from zero — require an explicit restart.
      return json({
        ok: false, mode: "create", error: "no saved cursor for this run — refusing to scan from the top",
        parked: true, fingerprint, resumed_from_state: false,
        note: "This is the SOLE dup-guard when write_marker:false. Pass restart:true to begin from the top on purpose.",
      }, 409);
    }
  }

  const started = Date.now();

  // ── COUNT: global buckets from a handful of cheap total-only queries ──────────
  if (mode === "count") {
    try {
      // matched = every contact carrying ANY of the tags (no other filter).
      const matched = await totalFor(cfg, [tagFilter(tags)]);
      // already_created = tag-matched contacts that already carry the marker.
      const already_created = await totalFor(cfg, [
        tagFilter(tags), { field: "tags", operator: "contains", value: markerTag },
      ]);
      // eligible = tag-matched, not-yet-created, not a robot (state ignored).
      const eligible = await totalFor(cfg, buildFilters(tags, markerTag, excludeStates, false));
      // to_create = eligible AND state not in exclude (blank state passes through).
      const to_create = await totalFor(cfg, buildFilters(tags, markerTag, excludeStates, true));
      const skipped_state = Math.max(0, eligible - to_create);

      return json({
        ok: true,
        mode: "count",
        tags,
        exclude_states: excludeStates,
        marker_tag: markerTag,
        pipeline_id: pipelineId,
        stage_id: stageId,
        matched,
        already_created,
        // matched = already_created + robots + eligible; eligible = to_create + skipped_state.
        skipped_robot: Math.max(0, matched - already_created - eligible),
        skipped_state,
        to_create,
        next_cursor: null,
        elapsed_ms: Date.now() - started,
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  // ── CREATE: page the eligible set, create opps, mark each contact ─────────────
  // Opportunity custom-field id map (config-driven). Loaded once per invocation from
  // platform_settings — free, and empty until the fields are created + persisted, at
  // which point stamping activates with NO code change. Never blocks a create.
  const oppFieldMap = await loadOppFieldMap(db);

  const filters = buildFilters(tags, markerTag, excludeStates, true);
  let created = 0, skipped_state = 0, skipped_existing = 0, skipped_robot = 0;
  let errors = 0, processed = 0, marker_failed = 0;
  let done = false;
  let lastCursor: unknown[] | undefined = cursor;
  const errorSample: Array<{ contact_id: string; error: string }> = [];

  // Tags stamped on every created contact. With write_marker, that's the marker
  // (idempotency) + any extras; without it, ONLY the extras (often none), which lets
  // us skip the tag call entirely and spend just ONE GHL call per created opp.
  const createTags = Array.from(new Set([...(writeMarker ? [markerTag] : []), ...extraTags]));
  const tagsPerCreate = createTags.length ? 1 : 0;      // 0 = no second call
  const callsPerCreate = 1 + tagsPerCreate;             // createOpportunity (+ tag add)

  // Dynamic wave floor: hold each wave of CONCURRENCY creates long enough that the
  // sustained request rate stays at ~TARGET_RPS. (3 creates × 1 call ≈ 430ms;
  // 3 creates × 2 calls ≈ 860ms.)
  const waveFloorMs = Math.ceil((CONCURRENCY * callsPerCreate) / TARGET_RPS * 1000);

  // Daily-cap parking: the smallest x-ratelimit-daily-remaining we've seen. When it
  // drops to the floor we STOP and park (persist cursor, no reinvoke) rather than
  // burn the cap or spin on 429s.
  let dailyRemaining: number | null = null;
  let parked = false;
  const noteRate = (r?: { dailyRemaining: number | null } | undefined) => {
    if (r && typeof r.dailyRemaining === "number") {
      dailyRemaining = dailyRemaining == null ? r.dailyRemaining : Math.min(dailyRemaining, r.dailyRemaining);
    }
  };

  // Deterministic round-robin owner assignment, advanced once per contact we
  // actually attempt to create, preserved across pages within this call AND across
  // reinvokes (seeded from rr_offset, handed back to the next chunk).
  let rrIndex = rrOffset;
  const ownerFor = (): string | undefined => {
    if (roundRobin.length) return roundRobin[rrIndex++ % roundRobin.length];
    return assignUserId; // one fixed owner, or undefined = leave unassigned
  };

  // ── Adaptive throttle state ─────────────────────────────────────────────────
  // A standing cooldown that any 429 raises (added on top of ghlFetch's per-call
  // backoff) and every clean wave decays, so the whole run eases off GHL then
  // recovers its pace. saw429 flips whenever a 429 is observed this call.
  let cooldownMs = 0;
  let saw429 = false;
  const onRL = (raMs: number | null) => {
    saw429 = true;
    const bump = Math.max(cooldownMs > 0 ? cooldownMs * 2 : COOLDOWN_BASE_MS, raMs ?? 0);
    cooldownMs = Math.min(COOLDOWN_MAX_MS, bump);
  };

  // A resume body carrying every lever forward to the next chunk (auto_continue).
  const resumeBody = (nextCursor: unknown[] | undefined): Record<string, unknown> => ({
    tags, mode: "create", exclude_states: excludeStates, pipeline_id: pipelineId,
    stage_id: stageId, marker_tag: markerTag, value,
    ...(source ? { source } : {}),
    ...(assignUserId ? { assign_user_id: assignUserId } : {}),
    ...(roundRobin.length ? { round_robin_user_ids: roundRobin } : {}),
    ...(extraTags.length ? { extra_tags: extraTags } : {}),
    limit, auto_continue: true, chunk_index: chunkIndex + 1, max_chunks: maxChunks,
    rr_offset: rrIndex, write_marker: writeMarker, daily_floor: dailyFloor,
    cursor: nextCursor ? JSON.stringify(nextCursor) : undefined,
  });

  while (created < limit && Date.now() - started < BUDGET_MS) {
    const page = await searchPage(cfg, filters, PAGE_LIMIT, lastCursor);
    if (!page.ok) {
      // A search failure mid-run is terminal for THIS call; report what we did and
      // hand back the cursor so it can resume. Under auto_continue, a 429/5xx here
      // (ghlFetch already exhausted its retries) means GHL is hot — reinvoke AFTER
      // a long delay so we resume gently rather than hammer.
      noteRate(page.rate);
      const is429 = page.status === 429;
      // Persist the cursor BEFORE any reinvoke so a later manual/cron trigger resumes
      // exactly here (safety-critical when write_marker:false).
      if (usePersistedCursor) {
        await saveState(db, fingerprint, {
          cursor: lastCursor ? JSON.stringify(lastCursor) : null,
          created_total: priorCreated + created, done: false,
          last_status: `search ${page.status}`, chunk_index: chunkIndex,
        });
      }
      const willReinvoke = autoContinue && !!selfSecret && (is429 || page.status >= 500 || page.status === 0);
      if (willReinvoke) reinvoke(selfSecret, resumeBody(lastCursor), REINVOKE_ON_FAIL_MS);
      return json({
        ok: false, mode: "create", error: `contacts/search failed: ${ghlErrorMessage(page.error)}`,
        status: page.status,
        created, skipped_state, skipped_existing, skipped_robot, marker_failed, errors, processed,
        next_cursor: lastCursor ? JSON.stringify(lastCursor) : null, done: false,
        auto_continue: autoContinue, chunk_index: chunkIndex, reinvoked: willReinvoke,
        daily_remaining: dailyRemaining, fingerprint,
        elapsed_ms: Date.now() - started,
      }, 502);
    }
    noteRate(page.rate);
    const contacts = page.data?.contacts ?? [];
    if (contacts.length === 0) { done = true; break; }
    // Advance the cursor to the last contact of the page BEFORE creating, so a
    // resume never re-examines this page (idempotency's marker handles overlap).
    lastCursor = contacts[contacts.length - 1].searchAfter ?? lastCursor;

    // Partition this page (defensive re-checks — the server-side filter already
    // excludes these, but a contact whose tag change hasn't indexed yet can slip in).
    // Owner is resolved HERE, in stable page order, so round-robin is deterministic.
    const toCreate: Array<{ c: GhlSearchContact; owner?: string }> = [];
    for (const c of contacts) {
      processed++;
      const ctags = Array.isArray(c.tags) ? c.tags : [];
      if (ctags.includes(markerTag)) { skipped_existing++; continue; }
      if (ctags.includes(ROBOT_TAG)) { skipped_robot++; continue; }
      const st = normState(c.state);
      if (st && excludeStates.includes(st)) { skipped_state++; continue; }
      toCreate.push({ c, owner: ownerFor() });
    }

    // Create in small concurrent waves (each contact = createOpportunity + tag add),
    // PACED: every wave takes at least waveFloorMs, plus any standing 429 cooldown.
    for (let i = 0; i < toCreate.length; i += CONCURRENCY) {
      if (created >= limit || Date.now() - started > BUDGET_MS) break;
      const waveStart = Date.now();
      saw429 = false;
      const wave = toCreate.slice(i, i + CONCURRENCY);
      const results = await Promise.all(wave.map(async ({ c, owner }) => {
        try {
          // Opportunity-level custom fields (Lead State / Lead Type / optional
          // pass-throughs) ride the create POST for free. Empty until the map is
          // configured → omitted entirely, so behavior is unchanged pre-config.
          const oppCustomFields = buildOppCustomFields(c, source, oppFieldMap, cfg);
          const opp = await createOpportunity(cfg, {
            pipelineId, pipelineStageId: stageId, contactId: c.id,
            name: opportunityName(c), monetaryValue: value, status: "open",
            ...(source ? { source } : {}),
            ...(owner ? { assignedTo: owner } : {}),
            ...(oppCustomFields.length ? { customFields: oppCustomFields } : {}),
          }, onRL);
          noteRate(opp.rate);
          if (!opp.ok) return { c, ok: false as const, error: ghlErrorMessage(opp.error) };
          // Second call ONLY when we have tags to write (marker and/or extras).
          // write_marker:false with no extras = one GHL call total per opp.
          if (!createTags.length) return { c, ok: true as const, markerOk: true, markerErr: "" };
          const tag = await addContactTags(cfg, c.id, createTags, onRL);
          noteRate(tag.rate);
          return { c, ok: true as const, markerOk: tag.ok, markerErr: tag.ok ? "" : ghlErrorMessage(tag.error) };
        } catch (e) {
          return { c, ok: false as const, error: (e instanceof Error ? e.message : String(e)) };
        }
      }));
      // Pace: hold the wave to the floor, and add/decay the 429 cooldown so the run
      // slows on rate-limits and eases back up when GHL is happy again.
      if (saw429) {
        console.warn("[ghl-create-opportunities] 429 seen — cooling down", JSON.stringify({ cooldown_ms: cooldownMs }));
      } else if (cooldownMs > 0) {
        cooldownMs = Math.floor(cooldownMs * COOLDOWN_DECAY);
        if (cooldownMs < 250) cooldownMs = 0;
      }
      const elapsed = Date.now() - waveStart;
      const pause = Math.max(waveFloorMs - elapsed, 0) + cooldownMs;
      if (pause > 0) await sleep(pause);
      for (const r of results) {
        if (!r.ok) {
          errors++;
          if (errorSample.length < MAX_ERRORS_REPORTED) {
            errorSample.push({ contact_id: r.c.id, error: r.error.slice(0, 300) });
          }
          continue;
        }
        created++;
        if (!r.markerOk) {
          // The opportunity exists but the idempotency marker did NOT attach — LOUD,
          // because a future re-run could create a second opp for this contact.
          marker_failed++;
          console.error("[ghl-create-opportunities] marker tag attach FAILED (opp created)",
            JSON.stringify({ contact_id: r.c.id, marker_tag: markerTag, error: r.markerErr }));
        }
      }

      // ── PARK on daily-cap exhaustion ──────────────────────────────────────────
      // Read after the wave so `created` is current. Below the floor we stop cleanly
      // WITH a resumable cursor and DON'T reinvoke — never spin on 429s, never blow
      // the cap. Resume happens after the daily reset.
      if (dailyRemaining != null && dailyRemaining <= dailyFloor) {
        parked = true;
        console.warn("[ghl-create-opportunities] PARKING — daily cap near-exhausted",
          JSON.stringify({ daily_remaining: dailyRemaining, daily_floor: dailyFloor }));
        break;
      }
    }

    if (parked) break;
    // A short final page means the eligible set is drained.
    if (contacts.length < PAGE_LIMIT) { done = true; break; }
  }

  const nextCursorStr = done ? null : (lastCursor ? JSON.stringify(lastCursor) : null);

  // Persist the resume state (cursor + running total) BEFORE the reinvoke so a fresh
  // trigger continues instead of restarting — the cheap, correct substitute for opp
  // enumeration, and the sole dup-guard when write_marker:false.
  if (usePersistedCursor) {
    await saveState(db, fingerprint, {
      cursor: nextCursorStr, created_total: priorCreated + created, done,
      last_status: parked ? "parked_daily_cap" : done ? "done" : "chunk_ok",
      chunk_index: chunkIndex, daily_remaining: dailyRemaining,
    });
  }

  // ── AUTO-CONTINUE: chain the next chunk headlessly until done ────────────────
  // Fire-and-forget self-reinvoke via the trusted secret so ONE trigger finishes
  // the whole list. A brief inter-chunk delay keeps the pacing gentle across the
  // hand-off; the persisted cursor makes it idempotent and safe to re-trigger.
  // NOT when parked (daily cap) — we stop and wait for the reset.
  let reinvoked = false;
  let chunk_cap_hit = false;
  if (autoContinue && !done && !parked && nextCursorStr) {
    if (chunkIndex + 1 >= maxChunks) {
      chunk_cap_hit = true;
      console.error("[ghl-create-opportunities] auto_continue STOPPED — max_chunks reached",
        JSON.stringify({ chunk_index: chunkIndex, max_chunks: maxChunks, next_cursor: nextCursorStr }));
    } else if (selfSecret) {
      // Delay the hand-off by the standing cooldown (min ~1s) so a hot GHL cools.
      reinvoke(selfSecret, resumeBody(lastCursor), Math.max(cooldownMs, 1_000));
      reinvoked = true;
    } else {
      console.error("[ghl-create-opportunities] auto_continue requested but NO webhook secret — cannot self-continue");
    }
  }

  return json({
    ok: true,
    mode: "create",
    tags,
    exclude_states: excludeStates,
    marker_tag: markerTag,
    pipeline_id: pipelineId,
    stage_id: stageId,
    value,
    source: source ?? null,
    assign_user_id: assignUserId ?? null,
    round_robin_user_ids: roundRobin,
    extra_tags: extraTags,
    created,
    skipped_state,
    skipped_existing,
    skipped_robot,
    marker_failed,
    errors,
    error_sample: errorSample,
    processed,
    next_cursor: nextCursorStr,
    done,
    // Auto-continue / throttle / persistence observability.
    auto_continue: autoContinue,
    reinvoked,
    parked,
    chunk_index: chunkIndex,
    chunk_cap_hit,
    rr_offset_next: rrIndex,
    cooldown_ms: cooldownMs,
    daily_remaining: dailyRemaining,
    write_marker: writeMarker,
    calls_per_create: callsPerCreate,
    resumed_from_state: resumedFromState,
    created_total: priorCreated + created,
    fingerprint,
    trusted,
    elapsed_ms: Date.now() - started,
  });
});
