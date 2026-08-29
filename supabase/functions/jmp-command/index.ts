// jmp-command — queue ONE read-only command to the JMP/Cheogram ACCOUNT BOT.
//
// This function does not talk to XMPP. It writes a single row into
// public.jmp_bot_messages with status 'queued'; the droplet bridge's bot pump
// polls queued rows and sends the body as a chat message to the bare JID
// `cheogram.com`. The bot's reply comes back through the bridge as an inbound
// jmp_bot_messages row. Everything here is the gate in front of that queue.
//
//   POST { command }
//        → { ok:true, id, command, status:'queued' }   (200)
//        | { ok:false, error, code }                    (4xx/5xx)
//
// ── SAFETY: READ-ONLY ALLOWLIST ──────────────────────────────────────────────
// Only the SIX read-only account commands are executable here. Billing commands
// (top up, alt top up, credit cards) and account-changing commands (subaccount,
// reset sip account, lnp, set-port-out-pin, change jabber id, register) are
// deliberately NOT accepted — they stay documented-only in the runbook. Anything
// off the allowlist is refused; nothing is queued. The allowlist is exact-match
// (trimmed, lowercased) — no prefixes, no free text — so a typo can't reach the
// bot with a longer/dangerous command word.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
// verify_jwt = true at the gateway PLUS an in-code SUPER_ADMIN check against
// profiles. Per the house rule a service_role bearer is NOT a session and is
// rejected. There is no cron/shared-secret path — this is a human-only console.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

// The ONLY commands this endpoint will execute. Read-only account queries only —
// see the safety note above. Keep this in sync with the UI allowlist
// (src/lib/jmpConsole.ts) and the runbook card.
const ALLOWED_COMMANDS = [
  "info",
  "cdrs",
  "transactions",
  "plan settings",
  "referral codes",
  "sims",
] as const;

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
  if (req.method !== "POST") return fail("method", "Method not allowed", 405);

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

  // ── Input: ONE command, exact-match against the read-only allowlist. ──
  const payload = (await req.json().catch(() => null)) as { command?: string } | null;
  if (!payload) return fail("bad_request", "Invalid JSON body", 400);

  const command = String(payload.command ?? "").trim().toLowerCase();
  if (!command) return fail("bad_request", "Missing command", 400);
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) {
    return fail(
      "not_allowed",
      `"${command}" is not a permitted command. Only read-only commands are executable: ${ALLOWED_COMMANDS.join(", ")}.`,
      400,
    );
  }

  // Queue it. The bridge's bot pump sends `body` verbatim to the account bot; for
  // these commands the body IS the command word.
  const { data: row, error: insErr } = await db
    .from("jmp_bot_messages")
    .insert({
      direction: "outbound",
      command,
      body: command,
      status: "queued",
      created_by: caller.id,
    })
    .select("id, command, status")
    .single();

  if (insErr) return fail("server", `Could not queue the command: ${insErr.message}`, 500);

  return json({ ok: true, id: row.id, command: row.command, status: row.status });
});
