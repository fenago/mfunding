// plaid-institutions — staff-facing lookup over Plaid's institution directory, plus
// the integration health snapshot that powers /admin/plaid and the System Monitor
// Plaid card.
//
// WHY: OAuth enablement (Chase/BofA-class banks) is per-institution and lives ONLY in
// the Plaid dashboard — there is no API for it. What Plaid DOES expose is the
// institution directory (~12k US institutions) including each one's `oauth` flag and
// supported products. This function makes that searchable from the admin UI so the
// owner can answer "can a merchant at <bank> connect?" without leaving the app.
//
// verify_jwt = false: auth is in-code — either the shared GHL webhook secret
// (?secret=, for cron/server-side callers) OR a staff JWT (the admin UI). A
// service-role bearer is NOT a session and deliberately fails the role check (house
// rule) — server-side callers use the secret path.
//
// POST body:
//   { action: 'search', query: string, products?: string[], count?: number }
//   { action: 'list',   count?: number, offset?: number }
//   { action: 'status' }   → PlaidHealth (env, key presence, products, OAuth, items)
//
// Compliance: internal ops only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { buildPlaidHealth, getPlaidConfig, plaidFetch, resolveEnv } from "../_shared/plaid.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Plaid institution object — we surface only the fields the admin UI renders. */
interface PlaidInstitution {
  institution_id: string;
  name: string;
  products?: string[];
  oauth?: boolean;
  logo?: string | null;
  url?: string | null;
  primary_color?: string | null;
}

interface Body {
  action?: "search" | "list" | "status";
  query?: string;
  products?: string[];
  count?: number;
  offset?: number;
}

function shape(i: PlaidInstitution) {
  return {
    institution_id: i.institution_id,
    name: i.name,
    oauth: i.oauth === true,
    products: Array.isArray(i.products) ? i.products : [],
    logo: i.logo ?? null,
    url: i.url ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth: shared secret OR staff JWT (mirrors plaid-pull) ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
    if (staff !== true) return json({ error: "Forbidden — staff only" }, 403);
  }

  let body: Body;
  try { body = (await req.json()) as Body; } catch { body = {}; }
  const action = body.action ?? "search";

  // ── status: the integration health snapshot (shared with system-health-check) ──
  if (action === "status") {
    try {
      const health = await buildPlaidHealth(db);
      return json({ ok: true, plaid: health });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const env = await resolveEnv(db);
  let cfg;
  try { cfg = await getPlaidConfig(db, env); }
  catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); }

  // Plaid caps /institutions/* at 500 per page.
  const count = Math.min(500, Math.max(1, Number(body.count) || 50));

  if (action === "list") {
    const offset = Math.max(0, Number(body.offset) || 0);
    const res = await plaidFetch<{ institutions: PlaidInstitution[]; total: number }>(cfg, "/institutions/get", {
      count, offset, country_codes: ["US"], options: { include_optional_metadata: true },
    });
    if (!res.ok) {
      return json({ ok: false, error: res.error ?? "institutions/get failed", error_code: res.errorCode ?? null }, 502);
    }
    return json({
      ok: true, env,
      institutions: (res.data?.institutions ?? []).map(shape),
      total: res.data?.total ?? null,
    });
  }

  // ── search ──
  const query = (body.query ?? "").trim();
  if (!query) return json({ ok: false, error: "query is required for action 'search'" }, 400);

  // /institutions/search requires `products`; null means "any product".
  const products = Array.isArray(body.products) && body.products.length ? body.products : null;
  const res = await plaidFetch<{ institutions: PlaidInstitution[] }>(cfg, "/institutions/search", {
    query, products, country_codes: ["US"], options: { include_optional_metadata: true },
  });
  if (!res.ok) {
    return json({ ok: false, error: res.error ?? "institutions/search failed", error_code: res.errorCode ?? null }, 502);
  }
  return json({
    ok: true, env, query,
    institutions: (res.data?.institutions ?? []).slice(0, count).map(shape),
  });
});
