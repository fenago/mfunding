// ghl-comms — thin client over GoHighLevel for the admin "Comms" page.
//
// GHL/VibeReach is the system of record for contacts and email. This function
// only proxies a few read/send calls; it does NOT store mail. Credentials come
// from the Supabase vault (never the client) via getGhlConfig().
//
// Auth: caller's Supabase JWT is verified and their profiles.role must be one of
// closer | admin | super_admin (same gate admin-users uses, widened to closers).
//
// POST { action, ... }:
//   searchContacts { query?, pageLimit?, startAfter? } → { contacts, total, nextCursor }
//   getThread      { contactId }                       → { conversationId, messages }
//   sendEmail      { contactId, subject, html, text? } → { messageId, conversationId }
//
// The email FROM address is FIXED server-side to the shared company mailbox —
// the client can never choose the sender.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig,
  searchContacts, getContactThread, sendEmailToContact,
} from "../_shared/ghl.ts";

// Company sending address (dedicated verified domain send.mfunding.net).
const COMPANY_EMAIL_FROM = "sales@send.mfunding.net";

const ALLOWED_ROLES = ["closer", "admin", "super_admin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // --- Authn/Authz: caller must be signed in with an operational role ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await db.from("profiles").select("role").eq("id", caller.id).single();
  if (!callerProfile || !ALLOWED_ROLES.includes(callerProfile.role)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");

  try {
    const cfg = await getGhlConfig(db);

    switch (action) {
      case "searchContacts": {
        const query = body.query ? String(body.query) : undefined;
        const pageLimit = body.pageLimit ? Number(body.pageLimit) : 20;
        const startAfter = Array.isArray(body.startAfter) ? (body.startAfter as unknown[]) : undefined;
        const r = await searchContacts(cfg, { query, pageLimit, startAfter });
        if (!r.ok) return json({ error: r.error || "search failed" }, r.status || 500);
        const contacts = r.data?.contacts ?? [];
        const last = contacts[contacts.length - 1] as { searchAfter?: unknown[] } | undefined;
        return json({
          contacts,
          total: r.data?.total ?? contacts.length,
          nextCursor: contacts.length >= pageLimit ? (last?.searchAfter ?? null) : null,
        });
      }

      case "getThread": {
        const contactId = body.contactId ? String(body.contactId) : "";
        if (!contactId) return json({ error: "contactId required" }, 400);
        const r = await getContactThread(cfg, contactId);
        if (!r.ok && r.error) return json({ error: r.error }, r.status || 500);
        return json({ conversationId: r.conversationId, messages: r.messages });
      }

      case "sendEmail": {
        const contactId = body.contactId ? String(body.contactId) : "";
        const subject = body.subject ? String(body.subject) : "";
        const html = body.html ? String(body.html) : "";
        const text = body.text ? String(body.text) : undefined;
        if (!contactId) return json({ error: "contactId required" }, 400);
        if (!subject) return json({ error: "subject required" }, 400);
        if (!html) return json({ error: "body required" }, 400);
        // FROM is fixed server-side — never read from the client.
        const r = await sendEmailToContact(cfg, contactId, subject, html, {
          emailFrom: COMPANY_EMAIL_FROM,
          text,
        });
        if (!r.ok) return json({ error: r.error || "send failed" }, r.status || 500);
        return json({
          messageId: r.data?.messageId ?? null,
          conversationId: r.data?.conversationId ?? null,
        });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "operation failed" }, 500);
  }
});
