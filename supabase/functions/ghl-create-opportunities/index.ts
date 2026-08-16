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
// mode:"backfill_state" — RETRO-STAMP existing opps in a pipeline with Lead State
//                 (FULL state name) + Lead Type. Walks GET /opportunities/search,
//                 expands the opp's own Lead State cf for free where present, else
//                 reads the linked contact for its state (ONE extra call — the search
//                 does not embed contact.state). Idempotent (skips already-correct
//                 opps), throttled, daily-cap parked, self-reinvoking. OWN cursor key
//                 `ghl_opp_state_backfill` (never collides with `ghl_opp_backfill`).
//                 dry_run:true reports the plan + contact-read rate with NO writes.
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
const CONCURRENCY = 3;          // backfill_state wave size (each = up to 2 GHL calls) — kept LOW on purpose
// CREATE-mode wave size is now per-request tunable (payload.concurrency), clamped to
// [1..MAX_CONCURRENCY]. Default is 8: with write_marker:false each create is ~1 GHL
// call, so ~8 in flight/wave stays under GHL's 100-req/10s (10/s) burst ceiling, and
// the adaptive 429 cooldown auto-backs-off if GHL ever pushes back. Raised from the
// old hardcoded 3 (which capped the Aged finish at ~1.7 creates/s).
const DEFAULT_CONCURRENCY = 8;  // create-mode parallel creates per wave (up from 3)
const MAX_CONCURRENCY = 10;     // hard clamp — never exceed GHL's 10/s burst headroom
const BUDGET_MS = 50_000;       // wall-clock window; the rest comes back as next_cursor / a self-reinvoke
const MAX_ERRORS_REPORTED = 50; // cap the per-error sample so the response stays small

// ── THROTTLE ──────────────────────────────────────────────────────────────────
// GHL rate-limits bulk work (LeadConnector v2 ~100 req / 10s per resource). An
// UNthrottled browser-driven run created ~53.8K opps overnight, generated ~107.6K
// webhook events, and is now getting HTTP 429. So creation here is PACED:
//   • CREATE waves are `concurrency` wide (per-request, default 8, clamped ≤10) with
//     a per-wave FLOOR so the steady rate stays at ~TARGET_RPS — well under GHL's
//     10/s burst ceiling. (backfill_state waves stay at CONCURRENCY=3.)
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

/** Generic persisted-state loader for an arbitrary platform_settings key, scoped by
 * fingerprint. Returns the raw value object (or null if absent / different run). Free
 * (Supabase). Used by the state/type backfill, which keeps its OWN key so it never
 * collides with the create finisher's `ghl_opp_backfill`. */
async function loadRawState(
  db: SupabaseClient, key: string, fp: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("platform_settings").select("value").eq("key", key).maybeSingle();
  const v = (data?.value ?? null) as Record<string, unknown> | null;
  if (!v || v.fingerprint !== fp) return null;
  return v;
}

/** Persist arbitrary resume state under `key`, stamping fingerprint + updated_at.
 * Best-effort but LOUD on failure. */
async function saveRawState(db: SupabaseClient, key: string, fp: string, patch: Record<string, unknown>) {
  const nowIso = new Date().toISOString();
  const value = { fingerprint: fp, updated_at: nowIso, ...patch };
  const { error } = await db.from("platform_settings")
    .upsert({ key, value, updated_at: nowIso }, { onConflict: "key" });
  if (error) console.error(`[ghl-create-opportunities] saveRawState(${key}) failed:`, error.message);
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

// ── US state map (USPS 2-letter abbreviations → full name; 50 states + DC) ──────
// Source: the canonical USPS state/territory abbreviation list (the same 2-letter
// codes GHL stores on a contact's `state`). We keep the 50 states + District of
// Columbia — the jurisdictions we operate in.
//
// WHY FULL NAMES. Verified LIVE against GHL: a text-type OPPORTUNITY custom-field
// filter enforces a 3-character MINIMUM on the filter VALUE regardless of operator
// (even "Is"), so a 2-letter state code (FL, MO) can NEVER be entered as a filter
// value — but a ≥3-char value ("Florida") is accepted. So Lead State is stored as
// the FULL state name to make the field actually filterable in the Opportunities view.
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

// Reverse lookup so an ALREADY-full name (however cased) maps back to the canonical
// spelling — lets the backfill treat a pre-stamped full name as already-correct.
const US_STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.values(US_STATES).map((n) => [n.toLowerCase(), n]),
);

/** Map a contact's raw state to the FULL US state name for the Lead State opp field.
 * Accepts a 2-letter code (FL→Florida) OR an already-full name (any casing →
 * canonical). Blank/unknown → "" so the caller SKIPS stamping (never a bad value). */
function fullStateName(raw: unknown): string {
  const s = clean(raw);
  if (!s) return "";
  const up = s.toUpperCase();
  if (US_STATES[up]) return US_STATES[up];            // 2-letter code
  return US_STATE_BY_NAME[s.toLowerCase()] ?? "";     // already a full name, else unknown
}

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
  // Lead State — the contact's state mapped to its FULL name (FL→Florida). A 2-letter
  // code is UNFILTERABLE in GHL's opportunity CF filter (≥3-char minimum on the value,
  // verified live); the full name is filterable. Blank/unknown state → skipped entirely
  // (fullStateName returns "" → add() no-ops), never stamping a junk value.
  add(oppMap.lead_state, fullStateName(c.state));
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

// ── Opportunity-side helpers (used only by mode:"backfill_state") ──────────────
// One opportunity as GHL returns it on GET /opportunities/search. The embedded
// `contact` carries tags (used to derive Lead Type) but NOT state (verified live) —
// so the linked contact's STATE requires a separate GET /contacts/{id} whenever the
// opp doesn't already carry a Lead State cf we can expand for free.
interface OppRec {
  id: string;
  contactId?: string | null;
  source?: string | null;
  contact?: { tags?: string[]; state?: string | null } | null;
  // GHL returns opp custom fields here as { id, type, fieldValueString } (verified live).
  customFields?: Array<{ id?: string; fieldValueString?: unknown; type?: string }>;
}

interface OppSearchMeta { startAfter?: unknown; startAfterId?: string | null; total?: number }

/** One page of GET /opportunities/search for a pipeline, forward-paged by the
 * meta cursor (startAfter + startAfterId, verified live). onRL feeds the caller's
 * adaptive 429 cooldown. */
async function oppSearchPage(
  cfg: GhlConfig, pipelineId: string, pageLimit: number,
  startAfter: unknown, startAfterId: string | undefined,
  onRL?: (retryAfterMs: number | null) => void,
) {
  const qs = new URLSearchParams({
    location_id: cfg.locationId, pipeline_id: pipelineId, limit: String(pageLimit),
  });
  if (startAfterId) qs.set("startAfterId", startAfterId);
  if (startAfter !== undefined && startAfter !== null && `${startAfter}`.length) {
    qs.set("startAfter", String(startAfter));
  }
  return await ghlFetch<{ opportunities: OppRec[]; meta: OppSearchMeta }>(
    cfg, "GET", `/opportunities/search?${qs.toString()}`, undefined, onRL,
  );
}

/** Flatten an opp's custom fields into { cfId → string value } (reads fieldValueString). */
function oppCfValues(o: OppRec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of (Array.isArray(o.customFields) ? o.customFields : [])) {
    const id = clean(f?.id);
    if (id) out[id] = clean(f?.fieldValueString);
  }
  return out;
}

/** Derive a Lead Type label from a contact's list tags (fallback when the opp has no
 * Source). lm-ucc → UCC, lm-aged → Aged; anything else → "" (leave unset). */
function leadTypeFromTags(tags: unknown): string {
  const t = (Array.isArray(tags) ? tags : []).map((x) => clean(x).toLowerCase());
  if (t.includes("lm-ucc")) return "UCC";
  if (t.includes("lm-aged")) return "Aged";
  return "";
}

/** EMERGENCY BRAKE — 2026-08-16 18:4xZ.
 *
 * This function was creating MCA-pipeline opportunities at New Lead for `lm-aged`
 * contacts (fingerprint lm-aged::mca-opp-created::bG9ZEh4eP9x60E1CyaMx), and a
 * GHL stage workflow on New Lead was sending a welcome EMAIL for each one —
 * 8,663 OpportunityCreate events in six hours, still firing seconds before this
 * was deployed. Purchased-list merchants were being emailed continuously.
 *
 * The auto_continue chain has no external stop: it halts only on done / parked /
 * max_chunks, and the cursor rides the reinvoke BODY, so editing the persisted
 * state cannot stop an in-flight chain. An out-of-band brake is the only thing
 * that can — the same reason lead-push-ghl has PUSH_KILL_SWITCH: the brake must
 * live outside the thing it stops.
 *
 * Set false again ONLY once the New-Lead workflow is confirmed disarmed. */
const OPP_KILL_SWITCH = false;

Deno.serve(async (req) => {
  if (OPP_KILL_SWITCH) {
    return new Response(JSON.stringify({
      ok: false, killed: true,
      error: "ghl-create-opportunities is disabled by OPP_KILL_SWITCH (emergency brake): "
        + "creating New Lead opportunities was triggering a GHL workflow that emailed "
        + "purchased-list contacts. No GHL work was performed.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

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
  const mode = clean((payload as { mode?: unknown }).mode);
  if (mode !== "count" && mode !== "create" && mode !== "backfill_state") {
    return json({ error: 'mode must be "count", "create" or "backfill_state"' }, 400);
  }

  const tagsRaw = (payload as { tags?: unknown }).tags;
  const tags = Array.isArray(tagsRaw)
    ? Array.from(new Set(tagsRaw.map((t) => clean(t)).filter((t) => t.length > 0)))
    : [];
  // Tags select the working set for count/create. backfill_state walks an entire
  // pipeline's opportunities, so it needs no tags.
  if ((mode === "count" || mode === "create") && tags.length === 0) {
    return json({ error: "tags[] is required (at least one tag)" }, 400);
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

  // Per-request CREATE-mode wave size. Clamp to [1..MAX_CONCURRENCY]; anything
  // absent / non-finite / < 1 falls back to DEFAULT_CONCURRENCY (8). Never above 10,
  // so a caller can't push past GHL's burst headroom; the 429 cooldown still governs
  // the effective rate on top of this. Propagated across self-reinvokes (resumeBody).
  const rawConcurrency = Number((payload as { concurrency?: unknown }).concurrency);
  const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency >= 1
    ? Math.min(Math.floor(rawConcurrency), MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;

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

  // ── BACKFILL_STATE: retro-stamp Lead State (full name) + Lead Type on existing opps
  // Walks the pipeline's opportunities and, per opp, sets:
  //   • Lead State — the FULL US state name. Cheapest source first: if the opp already
  //     carries a Lead State cf we can normalize/expand FOR FREE (a 2-letter "FL" →
  //     "Florida", an already-full name → canonical). Only when there's no usable value
  //     do we spend ONE extra GET /contacts/{id} to read the linked contact's state
  //     (the opp search does NOT embed contact.state — verified live). Many such
  //     contacts have no state either, in which case nothing is stamped.
  //   • Lead Type — the opp's Source if set, else derived from the contact's list tags
  //     (lm-ucc → UCC, lm-aged → Aged). Both are FREE (embedded in the opp search).
  //
  // IDEMPOTENT: an opp already carrying the correct full-name Lead State AND the right
  // Lead Type is skipped with no write (and no contact read) — re-runs are cheap/safe.
  // Safety machinery mirrors the create finisher: persisted forward cursor (its OWN
  // key `ghl_opp_state_backfill`), ~TARGET_RPS throttle with 429 cooldown, daily-cap
  // parking, and self-reinvoke to completion. dry_run:true reports the plan + the real
  // contact-read rate WITHOUT any writes or state persistence.
  if (mode === "backfill_state") {
    const oppMap = await loadOppFieldMap(db);
    const leadStateId = oppMap.lead_state;
    const leadTypeId = oppMap.lead_type;
    if (!leadStateId && !leadTypeId) {
      return json({ error: "ghl_opp_custom_field_map has neither lead_state nor lead_type configured — nothing to backfill" }, 400);
    }
    const dryRun = (payload as { dry_run?: unknown }).dry_run === true;
    // Opp-search page size (clamped 1..100). Default 100 for the real run; a small
    // value makes a dry_run probe return quickly (and pairs with a small `limit` to
    // stop after one page).
    const rawPageSize = Number((payload as { page_size?: unknown }).page_size);
    const OPP_PAGE = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(Math.floor(rawPageSize), 100) : 100;
    const bfKey = "ghl_opp_state_backfill";
    const bfFp = `${pipelineId}::${leadStateId ?? ""}::${leadTypeId ?? ""}`;

    // Opp-search cursor {startAfter, startAfterId}: from payload (in-chain reinvoke)
    // or from persisted state (bare resume). restart:true / dry_run start from the top.
    const readOc = (v: unknown): { sa: unknown; said: string } | null => {
      if (!v || typeof v !== "object") return null;
      const o = v as Record<string, unknown>;
      const said = clean(o.startAfterId);
      return said ? { sa: (o as { startAfter?: unknown }).startAfter ?? null, said } : null;
    };
    let oc = readOc((payload as { opp_cursor?: unknown }).opp_cursor);
    let resumedBf = false;
    let priorUpdated = 0;
    let priorScanned = 0;
    if (!oc && !dryRun) {
      const st = await loadRawState(db, bfKey, bfFp);
      if (restart) {
        // explicit fresh start — begin from the top
      } else if (st?.done) {
        return json({
          ok: true, mode: "backfill_state", done: true, already_complete: true,
          resumed_from_state: true, updated: 0, next_opp_cursor: null, fingerprint: bfFp,
          note: "This state-backfill fingerprint is already marked done. Pass restart:true to run it again.",
        });
      } else if (st?.cursor && typeof st.cursor === "object") {
        oc = readOc(st.cursor);
        if (oc) { resumedBf = true; priorUpdated = Number(st.updated_total ?? 0); priorScanned = Number(st.scanned_total ?? 0); }
      }
      // No cursor + no saved state → start from the top. SAFE here (unlike the
      // marker-less create path): the skip-if-correct check makes a top scan idempotent.
    }
    let curSA: unknown = oc?.sa;
    let curSAID: string | undefined = oc?.said;

    // ── throttle / parking state (mirrors create) ──
    let dailyRemaining: number | null = null;
    const noteRate = (r?: { dailyRemaining: number | null } | undefined) => {
      if (r && typeof r.dailyRemaining === "number") {
        dailyRemaining = dailyRemaining == null ? r.dailyRemaining : Math.min(dailyRemaining, r.dailyRemaining);
      }
    };
    let cooldownMs = 0, saw429 = false;
    const onRL = (raMs: number | null) => {
      saw429 = true;
      cooldownMs = Math.min(COOLDOWN_MAX_MS, Math.max(cooldownMs > 0 ? cooldownMs * 2 : COOLDOWN_BASE_MS, raMs ?? 0));
    };

    let scanned = 0, updated = 0, skipped = 0, contactReads = 0, errors = 0, stateEmpty = 0;
    let done = false, parked = false;
    const errorSample: Array<{ opp_id: string; error: string }> = [];
    const planSample: Array<{ opp_id: string; lead_state?: string; lead_type?: string; from_contact: boolean }> = [];

    // Per-opp work: decide what (if anything) to write, then write it (unless dry_run).
    const processOpp = async (o: OppRec): Promise<{ status: "updated" | "skipped" | "error"; contactRead: boolean; stateEmpty: boolean }> => {
      const cf = oppCfValues(o);
      const curState = leadStateId ? cf[leadStateId] : undefined;
      const curType = leadTypeId ? cf[leadTypeId] : undefined;

      // Desired Lead Type — Source first (free), then tags (free). "" = leave unset.
      const desiredType = leadTypeId ? (clean(o.source) || leadTypeFromTags(o.contact?.tags)) : "";

      // Desired Lead State — free-expand the opp's own value first; only read the
      // contact when the opp carries nothing usable.
      let desiredState = leadStateId ? fullStateName(curState) : "";
      let contactRead = false, emptyState = false;
      if (leadStateId && !desiredState) {
        contactRead = true;
        const gc = await ghlFetch<{ contact?: { state?: unknown } }>(cfg, "GET", `/contacts/${clean(o.contactId)}`, undefined, onRL);
        noteRate(gc.rate);
        if (gc.ok) {
          desiredState = fullStateName(gc.data?.contact?.state);
          if (!desiredState) emptyState = true;
        } else {
          return { status: "error", contactRead, stateEmpty: false };
        }
      }

      // Only emit fields that actually change.
      const patch: Array<{ id: string; field_value: string }> = [];
      if (leadStateId && desiredState && desiredState !== curState) patch.push({ id: leadStateId, field_value: desiredState });
      if (leadTypeId && desiredType && desiredType !== curType) patch.push({ id: leadTypeId, field_value: desiredType });
      if (patch.length === 0) return { status: "skipped", contactRead, stateEmpty: emptyState };

      if (planSample.length < 20) {
        planSample.push({
          opp_id: o.id,
          ...(leadStateId && desiredState ? { lead_state: desiredState } : {}),
          ...(leadTypeId && desiredType ? { lead_type: desiredType } : {}),
          from_contact: contactRead,
        });
      }
      if (dryRun) return { status: "updated", contactRead, stateEmpty: emptyState };

      const up = await ghlFetch<{ opportunity?: { id: string } }>(cfg, "PUT", `/opportunities/${o.id}`, { customFields: patch }, onRL);
      noteRate(up.rate);
      if (!up.ok) {
        if (errorSample.length < MAX_ERRORS_REPORTED) errorSample.push({ opp_id: o.id, error: ghlErrorMessage(up.error).slice(0, 300) });
        return { status: "error", contactRead, stateEmpty: emptyState };
      }
      return { status: "updated", contactRead, stateEmpty: emptyState };
    };

    while (Date.now() - started < BUDGET_MS) {
      const page = await oppSearchPage(cfg, pipelineId, OPP_PAGE, curSA, curSAID, onRL);
      noteRate(page.rate);
      if (!page.ok) {
        // Persist the CURRENT (page-start) cursor so a resume redoes this page.
        if (!dryRun) {
          await saveRawState(db, bfKey, bfFp, {
            cursor: curSAID ? { startAfter: curSA ?? null, startAfterId: curSAID } : null,
            updated_total: priorUpdated + updated, scanned_total: priorScanned + scanned,
            done: false, last_status: `search ${page.status}`, chunk_index: chunkIndex,
          });
        }
        const is429 = page.status === 429;
        const willReinvoke = autoContinue && !!selfSecret && (is429 || page.status >= 500 || page.status === 0);
        if (willReinvoke) {
          reinvoke(selfSecret, {
            mode: "backfill_state", pipeline_id: pipelineId, limit, auto_continue: true,
            chunk_index: chunkIndex + 1, max_chunks: maxChunks, daily_floor: dailyFloor,
            ...(dryRun ? { dry_run: true } : {}),
            opp_cursor: curSAID ? { startAfter: curSA ?? null, startAfterId: curSAID } : null,
          }, REINVOKE_ON_FAIL_MS);
        }
        return json({
          ok: false, mode: "backfill_state", error: `opportunities/search failed: ${ghlErrorMessage(page.error)}`,
          status: page.status, scanned, updated, skipped, errors, contact_reads: contactReads,
          next_opp_cursor: curSAID ? { startAfter: curSA ?? null, startAfterId: curSAID } : null,
          done: false, auto_continue: autoContinue, reinvoked: willReinvoke,
          daily_remaining: dailyRemaining, fingerprint: bfFp, elapsed_ms: Date.now() - started,
        }, 502);
      }
      const opps = page.data?.opportunities ?? [];
      if (opps.length === 0) { done = true; break; }
      const nextSA = page.data?.meta?.startAfter;
      const nextSAID = clean(page.data?.meta?.startAfterId) || undefined;

      // Process the WHOLE page (never break mid-page — the cursor advances a full page
      // at a time, so a mid-page stop would skip the remainder). Small concurrent waves,
      // paced to ~TARGET_RPS with the same 429 cooldown as create.
      for (let i = 0; i < opps.length; i += CONCURRENCY) {
        if (parked) break;
        const waveStart = Date.now();
        saw429 = false;
        const wave = opps.slice(i, i + CONCURRENCY);
        const results = await Promise.all(wave.map((o) => processOpp(o)));
        // Pace: hold the wave; a wave is up to CONCURRENCY×2 calls (contact read + PUT).
        const waveFloorMs = Math.ceil((CONCURRENCY * 2) / TARGET_RPS * 1000);
        if (!saw429 && cooldownMs > 0) { cooldownMs = Math.floor(cooldownMs * COOLDOWN_DECAY); if (cooldownMs < 250) cooldownMs = 0; }
        const pause = Math.max(waveFloorMs - (Date.now() - waveStart), 0) + cooldownMs;
        if (pause > 0) await sleep(pause);
        for (const r of results) {
          scanned++;
          if (r.contactRead) contactReads++;
          if (r.stateEmpty) stateEmpty++;
          if (r.status === "updated") updated++;
          else if (r.status === "skipped") skipped++;
          else errors++;
        }
        if (dailyRemaining != null && dailyRemaining <= dailyFloor) {
          parked = true;
          console.warn("[ghl-create-opportunities] backfill_state PARKING — daily cap near-exhausted",
            JSON.stringify({ daily_remaining: dailyRemaining, daily_floor: dailyFloor }));
          break;
        }
      }

      if (parked) break;                       // leave curSA at page-start → resume redoes page (cheap, idempotent)
      curSA = nextSA; curSAID = nextSAID;       // page fully processed — advance
      if (opps.length < OPP_PAGE || !curSAID) { done = true; break; }
      if (updated >= limit) break;              // soft cap, enforced only at a page boundary
    }

    const moreLeft = !done && !parked && !!curSAID;
    if (!dryRun) {
      await saveRawState(db, bfKey, bfFp, {
        cursor: curSAID ? { startAfter: curSA ?? null, startAfterId: curSAID } : null,
        updated_total: priorUpdated + updated, scanned_total: priorScanned + scanned,
        done, last_status: parked ? "parked_daily_cap" : done ? "done" : "chunk_ok",
        chunk_index: chunkIndex, daily_remaining: dailyRemaining,
      });
    }

    // Auto-continue to completion (never when parked or dry_run).
    let reinvoked = false, chunk_cap_hit = false;
    if (autoContinue && !dryRun && moreLeft) {
      if (chunkIndex + 1 >= maxChunks) {
        chunk_cap_hit = true;
        console.error("[ghl-create-opportunities] backfill_state auto_continue STOPPED — max_chunks reached",
          JSON.stringify({ chunk_index: chunkIndex, max_chunks: maxChunks }));
      } else if (selfSecret) {
        reinvoke(selfSecret, {
          mode: "backfill_state", pipeline_id: pipelineId, limit, auto_continue: true,
          chunk_index: chunkIndex + 1, max_chunks: maxChunks, daily_floor: dailyFloor,
          opp_cursor: { startAfter: curSA ?? null, startAfterId: curSAID },
        }, Math.max(cooldownMs, 1_000));
        reinvoked = true;
      } else {
        console.error("[ghl-create-opportunities] backfill_state auto_continue requested but NO webhook secret");
      }
    }

    return json({
      ok: true, mode: "backfill_state", dry_run: dryRun,
      pipeline_id: pipelineId, lead_state_field: leadStateId ?? null, lead_type_field: leadTypeId ?? null,
      scanned, updated, skipped, errors,
      contact_reads: contactReads, state_empty_after_read: stateEmpty,
      error_sample: errorSample, plan_sample: dryRun ? planSample : undefined,
      next_opp_cursor: moreLeft ? { startAfter: curSA ?? null, startAfterId: curSAID } : null,
      done, parked, auto_continue: autoContinue, reinvoked, chunk_index: chunkIndex, chunk_cap_hit,
      cooldown_ms: cooldownMs, daily_remaining: dailyRemaining,
      resumed_from_state: resumedBf, updated_total: priorUpdated + updated, scanned_total: priorScanned + scanned,
      fingerprint: bfFp, trusted, elapsed_ms: Date.now() - started,
    });
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

  // Dynamic wave floor: hold each wave of `concurrency` creates long enough that the
  // sustained request rate stays at ~TARGET_RPS. (8 creates × 1 call ≈ 1.14s;
  // 8 creates × 2 calls ≈ 2.3s.) So even at the higher wave size the pacing floor
  // keeps sustained throughput at ~TARGET_RPS while allowing an ~8-wide burst.
  const waveFloorMs = Math.ceil((concurrency * callsPerCreate) / TARGET_RPS * 1000);

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
    limit, concurrency, auto_continue: true, chunk_index: chunkIndex + 1, max_chunks: maxChunks,
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
    for (let i = 0; i < toCreate.length; i += concurrency) {
      if (created >= limit || Date.now() - started > BUDGET_MS) break;
      const waveStart = Date.now();
      saw429 = false;
      const wave = toCreate.slice(i, i + concurrency);
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
    concurrency,
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
