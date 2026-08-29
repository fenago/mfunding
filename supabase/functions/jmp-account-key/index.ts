// jmp-account-key — SECURE read/write of the JMP/Cheogram ACCOUNT PASSWORD.
//
// The owner wants his JMP account key viewable in the admin section, but it must
// NEVER live in the repo/source. This function is the only bridge between the UI
// and the Supabase VAULT (encrypted at rest): it reads/writes the 'JMP_ACCOUNT_KEY'
// vault entry through two service_role-only SECURITY DEFINER RPCs
// (get_jmp_account_key / set_jmp_account_key, see 20260829h_jmp_account_key.sql).
//
//   GET                → { ok:true, value:"<decrypted>", hasValue }   (Reveal)
//   POST { value }     → { ok:true, saved:true }                      (Save)
//        | { ok:false, error, code }                                  (4xx/5xx)
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
// verify_jwt = true at the gateway PLUS an in-code SUPER_ADMIN check against
// profiles — identical to jmp-command. Per the house rule a service_role bearer is
// NOT a session and is rejected. There is NO cron/shared-secret path — this is a
// human-only, super-admin-only console control. Defense in depth: gateway JWT →
// in-code super_admin → service-role RPC → vault.
//
// ⚠️ NO SECRET IS HARDCODED ANYWHERE. The vault entry starts absent; the owner
// types/pastes the value in the UI, which POSTs it here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClient } from "../_shared/ghl.ts";

// Local CORS (the shared one is POST-only; Reveal uses GET).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// A password field, not a document — cap it so a paste accident can't stuff the vault.
const MAX_LEN = 512;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, error: string, status: number) {
  return json({ ok: false, code, error }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return fail("method", "Method not allowed", 405);
  }

  const db = serviceClient();

  // ── Auth: a real super_admin session. A service_role bearer is not a session. ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("unauthorized", "Missing authorization", 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return fail("unauthorized", "Invalid session", 401);

  const { data: prof, error: profErr } = await db
    .from("profiles").select("id, role").eq("id", caller.id).maybeSingle();
  if (profErr) return fail("server", `Could not read your profile: ${profErr.message}`, 500);
  if (prof?.role !== "super_admin") {
    return fail("forbidden", "Super-admin access required", 403);
  }

  // ── READ (Reveal): return the decrypted value. ──
  if (req.method === "GET") {
    const { data, error } = await db.rpc("get_jmp_account_key");
    if (error) return fail("server", `Could not read the account key: ${error.message}`, 500);
    const value = typeof data === "string" ? data : "";
    return json({ ok: true, value, hasValue: value.length > 0 });
  }

  // ── WRITE (Save): store the value in the vault. ──
  const payload = (await req.json().catch(() => null)) as { value?: string } | null;
  if (!payload) return fail("bad_request", "Invalid JSON body", 400);
  const raw = String(payload.value ?? "");
  const value = raw.trim(); // trim paste artifacts (trailing newline/space)
  if (!value) return fail("bad_request", "Missing value", 400);
  if (value.length > MAX_LEN) {
    return fail("too_long", `Value is too long (max ${MAX_LEN} characters).`, 400);
  }

  const { error } = await db.rpc("set_jmp_account_key", { p_value: value });
  if (error) return fail("server", `Could not save the account key: ${error.message}`, 500);
  return json({ ok: true, saved: true });
});
