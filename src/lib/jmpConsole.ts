// JMP command console — client helpers for the super-admin panel on the Text
// Message Administration page.
//
// This talks to the JMP/Cheogram ACCOUNT BOT (bare JID cheogram.com) through the
// `jmp-command` edge function (which queues a jmp_bot_messages row) and the
// droplet bridge (which relays it and mirrors the reply). It is entirely separate
// from merchant SMS (sms_messages) — do not conflate the two.
//
// TWO WAYS TO REACH THE BOT:
//   · runJmpCommand — the six read-only account queries below (buttons). Kept
//     allowlisted client- and server-side; this list must stay in sync with the
//     edge function's ALLOWED_COMMANDS (supabase/functions/jmp-command/index.ts).
//   · runJmpText — the owner's FREE-FORM box. NOT allowlisted (any string), so it
//     can reach billing/account-changing commands too — same as typing in the
//     Cheogram app. Both paths are super-admin-only at the edge fn.
//
// Also here: getJmpAccountKey / saveJmpAccountKey — the vault-backed JMP account
// password (jmp-account-key edge fn), never stored in the repo.

import type { SupabaseClient } from "@supabase/supabase-js";

export type JmpBotDirection = "outbound" | "inbound";
export type JmpBotStatus = "queued" | "sent" | "failed" | "received";

export interface JmpBotMessage {
  id: string;
  direction: JmpBotDirection;
  body: string | null;
  command: string | null;
  status: JmpBotStatus;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

export const JMP_BOT_SELECT =
  "id,direction,body,command,status,created_by,created_at,sent_at";

/** The ONLY commands the console will run — read-only account queries. Mirrors
 *  the edge function allowlist exactly. */
export const READ_ONLY_COMMANDS: { cmd: string; label: string; desc: string }[] = [
  { cmd: "info", label: "Account info", desc: "Balance, number, plan summary" },
  { cmd: "cdrs", label: "Call logs", desc: "Recent call detail records" },
  { cmd: "transactions", label: "Transactions", desc: "Recent account transactions" },
  { cmd: "plan settings", label: "Plan settings", desc: "Current plan / overage settings" },
  { cmd: "referral codes", label: "Referral codes", desc: "Your referral codes" },
  { cmd: "sims", label: "SIM details", desc: "(e)SIM details on the account" },
];

const ALLOWED = new Set(READ_ONLY_COMMANDS.map((c) => c.cmd));

export interface RunResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Pull the edge function's own JSON `error` out of a failed invoke — supabase-js
 *  wraps a non-2xx as a FunctionsHttpError whose `context` is the Response. */
async function invokeErrorDetail(error: { message: string; context?: Response }): Promise<string> {
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    }
  } catch {
    // fall through to the generic message
  }
  return error.message;
}

/** Queue one read-only command to the bot via the jmp-command edge function.
 *  Refuses client-side too if the command is off the allowlist — the edge fn is
 *  the real gate, this is just a guard against a coding slip. */
export async function runJmpCommand(
  supabase: SupabaseClient,
  command: string,
): Promise<RunResult> {
  const cmd = command.trim().toLowerCase();
  if (!ALLOWED.has(cmd)) {
    return { ok: false, error: `"${command}" is not an allowed read-only command.` };
  }
  const { data, error } = await supabase.functions.invoke("jmp-command", {
    body: { command: cmd },
  });
  if (error) {
    return { ok: false, error: await invokeErrorDetail(error as { message: string; context?: Response }) };
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string; id?: string };
  if (!d.ok) return { ok: false, error: d.error ?? "The command was refused." };
  return { ok: true, id: d.id };
}

/** Queue a FREE-FORM command to the bot via the jmp-command edge function's `text`
 *  path. Unlike runJmpCommand this is NOT allowlisted — the owner types an
 *  arbitrary command, exactly as if typing it in the Cheogram app. Still
 *  super-admin gated by the edge fn. */
export async function runJmpText(
  supabase: SupabaseClient,
  text: string,
): Promise<RunResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "Type a command to send." };
  const { data, error } = await supabase.functions.invoke("jmp-command", {
    body: { text: body },
  });
  if (error) {
    return { ok: false, error: await invokeErrorDetail(error as { message: string; context?: Response }) };
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string; id?: string };
  if (!d.ok) return { ok: false, error: d.error ?? "The command was refused." };
  return { ok: true, id: d.id };
}

// ── JMP account key (vault-backed secret; super-admin only) ───────────────────

export interface KeyReadResult {
  ok: boolean;
  value?: string;
  hasValue?: boolean;
  error?: string;
}

export interface KeyWriteResult {
  ok: boolean;
  error?: string;
}

/** Reveal the JMP account key — GET the decrypted value from the vault via the
 *  jmp-account-key edge function. Returns the plaintext (super-admin only). */
export async function getJmpAccountKey(supabase: SupabaseClient): Promise<KeyReadResult> {
  const { data, error } = await supabase.functions.invoke("jmp-account-key", {
    method: "GET",
  });
  if (error) {
    return { ok: false, error: await invokeErrorDetail(error as { message: string; context?: Response }) };
  }
  const d = (data ?? {}) as { ok?: boolean; value?: string; hasValue?: boolean; error?: string };
  if (!d.ok) return { ok: false, error: d.error ?? "Couldn't read the account key." };
  return { ok: true, value: d.value ?? "", hasValue: !!d.hasValue };
}

/** Save the JMP account key — POST the value to the vault via the jmp-account-key
 *  edge function. The value is stored encrypted at rest; never in the repo. */
export async function saveJmpAccountKey(
  supabase: SupabaseClient,
  value: string,
): Promise<KeyWriteResult> {
  if (!value.trim()) return { ok: false, error: "Enter a value to save." };
  const { data, error } = await supabase.functions.invoke("jmp-account-key", {
    body: { value },
  });
  if (error) {
    return { ok: false, error: await invokeErrorDetail(error as { message: string; context?: Response }) };
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string };
  if (!d.ok) return { ok: false, error: d.error ?? "Couldn't save the account key." };
  return { ok: true };
}

/** Load recent bot-channel messages, returned OLDEST → NEWEST so the panel reads
 *  like a transcript (newest at the bottom). */
export async function loadJmpBotMessages(
  supabase: SupabaseClient,
  limit = 40,
): Promise<{ rows: JmpBotMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from("jmp_bot_messages")
    .select(JMP_BOT_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  const rows = ((data ?? []) as JmpBotMessage[]).slice().reverse();
  return { rows, error: null };
}
