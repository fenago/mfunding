// vendor-conversation-sweep — the single pane of glass for a lender/vendor
// relationship. Every GHL/VibeReach conversation message with that funder's or
// vendor's contacts (emails in/out, SMS, calls) is mirrored into the SAME
// activity_log the lender/vendor detail page's Activity Log tab already reads, so
// doc-uploads, notes, and the entire GHL back-and-forth read in one timeline.
//
// The GHL contact ids are already persisted app-side, so this never searches GHL
// by email to find them:
//   lender  → lenders.ghl_contact_id  ∪  each lenders.contacts[].ghl_contact_id
//   vendor  → marketing_vendors.ghl_contact_id
// For each linked contact it walks the contact's conversations → messages, and for
// every new email/SMS/call writes one activity_log row on the lender/vendor entity.
//
// Idempotent: the record-once ledger (ghl_conversation_log, PK = GHL message id) is
// CLAIMED before the activity row is written, so the 15-minute cron and an inline
// "Sync now" click can never double-log the same message. This mirrors
// ghl-call-history's ledger design exactly.
//
// Two modes, same syncEntity() core (mirrors ghl-call-history):
//   • cron sweep  — ?secret=<GHL webhook_secret> + anon bearer → every lender/vendor
//                   with ≥1 linked GHL contact.
//   • staff Sync now — a signed-in closer/admin/super_admin POSTs
//                   { entity_type, entity_id } → just that one, returns the count.
//
// verify_jwt=true at the gateway: the anon key (cron) and a real staff JWT both pass
// it; the in-code branch below decides which path ran. Read-only against GHL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, type GhlConfig } from "../_shared/ghl.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type EntityType = "lender" | "marketing_vendor";

interface SweepEntity {
  type: EntityType;
  id: string;
  name: string;
  contactIds: string[];
}

interface GhlMessage {
  id?: string;
  direction?: string;
  dateAdded?: string;
  messageType?: string;
  body?: string;
  subject?: string;
  meta?: {
    call?: { duration?: number | null; status?: string | null };
    // Email subject/body live on the EMAIL RECORD, not the conversation message —
    // meta.email.messageIds points at the record(s). Same path _shared/ghl.ts uses.
    email?: { messageIds?: string[] };
  };
}

// GHL's app deep-link to a conversation (VibeReach is a white-label of the same
// app; app.gohighlevel.com resolves the location for an authenticated agency user).
function ghlConversationUrl(locationId: string, conversationId: string): string {
  return `https://app.gohighlevel.com/v2/location/${locationId}/conversations/conversations/${conversationId}`;
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "0s";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

// Channel from GHL's messageType. Only email / sms / call are relationship signal;
// system/activity rows are skipped.
function channelOf(messageType: string | undefined): "email" | "sms" | "call" | null {
  const t = String(messageType ?? "");
  if (/email/i.test(t)) return "email";
  if (/sms/i.test(t)) return "sms";
  if (/call/i.test(t)) return "call";
  return null;
}

// First ~200 chars of readable body: drop style/script/head blocks and HTML
// comments (funder newsletters are full of them — otherwise the snippet is raw
// CSS), strip remaining tags, decode the common entities, collapse whitespace.
function snippetOf(raw: string | undefined): string {
  if (!raw) return "";
  const text = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Invisible preheader padding marketing emails inject (soft hyphen, zero-width
    // space/joiners, combining grapheme joiner, word joiner, BOM) — otherwise the
    // snippet reads as a run of blanks.
    .replace(/[­͏​‌‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

// activity_log interaction_type must be one of the allowed values (email/sms/call
// are all allowed; there is no 'system'). Channel maps 1:1 here.
function interactionType(channel: "email" | "sms" | "call"): string {
  return channel; // email | sms | call are all valid activity_log interaction_types
}

// An email's subject/body/authoritative direction live on the email RECORD, not the
// conversation message (the message carries neither — every email would otherwise
// read "inbound email / (no preview)"). Fetch the record for the real content.
// Direction from the record is authoritative too: the conversation message's
// direction lies about sibling-address replies (ghl-email-records-vs-messages).
async function fetchEmailDetail(
  cfg: GhlConfig,
  emailRecordId: string,
): Promise<{ subject: string; snippet: string; direction: string | null }> {
  const res = await ghlFetch<{ emailMessage?: Record<string, unknown> }>(
    cfg, "GET", `/conversations/messages/email/${emailRecordId}`,
  );
  const em = res.data?.emailMessage;
  if (!res.ok || !em) return { subject: "", snippet: "", direction: null };
  const subject = typeof em.subject === "string" ? em.subject.trim() : "";
  const bodyRaw = typeof em.body === "string" ? em.body
    : typeof em.text === "string" ? em.text : "";
  const dir = typeof em.direction === "string" ? em.direction.toLowerCase() : null;
  return { subject, snippet: snippetOf(bodyRaw), direction: dir };
}

/**
 * Mirror one entity's GHL conversation messages into its activity_log.
 * Record-once via ghl_conversation_log (PK = GHL message id): the ledger row is
 * CLAIMED first; only a freshly-claimed message writes an activity_log row. If the
 * activity insert fails the claim is released so a later sweep retries it.
 */
async function syncEntity(
  db: SupabaseClient,
  cfg: GhlConfig,
  entity: SweepEntity,
): Promise<{ synced: number; scanned: number; error: string | null }> {
  let synced = 0;
  let scanned = 0;
  let error: string | null = null;
  try {
    for (const contactId of entity.contactIds) {
      const convRes = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
        cfg, "GET",
        `/conversations/search?locationId=${cfg.locationId}&contactId=${encodeURIComponent(contactId)}&limit=20`,
      );
      if (!convRes.ok) continue; // one bad contact must not blank the rest
      const convIds = (convRes.data?.conversations ?? []).map((c) => c.id).filter(Boolean);

      for (const convId of convIds) {
        // limit=100 = the backfill depth. GHL returns the newest 100 messages per
        // conversation; older history than that is not pulled (noted honestly).
        const msgRes = await ghlFetch<{ messages?: { messages?: GhlMessage[] } }>(
          cfg, "GET", `/conversations/${convId}/messages?limit=100`,
        );
        if (!msgRes.ok) continue;
        for (const m of msgRes.data?.messages?.messages ?? []) {
          const channel = channelOf(m.messageType);
          if (!channel || !m.id || !m.dateAdded) continue;
          scanned++;
          let direction = m.direction === "outbound" ? "outbound" : "inbound";

          // Emails: pull the real subject/snippet/direction from the email record
          // (the conversation message carries none of them).
          let emailSubject = "";
          let emailSnippet = "";
          if (channel === "email") {
            const emailRecordId = m.meta?.email?.messageIds?.[0];
            if (emailRecordId) {
              const detail = await fetchEmailDetail(cfg, emailRecordId);
              emailSubject = detail.subject;
              emailSnippet = detail.snippet;
              if (detail.direction === "inbound" || detail.direction === "outbound") direction = detail.direction;
            }
          }

          // ── CLAIM the message in the ledger (dedupe absolutely) ──
          const { data: claim, error: claimErr } = await db.from("ghl_conversation_log")
            .upsert({
              ghl_message_id: m.id,
              entity_type: entity.type,
              entity_id: entity.id,
              ghl_contact_id: contactId,
              ghl_conversation_id: convId,
              direction,
              channel,
              message_at: m.dateAdded,
            }, { onConflict: "ghl_message_id", ignoreDuplicates: true })
            .select("ghl_message_id");
          if (claimErr) { error = `ledger claim: ${claimErr.message}`; continue; }
          if (!claim || claim.length === 0) continue; // already logged on a prior sweep

          // ── Build the timeline row ──
          const call = m.meta?.call ?? {};
          let subject: string;
          let snippet: string;
          if (channel === "call") {
            const outcome = String(call.status ?? "call");
            subject = `${direction} call · ${outcome}`;
            snippet = `${direction === "outbound" ? "Outbound" : "Inbound"} call — ${outcome}` +
              (call.duration != null ? `, ${fmtDuration(call.duration)}` : "");
          } else if (channel === "email") {
            const subj = emailSubject || m.subject?.trim() || "";
            subject = subj ? `${direction} · ${subj}` : `${direction} email`;
            snippet = emailSnippet || snippetOf(m.body) || (subj ? `Subject: ${subj}` : "(no preview)");
          } else {
            subject = `${direction} SMS`;
            snippet = snippetOf(m.body) || "(no preview)";
          }
          const link = `View in GHL: ${ghlConversationUrl(cfg.locationId, convId)}`;
          const content = `${snippet}\n\n${link}`;

          // ── Write the activity_log row at the message's REAL time ──
          const { data: act, error: actErr } = await db.from("activity_log")
            .insert({
              entity_type: entity.type,
              entity_id: entity.id,
              interaction_type: interactionType(channel),
              subject,
              content,
              created_at: m.dateAdded, // the message's real timestamp, not now()
            })
            .select("id")
            .single();
          if (actErr) {
            // Release the claim so a later sweep retries this message.
            await db.from("ghl_conversation_log").delete().eq("ghl_message_id", m.id);
            error = `activity_log insert: ${actErr.message}`;
            continue;
          }
          if (act?.id) {
            await db.from("ghl_conversation_log")
              .update({ activity_log_id: act.id }).eq("ghl_message_id", m.id);
          }
          synced++;
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { synced, scanned, error };
}

// Collect the deduped set of GHL contact ids stored on a lender row (primary +
// each person in the contacts jsonb).
function lenderContactIds(row: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const primary = row.ghl_contact_id;
  if (typeof primary === "string" && primary) ids.add(primary);
  const contacts = Array.isArray(row.contacts) ? row.contacts : [];
  for (const c of contacts as Array<Record<string, unknown>>) {
    const cid = c?.ghl_contact_id;
    if (typeof cid === "string" && cid) ids.add(cid);
  }
  return [...ids];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();
    const url = new URL(req.url);

    // ── CRON SWEEP: ?secret=<webhook_secret> (+ anon bearer at the gateway) ──
    const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    if (providedSecret) {
      const { data: gc } = await db.rpc("get_ghl_config");
      const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
      if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);

      const cfg = await getGhlConfig(db);
      const entities: SweepEntity[] = [];

      // 122 lenders — cheap to pull all and keep the ones with ≥1 linked GHL
      // contact in JS (a jsonb PostgREST filter for "contacts has a ghl id" is
      // fragile; the union of primary + contacts[].ghl_contact_id is computed here).
      const { data: lenders } = await db.from("lenders")
        .select("id, company_name, ghl_contact_id, contacts");
      for (const l of lenders ?? []) {
        const ids = lenderContactIds(l as Record<string, unknown>);
        if (ids.length) entities.push({ type: "lender", id: (l as { id: string }).id, name: (l as { company_name?: string }).company_name ?? "lender", contactIds: ids });
      }

      const { data: vendors } = await db.from("marketing_vendors")
        .select("id, vendor_name, ghl_contact_id")
        .not("ghl_contact_id", "is", null);
      for (const v of vendors ?? []) {
        const cid = (v as { ghl_contact_id?: string }).ghl_contact_id;
        if (cid) entities.push({ type: "marketing_vendor", id: (v as { id: string }).id, name: (v as { vendor_name?: string }).vendor_name ?? "vendor", contactIds: [cid] });
      }

      const summary = { swept: 0, synced: 0, scanned: 0, perEntity: [] as Array<{ type: string; name: string; synced: number }>, failed: [] as string[] };
      for (const e of entities) {
        summary.swept++;
        const r = await syncEntity(db, cfg, e);
        summary.synced += r.synced;
        summary.scanned += r.scanned;
        if (r.synced > 0) summary.perEntity.push({ type: e.type, name: e.name, synced: r.synced });
        if (r.error) summary.failed.push(`${e.type}:${e.name}: ${r.error}`);
      }
      return json({ ok: true, mode: "sweep", ...summary });
    }

    // ── STAFF "SYNC NOW": signed-in closer/admin/super_admin, one entity ──
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Staff only" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as { entity_type?: string; entity_id?: string };
    const entityType = body.entity_type === "lender" || body.entity_type === "marketing_vendor" ? body.entity_type : null;
    const entityId = String(body.entity_id ?? "").trim();
    if (!entityType || !entityId) return json({ error: "entity_type (lender|marketing_vendor) and entity_id are required" }, 400);

    const cfg = await getGhlConfig(db);
    let entity: SweepEntity | null = null;
    if (entityType === "lender") {
      const { data: l } = await db.from("lenders")
        .select("id, company_name, ghl_contact_id, contacts").eq("id", entityId).maybeSingle();
      if (l) entity = { type: "lender", id: entityId, name: (l as { company_name?: string }).company_name ?? "lender", contactIds: lenderContactIds(l as Record<string, unknown>) };
    } else {
      const { data: v } = await db.from("marketing_vendors")
        .select("id, vendor_name, ghl_contact_id").eq("id", entityId).maybeSingle();
      const cid = (v as { ghl_contact_id?: string } | null)?.ghl_contact_id;
      if (v) entity = { type: "marketing_vendor", id: entityId, name: (v as { vendor_name?: string }).vendor_name ?? "vendor", contactIds: cid ? [cid] : [] };
    }
    if (!entity) return json({ error: "entity not found" }, 404);
    if (entity.contactIds.length === 0) {
      return json({ ok: true, mode: "manual", synced: 0, scanned: 0, note: "no GHL contact linked to this record yet" });
    }

    const r = await syncEntity(db, cfg, entity);
    return json({ ok: true, mode: "manual", synced: r.synced, scanned: r.scanned, error: r.error });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
