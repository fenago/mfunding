// get-funder-email — fetch ONE email's full contents from GHL for display on the
// Revenue Playbook Step 7 board. The board logs funder replies (and our own
// funder/merchant sends) with a machine marker pointing at the GHL email record
// ([emsg:<email-record-id>]) or the conversation message ([msg:<message-id>]);
// the client can't hit GHL directly (the key is server-side), so it calls this to
// pull the subject + full body when the closer clicks "view email".
//
// POST body: { messageId? , emailMessageId? , conversationMessageId? }
//   - emailMessageId / messageId → an email-record id, fetched directly via
//     /conversations/messages/email/{id}
//   - conversationMessageId → a conversation-message id; we resolve its linked
//     email record (meta.email.messageIds) first, then fetch that.
//
// Auth mirrors send-merchant-email: signed-in staff only (verify_jwt = true plus
// an in-code role check). Read-only — never sends or mutates anything.
//
// Returns the email sanitized: script/style/dangerous tags stripped so the client
// can render the HTML inside a sandboxed (sandbox="") iframe, plus a plain-text
// fallback. Compliance: transport/read only — adds no product claims of its own.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Strip only what's unsafe/noisy but KEEP basic formatting so the funder's email
// still reads like an email inside the sandboxed iframe. Removes script/style/head
// machinery, framing/embedding tags, event-handler attributes, and javascript:
// URLs. The iframe itself (sandbox="") is the real containment — this is defense
// in depth so nothing dangerous is even present in the markup.
function sanitizeHtml(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|title|head|base|meta|link|object|embed|iframe|frame|frameset|applet)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|base|meta|link|object|embed|iframe|frame|frameset|applet)[^>]*\/?>/gi, " ")
    // Drop inline event handlers (on*="…" / on*='…' / on*=bare).
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    // Neutralize javascript: URLs in href/src.
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'")
    .trim();
}

// Plain-text fallback (mirrors poll-funder-replies' cleanEmailBody): strip all
// tags/entities and drop the quoted original so the fallback carries the reply.
function toPlainText(raw: string): string {
  let text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { messageId?: string; emailMessageId?: string; conversationMessageId?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  // Accept either an email-record id (preferred) or a conversation-message id.
  const emailId = (payload.emailMessageId ?? payload.messageId ?? "").toString().trim();
  const convMsgId = (payload.conversationMessageId ?? "").toString().trim();
  if (!emailId && !convMsgId) return json({ error: "messageId is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: returns a funder's email body → signed-in staff only. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }

  let cfg: Awaited<ReturnType<typeof getGhlConfig>>;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // Resolve the email-record id: given one directly, or expand a conversation
  // message to its linked email record (meta.email.messageIds — last is newest).
  let emailRecordId = emailId;
  if (!emailRecordId && convMsgId) {
    const mRes = await ghlFetch<{ message?: Record<string, unknown> } & Record<string, unknown>>(
      cfg, "GET", `/conversations/messages/${convMsgId}`,
    );
    if (!mRes.ok) return json({ error: `Could not load message: ${mRes.error ?? mRes.status}` }, 502);
    const m = (mRes.data?.message ?? mRes.data ?? {}) as Record<string, unknown>;
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    if (!ids.length) return json({ error: "This message has no email body to show." }, 404);
    emailRecordId = String(ids[ids.length - 1]);
  }

  const eRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
    cfg, "GET", `/conversations/messages/email/${emailRecordId}`,
  );
  if (!eRes.ok) return json({ error: `Could not load email: ${eRes.error ?? eRes.status}` }, 502);
  const e = (eRes.data?.emailMessage ?? eRes.data ?? {}) as Record<string, unknown>;

  const rawBody = String(e.body ?? "");
  const toField = Array.isArray(e.to)
    ? (e.to as unknown[]).map((x) => String(x)).join(", ")
    : String(e.to ?? "");

  return json({
    ok: true,
    subject: String(e.subject ?? "").trim(),
    from: String(e.from ?? "").trim(),
    to: toField.trim(),
    date: String(e.dateAdded ?? e.date ?? "").trim(),
    direction: String(e.direction ?? "").trim(),
    html: sanitizeHtml(rawBody),
    text: toPlainText(rawBody),
  });
});
