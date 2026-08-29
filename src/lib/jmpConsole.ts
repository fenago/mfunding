// JMP command console — client helpers for the super-admin panel on the Text
// Message Administration page.
//
// This talks to the JMP/Cheogram ACCOUNT BOT (bare JID cheogram.com) through the
// `jmp-command` edge function (which queues a jmp_bot_messages row) and the
// droplet bridge (which relays it and mirrors the reply). It is entirely separate
// from merchant SMS (sms_messages) — do not conflate the two.
//
// ⚠️ READ-ONLY. Only the six account-query commands below are executable. Billing
// and account-changing commands stay documented-only in the runbook card and are
// NOT exposed here. This list must stay in sync with the edge function's
// ALLOWED_COMMANDS (supabase/functions/jmp-command/index.ts).

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
    // Surface the edge function's own JSON error body when present — invoke wraps
    // a non-2xx as a FunctionsHttpError whose context is the Response.
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const body = (await ctx.json()) as { error?: string };
        if (body?.error) detail = body.error;
      }
    } catch {
      // keep the generic message
    }
    return { ok: false, error: detail };
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string; id?: string };
  if (!d.ok) return { ok: false, error: d.error ?? "The command was refused." };
  return { ok: true, id: d.id };
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
