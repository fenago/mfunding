// ghl-contacts-search — GoHighLevel contacts as a Data Hygiene smart-list source.
//
// The owner's PRIMARY use case: search the GHL book (162k+ contacts) by TAG (and
// free-text), preview the count, then MATERIALIZE the matches into a smart_list so
// they can be enriched / phone-validated like any other source. GHL is the CRM
// system of record; this joins ph_ucc / lead_records / customers as source='ghl'.
//
// Auth: caller's Supabase JWT is verified and profiles.role must be one of
// closer | admin | super_admin — the SAME gate ghl-comms / the rest of the staff
// edge fns use. A service_role bearer would FAIL the role check (no profile row).
//
// Credentials come from the vault via getGhlConfig() — never the client.
//
// ── GHL CALL BUDGET (the 200k/day per-location cap — ghl-api-daily-cap memory) ──
// contacts/search is paged at 200/page (GHL's max). A PREVIEW is exactly ONE call.
// A MATERIALIZE is capped (default 5,000 contacts ≈ 25 pages) and, after every
// page, branches on x-ratelimit-daily-remaining: if the daily budget is running
// out it PARKS (returns parked:true) rather than burning the cap — the caller
// narrows the tag and re-runs. Burst 429s are retried transparently by ghlFetch.
//
// POST { action, ... }:
//   tags        {}                                   → { tags: [{id,name}] }               (1 call)
//   preview     { filters }                          → { total }                            (1 call)
//   search      { filters, pageLimit?, cursor? }     → { contacts, total, nextCursor }      (1 call)
//   materialize { smart_list_id, filters, max? }     → { inserted, scanned, total, capped,
//                                                        parked, member_count }             (paged)
//
// filters := { tags?, tagMode?, query?, state?, city?, postalCode?, areaCodes? }
//   • tags     — GHL tag NAMES (as they appear in each contact's tags[]); verified
//                filter shape is { field:"tags", operator:"eq", value:<name> }.
//   • tagMode  — 'and' (default): every tag must be present (one top-level filter
//                per tag). 'or': any tag matches (a single {group:"OR", filters:[…]}).
//   • query    — free text over name / email / phone; ANDed with the tag filters.
//   • state    — standard field, { field:"state", operator:"eq", value } (ANDed).
//   • city     — standard field, { field:"city", operator:"contains", value }.
//   • postalCode — standard field, { field:"postalCode", operator:"eq", value }.
//   • areaCodes — 3-digit phone prefixes. The GHL API can't filter by area code,
//                so this is a CLIENT-SIDE narrowing applied to each fetched page
//                (search/materialize) AFTER the API filters. In PREVIEW it drives a
//                small bounded scan and the returned count is flagged approximate.
//   (pipeline/stage is NOT a contacts/search filter — omitted deliberately; that
//    lives on opportunities/search, a different endpoint.)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, ghlErrorMessage,
  type GhlConfig, type GhlResponse,
} from "../_shared/ghl.ts";

const ALLOWED_ROLES = ["closer", "admin", "super_admin"];

// contacts/search paging + materialize safety rails.
const PAGE_MAX = 200;                 // GHL's max page size for /contacts/search
const DEFAULT_SEARCH_PAGE = 50;       // a UI "search" page
const MATERIALIZE_DEFAULT_MAX = 5000; // cap one materialize run (~25 pages)
const MATERIALIZE_HARD_MAX = 20000;   // absolute ceiling even if caller asks for more
const DAILY_FLOOR = 1000;             // park a materialize if daily budget dips below this
const AREACODE_PREVIEW_PAGES = 10;    // bounded scan for an area-code PREVIEW (≤2,000 contacts)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── filter builder ──────────────────────────────────────────────────────────────
interface HygieneFilters {
  tags?: string[];
  tagMode?: "and" | "or";
  query?: string;
  state?: string;
  states?: string[];
  city?: string;
  postalCode?: string;
  areaCodes?: string[];
}

/** 3-digit area code of a phone (handles a leading US country code). "" if none. */
function areaCodeOf(phone: unknown): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1, 4);
  if (d.length >= 10) return d.slice(0, 3);
  return "";
}

/** Normalize the area-code filter to unique 3-digit codes. */
function areaCodeSet(filters: HygieneFilters): Set<string> {
  const out = new Set<string>();
  for (const a of filters.areaCodes ?? []) {
    const c = String(a).replace(/\D/g, "");
    if (c.length === 3) out.add(c);
  }
  return out;
}

/** Build the verified GHL /contacts/search body from our hygiene filter shape.
 *  Verified live 2026-08-30 against location t7NmVR4WCy927j4Zon4b:
 *    - single tag : filters:[{field:"tags",operator:"eq",value:"dialed"}]      → matches
 *    - AND tags   : filters:[{...tagA},{...tagB}]                              → both required
 *    - OR tags    : filters:[{group:"OR",filters:[{...tagA},{...tagB}]}]       → either
 *    - query      : body.query="…"  (name/email/phone), ANDed with filters
 *    - paging     : body.searchAfter = last contact's `searchAfter` array
 */
function buildSearchBody(
  cfg: GhlConfig,
  filters: HygieneFilters,
  pageLimit: number,
  cursor?: unknown[],
): Record<string, unknown> {
  const body: Record<string, unknown> = { locationId: cfg.locationId, pageLimit };
  const tags = (filters.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  const tagFilters = tags.map((t) => ({ field: "tags", operator: "eq", value: t }));

  const ghlFilters: unknown[] = [];
  if (tagFilters.length > 0) {
    if ((filters.tagMode ?? "and") === "or" && tagFilters.length > 1) {
      ghlFilters.push({ group: "OR", filters: tagFilters });
    } else {
      ghlFilters.push(...tagFilters);
    }
  }

  // Standard-field filters (ANDed with the tag filters). area code is NOT here —
  // it's a client-side narrowing since the API can't filter on it.
  // States: multi → OR group; single legacy `state` still honored.
  const states = (filters.states ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (states.length > 1) {
    ghlFilters.push({ group: "OR", filters: states.map((s) => ({ field: "state", operator: "eq", value: s })) });
  } else if (states.length === 1) {
    ghlFilters.push({ field: "state", operator: "eq", value: states[0] });
  }
  const st = String(filters.state ?? "").trim();
  if (st && states.length === 0) ghlFilters.push({ field: "state", operator: "eq", value: st });
  const ct = String(filters.city ?? "").trim();
  if (ct) ghlFilters.push({ field: "city", operator: "contains", value: ct });
  const pc = String(filters.postalCode ?? "").trim();
  if (pc) ghlFilters.push({ field: "postalCode", operator: "eq", value: pc });

  if (ghlFilters.length > 0) body.filters = ghlFilters;

  const q = filters.query ? String(filters.query).trim() : "";
  if (q) body.query = q;

  if (cursor && Array.isArray(cursor) && cursor.length > 0) body.searchAfter = cursor;
  return body;
}

interface GhlSearchResult {
  contacts?: Array<Record<string, unknown>>;
  total?: number;
}

/** One page of contacts/search. */
async function searchPage(
  cfg: GhlConfig,
  filters: HygieneFilters,
  pageLimit: number,
  cursor?: unknown[],
): Promise<GhlResponse<GhlSearchResult>> {
  return await ghlFetch<GhlSearchResult>(
    cfg, "POST", "/contacts/search",
    buildSearchBody(cfg, filters, pageLimit, cursor),
  );
}

/** Map a raw GHL contact to the compact row the builder UI renders. */
function mapContact(c: Record<string, unknown>) {
  const business =
    (c.companyName as string | null) || (c.businessName as string | null) || null;
  const contact =
    (c.contactName as string | null) ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
  return {
    id: String(c.id),
    business_name: business,
    contact_name: contact,
    phone: (c.phone as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    city: (c.city as string | null) ?? null,
    state: (c.state as string | null) ?? null,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
  };
}

/** Denormalized snapshot stored on each smart_list_member (hygiene.ts MemberSnapshot
 *  + tags). phone-validate reads snapshot.phone, so it MUST be present when known. */
function snapshotFromContact(m: ReturnType<typeof mapContact>) {
  return {
    business: m.business_name,
    contact: m.contact_name,
    phone: m.phone,
    email: m.email,
    state: m.state,
    city: m.city,
    tags: m.tags,
  };
}

/** Cursor lives on the LAST contact of a page as its `searchAfter` array. */
function cursorOf(contacts: Array<Record<string, unknown>>): unknown[] | null {
  const last = contacts[contacts.length - 1] as { searchAfter?: unknown[] } | undefined;
  return Array.isArray(last?.searchAfter) ? last!.searchAfter! : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // --- Authn/Authz: signed-in staff only (closer | admin | super_admin) ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  if (!callerProfile || !ALLOWED_ROLES.includes(callerProfile.role)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const filters: HygieneFilters = (body.filters as HygieneFilters) ?? {};

  try {
    const cfg = await getGhlConfig(db);

    switch (action) {
      // ── list the location's tags for the builder's tag multiselect ──────────────
      case "tags": {
        const r = await ghlFetch<{ tags?: Array<{ id: string; name: string }> }>(
          cfg, "GET", `/locations/${cfg.locationId}/tags`,
        );
        if (!r.ok) return json({ error: ghlErrorMessage(r.error) || "tags failed" }, r.status || 500);
        const tags = (r.data?.tags ?? []).map((t) => ({ id: t.id, name: t.name }));
        // Alphabetical so the picker is stable.
        tags.sort((a, b) => a.name.localeCompare(b.name));
        return json({ tags });
      }

      // ── total count for a filter ────────────────────────────────────────────────
      // No area code → exactly ONE GHL call (the API's own total). With area codes
      // the API can't count them, so scan a bounded number of pages, count matches,
      // and flag the result approximate (the real filter still applies on save).
      case "preview": {
        const acodes = areaCodeSet(filters);
        if (acodes.size === 0) {
          const r = await searchPage(cfg, filters, 1);
          if (!r.ok) return json({ error: ghlErrorMessage(r.error) || "preview failed" }, r.status || 500);
          return json({ total: r.data?.total ?? 0 });
        }
        let matched = 0;
        let scanned = 0;
        let apiTotal = 0;
        let cursor: unknown[] | undefined = undefined;
        for (let p = 0; p < AREACODE_PREVIEW_PAGES; p++) {
          const r = await searchPage(cfg, filters, PAGE_MAX, cursor);
          if (!r.ok) return json({ error: ghlErrorMessage(r.error) || "preview failed" }, r.status || 500);
          apiTotal = r.data?.total ?? apiTotal;
          const raw = r.data?.contacts ?? [];
          if (raw.length === 0) break;
          for (const c of raw) if (acodes.has(areaCodeOf((c as { phone?: unknown }).phone))) matched++;
          scanned += raw.length;
          const next = cursorOf(raw);
          if (!next || raw.length < PAGE_MAX) break;
          cursor = next;
        }
        // If the whole book fit inside the scan the count is exact; otherwise it's a
        // lower-bound estimate over the sample.
        const exact = scanned >= apiTotal;
        return json({ total: matched, approximate: !exact, scanned, api_total: apiTotal });
      }

      // ── one page of matching contacts (for the builder's live results table) ────
      case "search": {
        const pageLimit = Math.min(
          Math.max(1, Number(body.pageLimit) || DEFAULT_SEARCH_PAGE),
          PAGE_MAX,
        );
        const cursor = Array.isArray(body.cursor) ? (body.cursor as unknown[]) : undefined;
        const r = await searchPage(cfg, filters, pageLimit, cursor);
        if (!r.ok) return json({ error: ghlErrorMessage(r.error) || "search failed" }, r.status || 500);
        const raw = r.data?.contacts ?? [];
        const acodes = areaCodeSet(filters);
        const kept = acodes.size === 0 ? raw : raw.filter((c) => acodes.has(areaCodeOf((c as { phone?: unknown }).phone)));
        return json({
          contacts: kept.map(mapContact),
          total: r.data?.total ?? raw.length,
          // Only advertise a next page when this one came back full (cursor from raw).
          nextCursor: raw.length >= pageLimit ? cursorOf(raw) : null,
        });
      }

      // ── page through the matches and INSERT them into smart_list_members ────────
      case "materialize": {
        const smartListId = body.smart_list_id ? String(body.smart_list_id) : "";
        if (!smartListId) return json({ error: "smart_list_id required" }, 400);

        // The list must exist (and, because we write with the service role, this is
        // the only ownership check — RLS already gated the caller's read of it).
        const { data: list, error: listErr } = await db
          .from("smart_lists").select("id").eq("id", smartListId).single();
        if (listErr || !list) return json({ error: "smart_list not found" }, 404);

        const max = Math.min(
          Math.max(1, Number(body.max) || MATERIALIZE_DEFAULT_MAX),
          MATERIALIZE_HARD_MAX,
        );

        let scanned = 0;
        let inserted = 0;
        let total = 0;
        let capped = false;
        let parked = false;
        let cursor: unknown[] | undefined = undefined;
        const acodes = areaCodeSet(filters); // client-side narrowing per page

        // Drain by cursor. Each page is ≤200; stop on cap, empty page, or a
        // dwindling daily budget (park — never blow the 200k/day cap).
        for (let guard = 0; guard < Math.ceil(MATERIALIZE_HARD_MAX / PAGE_MAX) + 2; guard++) {
          const remaining = max - scanned;
          if (remaining <= 0) { capped = true; break; }
          const pageLimit = Math.min(PAGE_MAX, remaining);

          const r = await searchPage(cfg, filters, pageLimit, cursor);
          if (!r.ok) {
            // A daily-cap 429 is terminal (ghlFetch already exhausted burst retries).
            if (r.status === 429) { parked = true; break; }
            return json({ error: ghlErrorMessage(r.error) || "materialize search failed" }, r.status || 500);
          }
          total = r.data?.total ?? total;
          const raw = r.data?.contacts ?? [];
          if (raw.length === 0) break;

          const keep = acodes.size === 0 ? raw : raw.filter((c) => acodes.has(areaCodeOf((c as { phone?: unknown }).phone)));
          const mapped = keep.map(mapContact);
          const rows = mapped.map((m) => ({
            smart_list_id: smartListId,
            source: "ghl",
            source_id: m.id,
            snapshot: snapshotFromContact(m),
          }));
          // Idempotent: unique(smart_list_id, source, source_id) — a contact already
          // captured on a prior run is ignored, not duplicated.
          const { error: upErr, count } = await db
            .from("smart_list_members")
            .upsert(rows, { onConflict: "smart_list_id,source,source_id", ignoreDuplicates: true, count: "exact" });
          if (upErr) return json({ error: `insert failed: ${upErr.message}` }, 500);
          inserted += count ?? 0;
          scanned += raw.length;

          const next = cursorOf(raw);
          if (!next || raw.length < pageLimit) break; // last page
          cursor = next;

          // Budget guard: park BEFORE the next page if the daily cap is close.
          const dr = r.rate?.dailyRemaining;
          if (dr != null && dr < DAILY_FLOOR) { parked = true; break; }
        }

        if (scanned >= max && total > scanned) capped = true;

        // Stamp the cached membership count (all members of this list, any source —
        // it may be 'mixed') + the refreshed time.
        const { count: memberCount } = await db
          .from("smart_list_members")
          .select("id", { count: "exact", head: true })
          .eq("smart_list_id", smartListId);
        await db
          .from("smart_lists")
          .update({ member_count: memberCount ?? 0, last_refreshed_at: new Date().toISOString() })
          .eq("id", smartListId);

        return json({
          inserted,
          scanned,
          total,
          capped,
          parked,
          member_count: memberCount ?? 0,
          note: capped
            ? `Capped at ${max} contacts (matched ${total}) — narrow the tag/query and re-run to capture more.`
            : parked
            ? "Parked to protect the GHL daily call budget — re-run later or narrow the filter."
            : undefined,
        });
      }

      default:
        return json({ error: `unknown action: ${action || "(none)"}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ghl-contacts-search] error", JSON.stringify({ action, error: msg }));
    return json({ error: msg }, 500);
  }
});
