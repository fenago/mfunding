// instantly — thin, read-only proxy over the Instantly.ai API (v2) for the
// admin "Email" page. Instantly is the system of record for cold-email
// infrastructure (sending mailboxes, warmup, campaigns); this function only
// PROXIES read calls so the dashboard can show status. It never stores mail
// and never exposes the API key to the browser.
//
// The API key lives ONLY in the Supabase vault (INSTANTLY_API_KEY) and is read
// server-side via the public.get_instantly_key() SECURITY DEFINER RPC.
//
// Auth: caller's Supabase JWT is verified and profiles.role must be admin or
// super_admin.
//
// POST { action }:
//   "overview" (default) → { accounts, campaigns, key_present }
//   "accounts"           → { accounts }
//   "campaigns"          → { campaigns }
//   "analytics"          → { ok, totals, campaigns[] } cold-email conversion
//                          metrics (sent/opened/replied/leads/opportunities/
//                          bounced). Degrades to a zero/warning shape (200) if
//                          the analytics endpoints are unavailable.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const ALLOWED_ROLES = ["admin", "super_admin"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** GET an Instantly v2 endpoint; returns the parsed body (items[] flattened when present). */
async function instantlyGet(apiKey: string, path: string): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  try {
    const res = await fetch(`${INSTANTLY_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : (typeof data === "string" ? data : JSON.stringify(data)) };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

/** Our real live site — every sending domain should FORWARD here. */
const REAL_SITE = "mfunding.net";

/** Server-side forwarding check: where does a sending domain redirect when
 * visited? The admin page can't read cross-origin redirects, but we can. Returns
 * the redirect target + whether it points at our real site (mfunding.net). */
async function checkForwarding(domain: string): Promise<{ target: string | null; ok: boolean }> {
  for (const scheme of ["https", "http"]) {
    try {
      const res = await fetch(`${scheme}://${domain}`, { redirect: "manual", signal: AbortSignal.timeout(6000) });
      const loc = res.headers.get("location");
      if (loc) {
        let host = loc;
        try { host = new URL(loc).hostname; } catch { /* keep raw */ }
        return { target: host.replace(/^www\./, ""), ok: host.replace(/^www\./, "") === REAL_SITE };
      }
      // 200 with no redirect = it resolves to itself, not forwarded to the real site
      if (res.status >= 200 && res.status < 300) return { target: domain, ok: false };
    } catch { /* try next scheme */ }
  }
  return { target: null, ok: false };
}

/** Unique sending domains from the account emails. */
function domainsOf(accounts: unknown[]): string[] {
  const set = new Set<string>();
  for (const a of accounts as { email?: string }[]) {
    const d = a.email?.split("@")[1]?.toLowerCase();
    if (d) set.add(d);
  }
  return [...set];
}

/** Instantly v2 list endpoints return { items: [...] } — normalize to an array. */
function items(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const p = payload as { items?: unknown[]; data?: unknown[] } | null;
  if (p && Array.isArray(p.items)) return p.items;
  if (p && Array.isArray(p.data)) return p.data;
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // --- Authn/Authz ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
  if (!prof || !ALLOWED_ROLES.includes(prof.role)) return json({ error: "Forbidden — admins only" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* default overview */ }
  const action = String(body.action ?? "overview");

  // --- Read the API key from the vault (server-side only) ---
  const { data: apiKey, error: keyErr } = await db.rpc("get_instantly_key");
  if (keyErr) return json({ error: `vault read failed: ${keyErr.message}` }, 500);
  if (!apiKey || typeof apiKey !== "string") {
    return json({ error: "INSTANTLY_API_KEY not found in vault", key_present: false }, 500);
  }

  try {
    if (action === "accounts") {
      const r = await instantlyGet(apiKey, "/accounts?limit=100");
      if (!r.ok) return json({ error: r.error || "accounts fetch failed" }, r.status || 502);
      return json({ accounts: items(r.data) });
    }
    if (action === "campaigns") {
      const r = await instantlyGet(apiKey, "/campaigns?limit=100");
      if (!r.ok) return json({ error: r.error || "campaigns fetch failed" }, r.status || 502);
      return json({ campaigns: items(r.data) });
    }
    if (action === "analytics") {
      // Real cold-email conversion metrics from the Instantly v2 analytics API.
      //   aggregate rollup  : GET /campaigns/analytics/overview
      //   per-campaign rows : GET /campaigns/analytics?ids=<uuid>&ids=<uuid>...
      // The per-campaign endpoint returns [] unless explicit ids are passed
      // (never-launched campaigns are filtered out), so fetch the campaign list
      // first and query analytics for those ids. ids MUST be repeated params —
      // a comma-joined list is rejected (400, each must be a valid uuid).
      // Field mapping (verified against the live payload):
      //   sent          <- emails_sent_count
      //   opened        <- open_count
      //   replied       <- reply_count
      //   leads         <- new_leads_contacted_count  (present in both endpoints)
      //   opportunities <- total_opportunities        (aggregate only)
      //   bounced       <- bounced_count               (aggregate only)
      const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

      const [ov, camp] = await Promise.all([
        instantlyGet(apiKey, "/campaigns/analytics/overview"),
        instantlyGet(apiKey, "/campaigns?limit=100"),
      ]);

      // Per-campaign breakdown (best-effort; degrades independently).
      const ids = (items(camp.data) as { id?: string }[])
        .map((c) => c.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      let perCampaign: unknown[] = [];
      let perErr: string | null = null;
      if (ids.length) {
        const qs = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
        const ca = await instantlyGet(apiKey, `/campaigns/analytics?${qs}`);
        if (ca.ok) perCampaign = items(ca.data);
        else perErr = ca.error || `status ${ca.status}`;
      }

      // If the aggregate call failed AND we got no per-campaign rows, the
      // analytics API is effectively unavailable — return zeros + a warning so
      // the UI can show "no analytics yet" instead of erroring.
      if (!ov.ok && !perCampaign.length) {
        return json({
          ok: true,
          totals: { sent: 0, opened: 0, replied: 0, leads: 0, opportunities: 0, bounced: 0 },
          campaigns: [],
          warning: ov.error
            ? `analytics unavailable: ${ov.error}`
            : "no analytics available for this account yet",
        });
      }

      const o = (ov.ok && ov.data && typeof ov.data === "object" ? ov.data : {}) as Record<string, unknown>;
      const totals = {
        sent: num(o.emails_sent_count),
        opened: num(o.open_count),
        replied: num(o.reply_count),
        leads: num(o.new_leads_contacted_count),
        opportunities: num(o.total_opportunities),
        bounced: num(o.bounced_count),
      };

      const campaigns = (perCampaign as Record<string, unknown>[]).map((c) => ({
        id: String(c.campaign_id ?? ""),
        name: String(c.campaign_name ?? ""),
        sent: num(c.emails_sent_count),
        opened: num(c.open_count),
        replied: num(c.reply_count),
        leads: num(c.new_leads_contacted_count),
      }));

      // Surface a partial-degradation note without failing the whole call.
      const warnings: string[] = [];
      if (!ov.ok) warnings.push(`aggregate totals degraded: ${ov.error || "unavailable"}`);
      if (perErr) warnings.push(`per-campaign analytics degraded: ${perErr}`);
      return json({ ok: true, totals, campaigns, ...(warnings.length ? { warning: warnings.join("; ") } : {}) });
    }
    // default: overview — accounts + campaigns together (each degrades gracefully)
    const [acc, camp] = await Promise.all([
      instantlyGet(apiKey, "/accounts?limit=100"),
      instantlyGet(apiKey, "/campaigns?limit=100"),
    ]);
    const accounts = acc.ok ? items(acc.data) : [];
    // Live forwarding check per sending domain (target + is-it-mfunding.net).
    const doms = domainsOf(accounts);
    const fwdPairs = await Promise.all(doms.map(async (d) => [d, await checkForwarding(d)] as const));
    const forwarding: Record<string, { target: string | null; ok: boolean }> = {};
    for (const [d, f] of fwdPairs) forwarding[d] = f;
    return json({
      key_present: true,
      accounts,
      campaigns: camp.ok ? items(camp.data) : [],
      forwarding,
      real_site: REAL_SITE,
      errors: {
        accounts: acc.ok ? null : (acc.error || `status ${acc.status}`),
        campaigns: camp.ok ? null : (camp.error || `status ${camp.status}`),
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
