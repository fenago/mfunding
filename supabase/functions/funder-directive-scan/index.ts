// funder-directive-scan — re-read captured funder replies for STANDING
// INSTRUCTIONS (a new submissions inbox, a retired one, portal-only, new
// required docs, a changed contact) and raise a funder_directives row for each.
//
// WHY THIS EXISTS ALONGSIDE THE LIVE HOOK. Detection normally runs inside
// captureFunderReply(), so the poller, the webhook and the vendor sweep all do
// it on arrival. This function is the other two things that need doing:
//
//   1. BACKFILL. 156 replies were captured before the detector existed, and the
//      one that mattered — Uplyft, 2026-09-17 — is among them. A detector that
//      only looks forward leaves the known failure unflagged.
//   2. THE SAFETY NET. The live hook is wrapped so a detection failure can
//      never break the reply path, which means a detection failure is possible
//      and nothing else would retry it. Run nightly, this re-reads anything
//      with no directive row and no record of having been scanned clean.
//
// It is idempotent: recordDirectives() upserts on (funder_reply_id, kind), so
// re-running writes nothing new. Pure CPU over rows we already hold — no GHL
// calls, so it costs nothing against the 200k/day location cap.
//
// NOTHING IT WRITES IS EVER APPLIED AUTOMATICALLY. It raises proposals against
// funder_directives and touches neither `lenders` nor
// `funder_submission_profiles`. An inbound email is untrusted input; a person
// applies the change.
//
// AUTH (mirrors ph-ucc-scan-unmatched): trusted cron via ?secret=<GHL webhook
// secret> + anon-key Bearer, OR a signed-in staff user (closer/admin/
// super_admin). A service-role bearer deliberately FAILS the role check — use
// the secret path for server-side calls.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { recordDirectives } from "../_shared/funderDirective.ts";
import { BUILD_AT, BUILD_COMMIT } from "../_shared/buildInfo.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Rows per run. The whole corpus is 156, so one page covers it today. */
const DEFAULT_LIMIT = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* GET/cron */ }
  const limit = Math.min(Number(payload.limit ?? url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 2000);
  const sinceParam = String(payload.since ?? url.searchParams.get("since") ?? "").trim();
  const started = Date.now();

  let q = db.from("funder_replies")
    .select("id, lender_id, deal_id, deal_submission_id, subject, from_email, received_at, full_body")
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (sinceParam) q = q.gte("received_at", sinceParam);

  const { data: replies, error: readErr } = await q;

  // ⚠️ AN UNREADABLE CORPUS IS NOT AN EMPTY ONE. Returning scanned:0 on a
  // failed read would read as "nothing to do" on every surface that calls this
  // — the same shape of lie the directive queue exists to end. Fail loudly.
  if (readErr) {
    return json({
      error: `could not read funder_replies: ${readErr.message}`,
      scanned: null,
      note: "This is NOT 'no replies to scan' — the corpus could not be read at all.",
      build: { commit: BUILD_COMMIT, at: BUILD_AT },
    }, 500);
  }
  if (!replies) {
    return json({
      error: "funder_replies read returned no result object",
      scanned: null,
      build: { commit: BUILD_COMMIT, at: BUILD_AT },
    }, 500);
  }

  let scanned = 0;
  let flagged = 0;
  let written = 0;
  const failures: Array<{ replyId: string; error: string }> = [];
  const found: Array<{ replyId: string; lenderId: string; kinds: string[]; subject: string | null }> = [];

  for (const r of replies) {
    scanned++;
    const res = await recordDirectives(db, {
      lenderId: r.lender_id as string,
      funderReplyId: r.id as string,
      fullBody: (r.full_body as string) ?? "",
      dealId: (r.deal_id as string | null) ?? null,
      dealSubmissionId: (r.deal_submission_id as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      fromEmail: (r.from_email as string | null) ?? null,
      receivedAt: (r.received_at as string | null) ?? null,
    });
    if (res.error) failures.push({ replyId: r.id as string, error: res.error });
    if (res.kinds.length) {
      flagged++;
      written += res.written;
      found.push({
        replyId: r.id as string,
        lenderId: r.lender_id as string,
        kinds: res.kinds,
        subject: (r.subject as string | null) ?? null,
      });
    }
  }

  const { count: openCount, error: countErr } = await db
    .from("funder_directives")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return json({
    ok: failures.length === 0,
    scanned,
    repliesWithADirective: flagged,
    rowsWritten: written,
    // null, not 0 — "we could not count" is a different fact from "none open".
    openDirectives: countErr ? null : (openCount ?? 0),
    openDirectivesError: countErr?.message ?? null,
    found,
    failures,
    ms: Date.now() - started,
    build: { commit: BUILD_COMMIT, at: BUILD_AT },
  }, failures.length ? 207 : 200);
});
