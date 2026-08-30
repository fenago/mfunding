// smart-list-action — the "act on a cleaned smart list" edge fn (final Data Hygiene wave).
//
// Three actions on a saved smart_list, layered on the enrichment columns the other
// DH fns write (phone_reachable / phone_disconnected / best_phone_dnc / tcpa_litigator
// / best_phone / …):
//
//   • rollup        — the RESULTS ROLLUP: counts over the members
//                     { total, reachable, dead, dnc, litigator, no_contact,
//                       unvalidated, excluded, dialable }. No spend, no writes.
//                     Backed by the smart_list_rollup() RPC (single source of the
//                     dialable predicate).
//   • suppress      — TAKE ACTION: mark dead OR dnc OR litigator members
//                     excluded=true so they're never dialed. Reversible.
//                     Returns how many by reason (each row attributed once, by the
//                     most-severe reason: litigator > dnc > disconnected).
//   • unsuppress    — clear the SYSTEM exclusions (leaves manual excludes intact).
//   • push_to_setters — hand the DIALABLE members to the dialer by tagging their GHL
//                     contacts with the list's dial_tag (ADDITIVE addContactTags —
//                     NEVER upsert-with-tags, per the tag-wipe finding). Only members
//                     that already carry a ghl_contact_id are tagged; the rest are
//                     counted as needs_ghl_push (owner pushes them via the Lead
//                     Machine — we NEVER auto-create contacts here).
//                     sub_mode:'preview' returns { dialable_count, ghl_calls_needed,
//                     needs_ghl_push, daily_remaining } BEFORE any spend. The real
//                     push is CAP-AWARE: parks below DAILY_FLOOR remaining / on a
//                     daily-cap 429, caps at MAX_TAGS per call, and stamps
//                     smart_lists.dial_tag / pushed_to_setters_at / pushed_count.
//
// AUTH (copied from phone-validate): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient,
  getGhlConfig, addContactTags, createLocationTag, listLocationTags,
  ghlErrorMessage, type GhlConfig, type GhlRateInfo,
} from "../_shared/ghl.ts";

const DAILY_FLOOR = 1000;     // park the push when GHL's daily-remaining drops below this
const MAX_TAGS = 3000;        // cap tags per invocation (UI can call again to continue)
const BUDGET_MS = 55_000;     // stop starting new GHL calls past this (platform kills ~60s)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

/* GHL-safe tag: lowercase, alnum + single dashes. `smartlist-<slug>` by default. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "list";
}

type DialableRow = { member_id: string; source: string; source_id: string; ghl_contact_id: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const action = String(payload.action ?? "").toLowerCase();
  const smartListId = clean(payload.smart_list_id);
  if (!smartListId) return json({ ok: false, error: "smart_list_id is required" }, 400);

  // ── rollup ───────────────────────────────────────────────────────────────────
  if (action === "rollup") {
    const { data, error } = await db.rpc("smart_list_rollup", { p_list: smartListId });
    if (error) return json({ ok: false, action, error: error.message }, 500);
    return json({ ok: true, action, ...(data as Record<string, unknown>) });
  }

  // ── suppress / unsuppress ──────────────────────────────────────────────────────
  if (action === "suppress" || action === "unsuppress") {
    const nowIso = new Date().toISOString();

    if (action === "unsuppress") {
      // Reverse of suppress: clear only the SYSTEM reasons; leave manual excludes.
      const { data, error } = await db.from("smart_list_members")
        .update({ excluded: false, excluded_reason: null, excluded_at: null })
        .eq("smart_list_id", smartListId)
        .eq("excluded", true)
        .in("excluded_reason", ["disconnected", "dnc", "litigator"])
        .select("id");
      if (error) return json({ ok: false, action, error: error.message }, 500);
      const cleared = (data as { id: string }[] | null)?.length ?? 0;
      return json({ ok: true, action, cleared });
    }

    // suppress: attribute each not-yet-excluded row to its most-severe reason.
    // Order matters — litigator > dnc > disconnected — so a row counted once.
    let litigator = 0, dnc = 0, disconnected = 0;
    const stamp = async (col: string, reason: string): Promise<number> => {
      const { data, error } = await db.from("smart_list_members")
        .update({ excluded: true, excluded_reason: reason, excluded_at: nowIso })
        .eq("smart_list_id", smartListId)
        .eq("excluded", false)
        .eq(col, true)
        .select("id");
      if (error) throw new Error(`${reason} suppress: ${error.message}`);
      return (data as { id: string }[] | null)?.length ?? 0;
    };
    try {
      litigator = await stamp("tcpa_litigator", "litigator");
      dnc = await stamp("best_phone_dnc", "dnc");
      disconnected = await stamp("phone_disconnected", "disconnected");
    } catch (e) {
      return json({ ok: false, action, error: e instanceof Error ? e.message : String(e) }, 500);
    }
    const suppressed = litigator + dnc + disconnected;
    return json({ ok: true, action, suppressed, litigator, dnc, disconnected });
  }

  // ── push_to_setters (+ preview sub-mode) ────────────────────────────────────────
  if (action === "push_to_setters") {
    const subMode = String(payload.sub_mode ?? payload.mode ?? "").toLowerCase();

    // Resolve the list first (cheap) so a bad id 404s before any GHL spend.
    // Tag: explicit body value, else the list's stored dial_tag, else smartlist-<slug>.
    const { data: listRow, error: listErr } = await db.from("smart_lists")
      .select("name,dial_tag").eq("id", smartListId).single();
    if (listErr) return json({ ok: false, action, error: `list not found: ${listErr.message}` }, 404);
    const dialTag = clean(payload.dial_tag)
      ?? clean((listRow as { dial_tag?: string })?.dial_tag)
      ?? `smartlist-${slugify(String((listRow as { name?: string })?.name ?? smartListId))}`;

    // The dialable set (with resolved GHL contact ids) — single source of truth.
    const { data: dialData, error: dialErr } = await db.rpc("smart_list_dialable", { p_list: smartListId });
    if (dialErr) return json({ ok: false, action, error: dialErr.message }, 500);
    const rows = (dialData as DialableRow[] | null) ?? [];
    const withGhl = rows.filter((r) => clean(r.ghl_contact_id));
    const needsGhlPush = rows.length - withGhl.length;

    // GHL config + a light GET to read the current daily-remaining headroom.
    let cfg: GhlConfig;
    try { cfg = await getGhlConfig(db); }
    catch (e) { return json({ ok: false, action, error: e instanceof Error ? e.message : String(e) }, 500); }
    const tagsProbe = await listLocationTags(cfg);
    let dailyRemaining: number | null = tagsProbe.rate?.dailyRemaining ?? null;

    // preview: report headroom, spend nothing.
    if (subMode === "preview") {
      return json({
        ok: true, action, sub_mode: "preview",
        dialable_count: rows.length,
        ghl_calls_needed: withGhl.length,   // one addContactTags call per in-GHL member
        needs_ghl_push: needsGhlPush,
        daily_remaining: dailyRemaining,
        dial_tag: dialTag,
      });
    }

    // ── real push ──
    // Pre-flight: if we're already under the floor, park before spending anything.
    if (dailyRemaining != null && dailyRemaining < DAILY_FLOOR) {
      return json({
        ok: true, action, tagged: 0, needs_ghl_push: needsGhlPush,
        parked: withGhl.length, capped: false, dial_tag: dialTag,
        note: `GHL daily budget low (${dailyRemaining} left, floor ${DAILY_FLOOR}) — parked. Retry after the ~17:33Z reset.`,
      });
    }

    // Ensure the tag exists at the location so a VibeReach/HP campaign can point at
    // it even before the first contact is tagged (idempotent; not a contact push).
    await createLocationTag(cfg, dialTag);

    const started = Date.now();
    let tagged = 0, errored = 0;
    let capped = false;
    for (let i = 0; i < withGhl.length; i++) {
      if (tagged >= MAX_TAGS) { capped = true; break; }
      if (Date.now() - started > BUDGET_MS) { capped = true; break; }
      if (dailyRemaining != null && dailyRemaining < DAILY_FLOOR) break;  // park (rate)

      const contactId = clean(withGhl[i].ghl_contact_id)!;
      const res = await addContactTags(cfg, contactId, [dialTag]);
      if (res.rate?.dailyRemaining != null) dailyRemaining = res.rate.dailyRemaining;

      if (res.ok) { tagged++; continue; }
      // A 429 that survived ghlFetch's burst retries → treat as a cap/park signal.
      // (branch on daily-remaining, per ghl-api-daily-cap: low ⇒ daily cap, abort.)
      if (res.status === 429) break;
      errored++;   // a real 4xx (e.g. contact deleted) — record and move on
    }
    // Members with a GHL id we neither tagged nor errored = parked (rate/cap/budget).
    const parked = withGhl.length - tagged - errored;

    // Stamp the handoff on the list (best-effort, LOUD).
    const { error: stampErr } = await db.from("smart_lists")
      .update({ dial_tag: dialTag, pushed_to_setters_at: new Date().toISOString(), pushed_count: tagged })
      .eq("id", smartListId);
    if (stampErr) console.error("[smart-list-action] list stamp failed", JSON.stringify({ smartListId, error: stampErr.message }));

    return json({
      ok: true, action,
      tagged, needs_ghl_push: needsGhlPush, parked, capped, errored,
      dial_tag: dialTag, daily_remaining: dailyRemaining,
    });
  }

  return json({ ok: false, error: `unknown action '${action}'` }, 400);
});
