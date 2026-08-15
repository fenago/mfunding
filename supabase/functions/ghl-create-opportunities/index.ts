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
// ── IDEMPOTENCY (this WILL be re-run) — a MARKER TAG ──────────────────────────
// On a successful create we attach `mca-opp-created` (configurable via marker_tag)
// to the contact, and EVERY search excludes contacts that already carry it
// (server-side `not_contains`). So a contact can only ever get one opportunity from
// this path: once marked it drops out of the working set for good. This is cheaper
// than an /opportunities/search-by-contact lookup per contact (one fewer GHL call
// each across 145K contacts) and it doubles as an at-a-glance audit tag in GHL.
// Belt-and-braces: each returned contact's own `tags` are re-checked before create,
// so even a contact the index hasn't caught up on is skipped if it already shows the
// marker. CAVEAT: GHL's search index is eventually consistent — a *fresh* re-run
// started within a few seconds of a prior run (before the marker is indexed) could
// in principle re-create for a contact. The caller-driven cursor (next_cursor) never
// re-examines within a run, so this only matters for back-to-back cold restarts.
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
// AUTH: verify_jwt at the gateway PLUS an in-code role check — admin / super_admin
// ONLY (NOT closers). A service-role bearer deliberately fails the role check.

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

const DEFAULT_LIMIT = 200;      // creates per create-call before returning
const MAX_LIMIT = 1000;
const PAGE_LIMIT = 100;         // GHL /contacts/search page size
const CONCURRENCY = 6;          // parallel creates per wave (each = 2 GHL calls)
const BUDGET_MS = 55_000;       // wall-clock window; the rest comes back as next_cursor
const MAX_ERRORS_REPORTED = 50; // cap the per-error sample so the response stays small

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  searchAfter?: unknown[];
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

  // ── Auth: signed-in staff, admin/super_admin ONLY (closers excluded) ──────────
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

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

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
  const filters = buildFilters(tags, markerTag, excludeStates, true);
  let created = 0, skipped_state = 0, skipped_existing = 0, skipped_robot = 0;
  let errors = 0, processed = 0, marker_failed = 0;
  let done = false;
  let lastCursor: unknown[] | undefined = cursor;
  const errorSample: Array<{ contact_id: string; error: string }> = [];

  while (created < limit && Date.now() - started < BUDGET_MS) {
    const page = await searchPage(cfg, filters, PAGE_LIMIT, lastCursor);
    if (!page.ok) {
      // A search failure mid-run is terminal for this call; report what we did and
      // hand back the cursor so the caller can resume from here.
      return json({
        ok: false, mode: "create", error: `contacts/search failed: ${ghlErrorMessage(page.error)}`,
        created, skipped_state, skipped_existing, skipped_robot, marker_failed, errors, processed,
        next_cursor: lastCursor ? JSON.stringify(lastCursor) : null, done: false,
        elapsed_ms: Date.now() - started,
      }, 502);
    }
    const contacts = page.data?.contacts ?? [];
    if (contacts.length === 0) { done = true; break; }
    // Advance the cursor to the last contact of the page BEFORE creating, so a
    // resume never re-examines this page (idempotency's marker handles overlap).
    lastCursor = contacts[contacts.length - 1].searchAfter ?? lastCursor;

    // Partition this page (defensive re-checks — the server-side filter already
    // excludes these, but a contact whose tag change hasn't indexed yet can slip in).
    const toCreate: GhlSearchContact[] = [];
    for (const c of contacts) {
      processed++;
      const ctags = Array.isArray(c.tags) ? c.tags : [];
      if (ctags.includes(markerTag)) { skipped_existing++; continue; }
      if (ctags.includes(ROBOT_TAG)) { skipped_robot++; continue; }
      const st = normState(c.state);
      if (st && excludeStates.includes(st)) { skipped_state++; continue; }
      toCreate.push(c);
    }

    // Create in small concurrent waves (each contact = createOpportunity + tag add).
    for (let i = 0; i < toCreate.length; i += CONCURRENCY) {
      if (Date.now() - started > BUDGET_MS) break;
      const wave = toCreate.slice(i, i + CONCURRENCY);
      const results = await Promise.all(wave.map(async (c) => {
        try {
          const opp = await createOpportunity(cfg, {
            pipelineId, pipelineStageId: stageId, contactId: c.id,
            name: opportunityName(c), monetaryValue: value, status: "open",
            ...(source ? { source } : {}),
          });
          if (!opp.ok) return { c, ok: false as const, error: ghlErrorMessage(opp.error) };
          // Mark the contact so it can never receive a second opportunity from here.
          const tag = await addContactTags(cfg, c.id, [markerTag]);
          return { c, ok: true as const, markerOk: tag.ok, markerErr: tag.ok ? "" : ghlErrorMessage(tag.error) };
        } catch (e) {
          return { c, ok: false as const, error: (e instanceof Error ? e.message : String(e)) };
        }
      }));
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
    }

    // A short final page means the eligible set is drained.
    if (contacts.length < PAGE_LIMIT) { done = true; break; }
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
    created,
    skipped_state,
    skipped_existing,
    skipped_robot,
    marker_failed,
    errors,
    error_sample: errorSample,
    processed,
    next_cursor: done ? null : (lastCursor ? JSON.stringify(lastCursor) : null),
    done,
    elapsed_ms: Date.now() - started,
  });
});
