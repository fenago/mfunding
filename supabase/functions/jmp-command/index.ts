// jmp-command — queue ONE read-only command to the JMP/Cheogram ACCOUNT BOT.
//
// This function does not talk to XMPP. It writes a single row into
// public.jmp_bot_messages with status 'queued'; the droplet bridge's bot pump
// polls queued rows and sends the body as a chat message to the bare JID
// `cheogram.com`. The bot's reply comes back through the bridge as an inbound
// jmp_bot_messages row. Everything here is the gate in front of that queue.
//
//   POST { command }                 ← the six-button allowlist path (UNCHANGED)
//        → { ok:true, id, command, status:'queued' }   (200)
//        | { ok:false, error, code }                    (4xx/5xx)
//
//   POST { text }                    ← the owner's FREE-FORM command box
//        → { ok:true, id, command:null, status:'queued' } (200)
//        | { ok:false, error, code }                       (4xx/5xx)
//
// ── TWO PATHS, ONE GATE ──────────────────────────────────────────────────────
// `command` (the six buttons) stays EXACTLY as it was: exact-match against the
// read-only allowlist below, so a stray button/typo can never reach the bot with
// a dangerous word. `text` is the owner's free-form box: any non-empty trimmed
// string (length-capped) is queued verbatim — because the account bot itself is
// the authority on what is/isn't a valid command, and the owner typing a command
// here is identical to typing it in the Cheogram app. BOTH paths are still gated
// by the same super_admin session check; nothing changes about who may call this.
// If both keys are present, `command` (the safer allowlisted path) wins.
//
// ── SAFETY NOTE ON THE FREE-FORM PATH ────────────────────────────────────────
// The free-form box CAN reach billing / account-changing commands (top up,
// subaccount, …) — that is the point, the owner asked for it. The UI carries the
// caution; there is no server-side allowlist on `text` by design. It is still a
// human-only, super_admin-only console: no cron/shared-secret path exists.
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

// A sane upper bound on a free-form command so a paste accident can't queue a
// megabyte into the bridge. Real bot commands are short; this is generous.
const MAX_TEXT_LEN = 1000;

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

  // ── Input: EITHER an allowlisted `command` (buttons) OR free-form `text`. ──
  const payload = (await req.json().catch(() => null)) as
    | { command?: string; text?: string }
    | null;
  if (!payload) return fail("bad_request", "Invalid JSON body", 400);

  // What actually gets queued: `command` (the allowlisted word) is stamped only on
  // the button path; the free-form path leaves it null and carries the text in body.
  let command: string | null = null;
  let body: string;

  const hasCommand = payload.command !== undefined && payload.command !== null;
  if (hasCommand) {
    // ── PATH 1 (unchanged): ONE command, exact-match against the read-only allowlist.
    const cmd = String(payload.command ?? "").trim().toLowerCase();
    if (!cmd) return fail("bad_request", "Missing command", 400);
    if (!(ALLOWED_COMMANDS as readonly string[]).includes(cmd)) {
      return fail(
        "not_allowed",
        `"${cmd}" is not a permitted command. Only read-only commands are executable: ${ALLOWED_COMMANDS.join(", ")}.`,
        400,
      );
    }
    command = cmd;
    body = cmd; // for these commands the body IS the command word
  } else {
    // ── PATH 2 (new): free-form text — any non-empty trimmed string, length-capped.
    const text = String(payload.text ?? "").trim();
    if (!text) return fail("bad_request", "Missing command text", 400);
    if (text.length > MAX_TEXT_LEN) {
      return fail("too_long", `Command is too long (max ${MAX_TEXT_LEN} characters).`, 400);
    }
    command = null; // no allowlisted word — the body carries the exact text
    body = text;
  }

  // Queue it. The bridge's bot pump sends `body` verbatim to the account bot.
  const { data: row, error: insErr } = await db
    .from("jmp_bot_messages")
    .insert({
      direction: "outbound",
      command,
      body,
      status: "queued",
      created_by: caller.id,
    })
    .select("id, command, status")
    .single();

  if (insErr) return fail("server", `Could not queue the command: ${insErr.message}`, 500);

  return json({ ok: true, id: row.id, command: row.command, status: row.status });
});
