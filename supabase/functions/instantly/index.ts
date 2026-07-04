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
    // default: overview — accounts + campaigns together (each degrades gracefully)
    const [acc, camp] = await Promise.all([
      instantlyGet(apiKey, "/accounts?limit=100"),
      instantlyGet(apiKey, "/campaigns?limit=100"),
    ]);
    return json({
      key_present: true,
      accounts: acc.ok ? items(acc.data) : [],
      campaigns: camp.ok ? items(camp.data) : [],
      errors: {
        accounts: acc.ok ? null : (acc.error || `status ${acc.status}`),
        campaigns: camp.ok ? null : (camp.error || `status ${camp.status}`),
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
