// poll-funder-replies — pull-based funder reply detection.
//
// WHY THIS EXISTS: reply detection was built push-first (ghl-webhook handles
// InboundMessage events), but wiring that push requires creating a GHL workflow
// in their browser-only builder. This poller needs NO GHL-side config: on a
// schedule (GitHub Action, every 10 min) it checks each funder's GHL
// conversation for inbound email newer than our submission and, if found,
// stamps deal_submissions.response_at + emails the owner — the exact same
// semantics as the webhook path. Stamp-only-when-NULL makes the two paths
// safely idempotent with each other (first one wins; no duplicate alerts).
//
// Auth: scheduled callers can't carry a user JWT → verify_jwt=false and a
// shared-secret check (same secret as ghl-webhook, from the vault).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, upsertContact, sendEmailToContact,
} from "../_shared/ghl.ts";
import { callLLM } from "../_shared/llm.ts";
import { resolveReplyTarget, type SubCandidate } from "../_shared/funder-reply-match.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "socrates73@gmail.com";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ReplyClassification {
  type: "stip_request" | "decline" | "offer" | "question" | "acknowledgment" | "other";
  decline_reason_category:
    | null | "low_revenue" | "industry" | "time_in_business" | "credit"
    | "existing_positions" | "missing_docs" | "state" | "other";
  requested_items: string[];
  offer_terms: null | { amount?: unknown; factor?: unknown; term?: unknown };
  summary: string;
}

// Ask Claude to structure a funder's reply so the closer sees what's needed
// without opening GHL. Best-effort ONLY — every caller wraps this so a classify
// failure can never block the stamp/alert. Returns null on any problem.
async function classifyReply(db: SupabaseClient, replyText: string): Promise<ReplyClassification | null> {
  if (!replyText.trim()) return null;

  const system =
    "You classify a single email reply that an MCA/business-funding FUNDER sent back to an " +
    "ISO (broker) about a submitted merchant file. An MCA is a purchase of future receivables, " +
    "NOT a loan — never use lending terms. Read the reply and return ONLY a strict JSON object, " +
    "no prose or markdown, of the EXACT shape:\n" +
    '{"type":"stip_request"|"decline"|"offer"|"question"|"acknowledgment"|"other",' +
    '"decline_reason_category":null|"low_revenue"|"industry"|"time_in_business"|"credit"|"existing_positions"|"missing_docs"|"state"|"other",' +
    '"requested_items":string[],"offer_terms":null|{"amount":number|null,"factor":number|null,"term":string|null},' +
    '"summary":"<one sentence>"}\n' +
    "Rules: decline_reason_category is non-null ONLY when type is \"decline\" (else null). " +
    "requested_items lists the concrete documents/items the funder is asking for when type is " +
    "\"stip_request\" (else []). offer_terms is non-null ONLY when type is \"offer\" and terms are stated. " +
    "summary is one plain sentence a closer can scan.";

  try {
    // Provider-agnostic: routes through llm_settings (admin-switchable), with
    // a per-task override slot "classify_reply".
    let text = (await callLLM(db, {
      system,
      prompt: `Funder reply:\n"""\n${replyText}\n"""\n\nReturn the JSON now.`,
      maxTokens: 1024,
      temperature: 0,
      jsonMode: true,
      task: "classify_reply",
    })).trim();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); } catch {
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { /* give up */ } }
    }
    if (!parsed || typeof parsed !== "object") return null;

    const TYPES = ["stip_request", "decline", "offer", "question", "acknowledgment", "other"];
    const DECLINES = ["low_revenue", "industry", "time_in_business", "credit", "existing_positions", "missing_docs", "state", "other"];
    const type = (TYPES.includes(parsed.type as string) ? parsed.type : "other") as ReplyClassification["type"];
    const declineCat = type === "decline" && DECLINES.includes(parsed.decline_reason_category as string)
      ? (parsed.decline_reason_category as ReplyClassification["decline_reason_category"]) : null;
    const items = Array.isArray(parsed.requested_items)
      ? (parsed.requested_items as unknown[]).filter((x) => typeof x === "string").slice(0, 10) as string[] : [];
    const offer = type === "offer" && parsed.offer_terms && typeof parsed.offer_terms === "object"
      ? (parsed.offer_terms as ReplyClassification["offer_terms"]) : null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : "";
    return { type, decline_reason_category: declineCat, requested_items: items, offer_terms: offer, summary };
  } catch {
    return null;
  }
}

// ── Merchant reply detection ────────────────────────────────────────────────
// Deals we never chase for a merchant reply (mirrors the My Day queue's closed set).
const MERCHANT_CLOSED_STATUSES = [
  "funded", "nurture", "declined", "dead",
  "renewal_eligible", "restructure_executed", "servicing",
];

// Strip HTML/entities, collapse whitespace, and drop the quoted original so the
// snippet carries only what the merchant actually wrote.
function cleanEmailBody(raw: string): string {
  // Drop <style>/<script> blocks first so their CSS/JS text doesn't leak into
  // the snippet (e.g. ".ProseMirror > p.custom-newline { … }" from HTML editors).
  let text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
  const quoteIdx = text.search(/\bOn\s.{4,80}\swrote:/);
  if (quoteIdx > 0) text = text.slice(0, quoteIdx).trim();
  return text;
}

// Ask Claude for a one-line, closer-scannable summary of a merchant email,
// explicitly flagging attached/promised documents. Best-effort ONLY — a failure
// returns null and never blocks the stamp/alert. Uses a plain summarization task
// (the funder "classify_reply" prompt is funder-flavored and wrong here).
async function summarizeMerchantReply(db: SupabaseClient, replyText: string): Promise<string | null> {
  if (!replyText.trim()) return null;
  const system =
    "You summarize a single email a small-business MERCHANT sent to their business-funding " +
    "broker. A merchant cash advance is a purchase of future receivables, NOT a loan — never " +
    "use lending terms. Reply with ONE plain sentence a closer can scan, and explicitly note " +
    "whether the merchant attached or promised any documents (e.g. bank statements, ID, voided " +
    "check). No preamble, no markdown, no quotes around it.";
  try {
    const text = (await callLLM(db, {
      system,
      prompt: `Merchant email:\n"""\n${replyText}\n"""\n\nOne-sentence summary:`,
      maxTokens: 256,
      temperature: 0,
      task: "summarize_merchant_reply",
    })).trim();
    return text ? text.slice(0, 300) : null;
  } catch {
    return null;
  }
}

// Newest inbound merchant reply in a contact's GHL conversations that is strictly
// newer than `afterIso`. Same resolution as the funder path: the message-level
// body is the quoted original, so the real text lives in the linked email record
// (meta.email.messageIds). from-guard rejects our own senders. Returns the reply
// text, from-address, and the MESSAGE's own timestamp (used to stamp forward-only).
async function findMerchantReply(
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
  contactId: string,
  afterIso: string,
): Promise<{ text: string; from: string; at: string; attachments: string[]; eid: string } | null> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET",
    `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  let best: { text: string; from: string; at: string; attachments: string[]; eid: string } | null = null;
  for (const c of conv.data?.conversations ?? []) {
    const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
      cfg, "GET", `/conversations/${c.id}/messages?limit=15`,
    );
    const list = msgs.data?.messages?.messages ?? [];
    const afterMs = Date.parse(afterIso);
    // Do NOT gate on the message-level direction: a TYPE_EMAIL message bundles a
    // whole thread of email records and its top-level direction can be null/outbound
    // while a nested record is the merchant's inbound reply. We judge inbound-ness by
    // the RECORD's own direction below, exactly like the funder path.
    const candidates = list.filter((m) =>
      /email/i.test(String(m.messageType ?? "")) &&
      Date.parse(String(m.dateAdded ?? "")) > afterMs,
    );
    for (const m of candidates) {
      const at = String(m.dateAdded ?? "");
      if (best && Date.parse(at) <= Date.parse(best.at)) continue; // already hold a newer one
      const meta = m.meta as { email?: { messageIds?: string[] } } | undefined;
      const ids = meta?.email?.messageIds ?? [];
      for (const eid of ids) {
        const emailRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
          cfg, "GET", `/conversations/messages/email/${eid}`,
        );
        const e = (emailRes.data?.emailMessage ?? emailRes.data ?? {}) as Record<string, unknown>;
        if (String(e.direction ?? "") !== "inbound") continue;
        const from = String(e.from ?? "").toLowerCase();
        // Self-loop guard: our own sender bounced back is not a merchant reply.
        if (from.includes("send.mfunding.net") || from.includes("socrates73@gmail.com")) continue;
        let text = cleanEmailBody(String(e.body ?? ""));
        if (!text) text = "(reply received — open the conversation to read it)";
        const attachments = Array.isArray(e.attachments)
          ? (e.attachments as unknown[]).filter((u) => typeof u === "string") as string[] : [];
        best = { text, from: String(e.from ?? ""), at, attachments, eid: String(eid) };
        break;
      }
    }
  }
  return best;
}

// Capture OUR OUTBOUND emails to a funder (replies typed directly in GHL
// Conversations, bypassing the app) into the deal's Step-7 thread as funder:email
// so they show up next to the funder's reply. Deduped by the GHL email id
// [emsg:<id>], so anything already logged by submit-to-funders (or a prior run)
// never double-posts. The [re: <funder>] prefix pins it to the funder's card.
async function captureOutboundFunderEmails(
  db: SupabaseClient,
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
  lenderName: string,
  subCands: SubCandidate[],
  list: Array<Record<string, unknown>>,
): Promise<number> {
  let logged = 0;
  const outbound = list
    .filter((m) =>
      String(m.direction ?? "") === "outbound" &&
      /email/i.test(String(m.messageType ?? "")))
    .slice(0, 12);
  for (const m of outbound) {
    const meta = m.meta as { email?: { messageIds?: string[] } } | undefined;
    for (const eid of meta?.email?.messageIds ?? []) {
      const emailRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
        cfg, "GET", `/conversations/messages/email/${eid}`,
      );
      const e = (emailRes.data?.emailMessage ?? emailRes.data ?? {}) as Record<string, unknown>;
      if (String(e.direction ?? "") !== "outbound") continue;
      const subject = String(e.subject ?? "").trim();
      let text = cleanEmailBody(String(e.body ?? ""));
      const quoteIdx = text.search(/\bOn\s.{4,80}\swrote:/);
      if (quoteIdx > 0) text = text.slice(0, quoteIdx).trim();
      // Skip our own submission / re-send emails — those are already on the board
      // as funder:sent. Only genuine replies (typed in Conversations) belong here.
      if (/new submission from|merchant information sheet|referral guidelines|submitted the package/i.test(text)) continue;
      // Resolve WHICH deal this outbound reply is about — a funder thread mixes
      // several merchants, so never force it onto the newest. Skip if unresolved.
      const res = resolveReplyTarget({ subject, body: text, subs: subCands, lenderName, emailDate: String(e.dateAdded ?? e.date ?? "") || null });
      if (res.kind !== "match") continue;
      const dealId = res.sub.dealId;
      // Already in that deal's thread (logged by submit-to-funders or a prior run)?
      const { data: dup } = await db.from("activity_log")
        .select("id").eq("entity_type", "deal").eq("entity_id", dealId)
        .like("content", `%[emsg:${eid}]%`).limit(1);
      if (dup?.length) continue;
      const atts = Array.isArray(e.attachments)
        ? (e.attachments as unknown[]).filter((u) => typeof u === "string").length : 0;
      const attNote = atts ? ` (${atts} attachment${atts > 1 ? "s" : ""})` : "";
      const snippet = (text || "(sent from GHL Conversations)").slice(0, 220);
      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: dealId, interaction_type: "email",
        subject: `funder:email — ${subject || lenderName}`,
        content: `[re: ${lenderName}] ${snippet}${attNote} [emsg:${eid}]`,
      });
      logged++;
    }
  }
  return logged;
}

// ── PARK / RE-HOME HELPERS (identity-verified reply routing) ─────────────────
// Email-record ids we've already parked (unmatched or generic), so re-polls skip
// them instead of re-parking. Covers both buckets.
async function loadParkedFunderEids(db: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  const { data } = await db.from("ghl_webhook_events")
    .select("detail")
    .in("event_type", ["FunderReplyUnmatched", "FunderReplyGeneral"])
    .order("created_at", { ascending: false })
    .limit(500);
  for (const r of data ?? []) {
    for (const mm of String((r as { detail?: string }).detail ?? "").matchAll(/\[emsg:([^\]]+)\]/g)) out.add(mm[1]);
  }
  return out;
}

// Park an inbound funder email that could NOT be tied to a specific open deal, so
// it surfaces on /admin/sync-log (never silently attached, never silently dropped).
async function parkFunderEmail(db: SupabaseClient, opts: {
  eventType: "FunderReplyUnmatched" | "FunderReplyGeneral";
  lenderName: string; from: string; subject: string; snippet: string; eid: string; reason: string;
}): Promise<void> {
  const detail = `${opts.lenderName}: reply from ${opts.from} — ${opts.reason}. ` +
    `Subject: "${(opts.subject || "(none)").slice(0, 120)}" · "${opts.snippet.slice(0, 160)}" [emsg:${opts.eid}]`;
  await db.from("ghl_webhook_events").insert({
    event_type: opts.eventType,
    outcome: opts.eventType === "FunderReplyGeneral" ? "ignored" : "error",
    detail,
    payload: { source: "poll-funder-replies", lender: opts.lenderName, from: opts.from, subject: opts.subject, eid: opts.eid, reason: opts.reason },
  });
}

// Phase 2 (runs every scheduled invocation, independent of the funder phase):
// scan recently-active deals whose merchant has a GHL contact and alert on inbound
// email newer than what we've already stamped. Idempotent — a run with no NEW
// inbound stamps nothing (baseline == merchant_reply_at ⇒ zero candidates).
async function runMerchantPhase(
  db: SupabaseClient,
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
): Promise<{ merchantReplies: number; merchantDetails: string[] }> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db.from("deals")
    .select("id, deal_number, customer_id, merchant_reply_at, created_at, customer:customers!customer_id ( ghl_contact_id, email, business_name, first_name, last_name )")
    .not("status", "in", `(${MERCHANT_CLOSED_STATUSES.join(",")})`)
    .gt("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(40);

  // Only deals whose merchant actually has a GHL contact; cap the batch at ~20.
  const deals = (rows ?? [])
    .filter((d) => (d.customer as { ghl_contact_id?: string } | null)?.ghl_contact_id)
    .slice(0, 20);

  let merchantReplies = 0;
  const merchantDetails: string[] = [];

  for (const deal of deals) {
    const cust = deal.customer as unknown as
      { ghl_contact_id: string; email?: string; business_name?: string; first_name?: string; last_name?: string } | null;
    if (!cust?.ghl_contact_id) continue;

    // Baseline: only ever look for inbound newer than what we've already seen
    // (or, on the first pass, newer than the deal's creation).
    const afterIso = (deal.merchant_reply_at as string | null) ?? (deal.created_at as string);
    let reply: { text: string; from: string; at: string; attachments: string[]; eid: string } | null = null;
    try {
      reply = await findMerchantReply(cfg, cust.ghl_contact_id, afterIso);
    } catch { /* transient GHL error — try again next run */ }
    if (!reply) continue;
    if (Date.parse(reply.at) <= Date.parse(afterIso)) continue; // format-proof forward-only guard

    const businessName = cust.business_name
      || [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim()
      || "the merchant";
    const dealNumber = (deal.deal_number as string) ?? String(deal.id);
    const snippet = reply.text.slice(0, 300);

    // Summarize (best-effort — must NOT block the stamp/alert below).
    let summary: string | null = null;
    try { summary = await summarizeMerchantReply(db, reply.text); } catch { /* best-effort */ }

    // Stamp forward-only. The .or guard makes concurrent runs race-safe; the
    // baseline filter already guarantees reply.at > merchant_reply_at.
    // Forward-only is already guaranteed by the baseline (candidates must be
    // newer than merchant_reply_at), so a plain keyed update is race-safe here:
    // the worst concurrent case is two runs writing the same value.
    const { data: stamped, error: stampErr } = await db.from("deals")
      .update({ merchant_reply_at: reply.at, merchant_reply_summary: summary })
      .eq("id", deal.id)
      .select("id");
    if (stampErr || !stamped?.length) continue;

    merchantReplies++;

    // Auto-file email attachments onto the merchant's document record so they
    // are immediately attachable to funder messages / submissions. Best-effort;
    // dedupe by the source URL we record in the description.
    let filedNames: string[] = [];
    try {
      const custId = (deal as unknown as { customer_id?: string }).customer_id;
      if (custId) {
        for (const u of reply.attachments.slice(0, 8)) {
          const marker = `src:${u.slice(-60)}`;
          const { data: dupe } = await db.from("customer_documents")
            .select("id").eq("customer_id", custId).like("description", `%${marker}%`).limit(1);
          if (dupe?.length) continue;
          const resp = await fetch(u);
          if (!resp.ok) continue;
          const buf = new Uint8Array(await resp.arrayBuffer());
          if (!buf.length || buf.length > 25_000_000) continue;
          const rawName = decodeURIComponent(u.split("/").pop() ?? "attachment").split("?")[0];
          const ext = (rawName.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "pdf").toLowerCase();
          const mime = resp.headers.get("content-type") ?? (ext === "pdf" ? "application/pdf" : "application/octet-stream");
          const niceName = `Merchant email ${new Date(reply.at).toISOString().slice(0, 10)} — ${rawName}`.slice(0, 120);
          const path = `customer/${custId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await db.storage.from("customer-documents")
            .upload(path, buf, { contentType: mime });
          if (upErr) continue;
          const docType = /statement|bank/i.test(rawName) ? "bank_statement"
            : /check/i.test(rawName) ? "voided_check"
            : /license|id\b|dl\b/i.test(rawName) ? "id" : "other";
          await db.from("customer_documents").insert({
            customer_id: custId, document_type: docType, filename: niceName,
            storage_path: path, file_size: buf.length, mime_type: mime, status: "approved",
            description: `Auto-filed from the merchant's email reply (${reply.at}). ${marker}`,
          });
          filedNames.push(rawName);
        }
      }
    } catch { /* filing is best-effort; the reply alert below still fires */ }

    await db.from("activity_log").insert({
      entity_type: "deal", entity_id: deal.id, interaction_type: "email",
      subject: "merchant:reply",
      // [emsg:<id>] lets the Step 7 board open the FULL merchant email on "view email".
      content: `[re: merchant] ${summary ?? "Merchant replied"}: "${snippet.slice(0, 180)}"` +
        (filedNames.length ? ` [auto-filed: ${filedNames.join(", ")}]` : "") +
        (reply.eid ? ` [emsg:${reply.eid}]` : ""),
    });

    // Internal alert — owner only. NEVER email the merchant.
    try {
      const owner = await upsertContact(cfg, {
        email: OWNER_EMAIL, firstName: "Momentum", lastName: "Funding",
        tags: ["staff"], source: "Merchant Reply Alert",
      });
      const ownerId = owner.data?.contact?.id;
      if (ownerId) {
        const subj = `Merchant replied: ${businessName} on ${dealNumber}`;
        const bodyText =
          `${businessName} (${reply.from}) wrote back on ${dealNumber}.\n\n` +
          (summary ? `${summary}\n\n` : "") +
          (snippet ? `"${snippet}"\n\n` : "") +
          (filedNames.length ? `📎 Auto-filed to their documents: ${filedNames.join(", ")}\n\n` : "") +
          `Read + respond in GHL → Conversations, or open the deal in the Revenue Playbook.`;
        await sendEmailToContact(cfg, ownerId, subj,
          `<div style="font-family:Arial;font-size:14px;white-space:pre-wrap">${esc(bodyText)}</div>`,
          { text: bodyText });
      }
    } catch { /* alert is best-effort; the stamp is the record */ }

    merchantDetails.push(`${businessName} → ${dealNumber}`);
  }

  return { merchantReplies, merchantDetails };
}

// Phase 3 — flag email OPENS on the Step 7 trails. Every merchant/funder SEND we
// logged carries a machine marker ([emsg:<email-record-id>] or [msg:<conversation-
// message-id>]) pointing at its GHL email record; GHL tracks open/click state on
// that record. Here we resolve each recently-sent, not-yet-flagged row and, when
// GHL reports it 'opened' (or 'clicked'), append [opened:<iso>] to the activity_log
// content so FunderResponsesBoard can render a "👀 Opened" chip. Best-effort per
// row — one bad row must never stop the loop. Returns how many rows we newly flagged.
async function harvestOpens(
  db: SupabaseClient,
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db.from("activity_log")
    .select("id, content")
    .eq("entity_type", "deal")
    .or("subject.like.merchant:email%,subject.like.funder:email%")
    .or("content.like.%[msg:%,content.like.%[emsg:%")
    .not("content", "like", "%[opened:%")
    .gt("created_at", since)
    .limit(25);

  let flagged = 0;
  for (const row of (rows ?? []) as Array<{ id: string; content: string | null }>) {
    try {
      const content = String(row.content ?? "");
      // Resolve the email-record id: [emsg:id] is one directly; [msg:id] is a
      // conversation-message id whose email record is meta.email.messageIds (last).
      let emailRecordId = "";
      const emsg = content.match(/\[emsg:([^\]]+)\]/);
      if (emsg) {
        emailRecordId = emsg[1];
      } else {
        const msg = content.match(/\[msg:([^\]]+)\]/);
        if (!msg) continue;
        const mRes = await ghlFetch<{ message?: Record<string, unknown> } & Record<string, unknown>>(
          cfg, "GET", `/conversations/messages/${msg[1]}`,
        );
        const m = (mRes.data?.message ?? mRes.data ?? {}) as Record<string, unknown>;
        const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
        if (!ids.length) continue;
        emailRecordId = String(ids[ids.length - 1]);
      }
      if (!emailRecordId) continue;

      const eRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
        cfg, "GET", `/conversations/messages/email/${emailRecordId}`,
      );
      const e = (eRes.data?.emailMessage ?? eRes.data ?? {}) as Record<string, unknown>;
      const status = String(e.status ?? "").toLowerCase();
      if (status !== "opened" && status !== "clicked") continue;

      const { error: upErr } = await db.from("activity_log")
        .update({ content: `${content} [opened:${new Date().toISOString()}]` })
        .eq("id", row.id);
      if (!upErr) flagged++;
    } catch { /* best-effort per row — never break the loop */ }
  }
  return flagged;
}

type FunderContactSrc = {
  ghl_contact_id: string;
  submission_email?: string | null;
  primary_contact_email?: string | null;
  website?: string | null;
};

// The funder's email domain (from submission/contact email, else website host).
function domainOf(l: FunderContactSrc): string | null {
  const fromEmail = (e?: string | null) =>
    e && e.includes("@") ? e.split("@")[1].trim().toLowerCase() : null;
  return (
    fromEmail(l.submission_email) ||
    fromEmail(l.primary_contact_email) ||
    (l.website
      ? l.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase() || null
      : null)
  );
}

// Every GHL contact for a funder: the linked one PLUS any contact on the same
// email domain (support@, gverma@, …). Replies from a sibling address were
// silently dropped because only the linked contact was watched.
async function gatherFunderContactIds(
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
  lender: FunderContactSrc,
): Promise<string[]> {
  const ids = new Set<string>();
  if (lender.ghl_contact_id) ids.add(lender.ghl_contact_id);
  const domain = domainOf(lender);
  if (domain && domain.includes(".") && !/(gmail|yahoo|outlook|hotmail|aol|icloud)\./.test(domain)) {
    const res = await ghlFetch<{ contacts?: Array<{ id: string; email?: string }> }>(
      cfg, "POST", `/contacts/search`, { locationId: cfg.locationId, query: domain, pageLimit: 20 },
    );
    for (const c of res.data?.contacts ?? []) {
      if (c.id && String(c.email ?? "").toLowerCase().endsWith("@" + domain)) ids.add(c.id);
    }
  }
  return [...ids];
}

// Classify + stamp + log + alert ONE funder reply onto a SPECIFIC submission
// (already identity-verified as belonging to this deal). Forward-only on
// response_at; status only advances from an open state. Returns a detail string.
async function applyFunderReply(
  db: SupabaseClient,
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
  lender: { id: string; company_name: string },
  sub: { id: string; deal_id: string; status: string; response_at: string | null },
  reply: { text: string; from: string; at: string; eid: string },
): Promise<string> {
  const { text: replyText, from: replyFrom, at: replyAt, eid: replyEid } = reply;

  if (replyAt && (!sub.response_at || Date.parse(replyAt) > Date.parse(sub.response_at))) {
    await db.from("deal_submissions").update({ response_at: replyAt }).eq("id", sub.id);
  }

  const { data: deal } = await db.from("deals")
    .select("deal_number, customer_id").eq("id", sub.deal_id).maybeSingle();
  const dealNumber = (deal?.deal_number as string) ?? sub.deal_id;
  const snippet = replyText.slice(0, 300);

  // Classify + apply to the card (best-effort — NEVER blocks the log/alert).
  let classification: ReplyClassification | null = null;
  let applied = "";
  try {
    classification = await classifyReply(db, replyText);
    if (classification) {
      const patch: Record<string, unknown> = {
        response_type: classification.type,
        response_summary: classification.summary || null,
        classified_at: new Date().toISOString(),
        response_data: { raw: replyText, from: replyFrom, parsed: classification },
      };
      const OPEN_STATUSES = ["submitted", "pending", "under_review"];
      const isOpen = OPEN_STATUSES.includes(String(sub.status));
      if (classification.type === "decline" && isOpen) {
        patch.status = "declined";
        patch.decline_reason = classification.summary ||
          (classification.decline_reason_category ?? "declined").replace(/_/g, " ");
        applied = "Card auto-marked DECLINED.";
      } else if (classification.type === "offer" && isOpen) {
        patch.status = "offer_made";
        const t = classification.offer_terms;
        const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
        if (t && num(t.amount)) patch.offer_amount = num(t.amount);
        if (t && num(t.factor)) patch.factor_rate = num(t.factor);
        applied = "Card auto-marked OFFER — verify the parsed terms and log any missing ones.";
      }
      await db.from("deal_submissions").update(patch).eq("id", sub.id);
    }
  } catch { /* classification is best-effort; the log is the record */ }

  await db.from("activity_log").insert({
    entity_type: "deal", entity_id: sub.deal_id, interaction_type: "email",
    subject: `ghl:funder-reply — ${lender.company_name}`,
    content: `${classification?.type ?? "reply"}: "${snippet.slice(0, 180)}" (${replyFrom})` +
      (replyEid ? ` [emsg:${replyEid}]` : ""),
  });

  try {
    const owner = await upsertContact(cfg, {
      email: OWNER_EMAIL, firstName: "Momentum", lastName: "Funding",
      tags: ["staff"], source: "Funder Reply Alert",
    });
    const ownerId = owner.data?.contact?.id;
    if (ownerId) {
      const typeLabel: Record<string, string> = {
        stip_request: "Stip request", decline: "Decline", offer: "Offer",
        question: "Question", acknowledgment: "Acknowledgment", other: "Reply",
      };
      const classLine = classification
        ? `Type: ${typeLabel[classification.type] ?? classification.type}` +
          (classification.decline_reason_category ? ` (${classification.decline_reason_category.replace(/_/g, " ")})` : "") +
          (classification.requested_items.length ? `\nNeeds: ${classification.requested_items.join(", ")}` : "") +
          (classification.summary ? `\n${classification.summary}` : "") + `\n\n`
        : "";
      const subj = `Funder replied: ${lender.company_name} on ${dealNumber}`;
      const bodyText =
        `${lender.company_name} (${replyFrom}) replied on ${dealNumber}.\n\n` +
        classLine +
        (snippet ? `"${snippet}"\n\n` : "") +
        (applied ? `${applied}\n\n` : "") +
        `Read + respond in GHL → Conversations, or from the deal's Step 7 board.`;
      await sendEmailToContact(cfg, ownerId, subj,
        `<div style="font-family:Arial;font-size:14px;white-space:pre-wrap">${esc(bodyText)}</div>`,
        { text: bodyText });
    }
  } catch { /* alert is best-effort; the log is the record */ }

  return `${lender.company_name} → ${dealNumber}`;
}

// Exact-key re-home: a reply that named a deal number NOT open with this funder —
// attach it to THIS funder's submission on that deal (any status) if one exists
// and it isn't already logged there. Returns a detail string, or null to park.
async function routeByDealNumber(
  db: SupabaseClient,
  cfg: Awaited<ReturnType<typeof getGhlConfig>>,
  lender: { id: string; company_name: string },
  dealNumber: string,
  reply: { text: string; from: string; at: string; eid: string },
): Promise<string | null> {
  const { data: deal } = await db.from("deals").select("id").eq("deal_number", dealNumber).maybeSingle();
  if (!deal?.id) return null;
  const { data: sub } = await db.from("deal_submissions")
    .select("id, deal_id, status, response_at")
    .eq("lender_id", lender.id).eq("deal_id", deal.id as string).maybeSingle();
  if (!sub) return null;
  const { data: dup } = await db.from("activity_log")
    .select("id").eq("entity_type", "deal").eq("entity_id", sub.deal_id as string)
    .like("content", `%[emsg:${reply.eid}]%`).limit(1);
  if (dup?.length) return `${lender.company_name} → ${dealNumber} (already logged)`;
  return await applyFunderReply(
    db, cfg, lender,
    sub as { id: string; deal_id: string; status: string; response_at: string | null },
    reply,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = serviceClient();
  const cfg = await getGhlConfig(db);

  // Shared-secret guard (same secret the GHL webhook uses).
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const expected = (cfg as unknown as { webhookSecret?: string }).webhookSecret ??
    (await db.rpc("get_ghl_config")).data?.webhook_secret;
  if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

  // Every ACTIVE submission — watched continuously. response_at is the newest
  // reply we've seen (forward-only), so second/third funder replies re-alert.
  const { data: pending } = await db.from("deal_submissions")
    .select("id, deal_id, lender_id, submitted_at, response_at, status")
    .not("submitted_at", "is", null)
    .in("status", ["submitted", "offer_made"]);
  if (!pending?.length) {
    const mp = await runMerchantPhase(db, cfg);
    const opensFlagged = await harvestOpens(db, cfg);
    return json({ ok: true, checked: 0, replies: 0, merchant_replies: mp.merchantReplies, merchant_details: mp.merchantDetails, opens_flagged: opensFlagged });
  }

  const lenderIds = [...new Set(pending.map((p) => p.lender_id))];
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, ghl_contact_id, submission_email, primary_contact_email, website")
    .in("id", lenderIds)
    .not("ghl_contact_id", "is", null);

  let replies = 0;
  const details: string[] = [];
  const parked: string[] = [];
  const parkedEids = await loadParkedFunderEids(db);

  for (const lender of lenders ?? []) {
    const lenderPending = pending.filter((p) => p.lender_id === lender.id);
    if (!lenderPending.length) continue;

    // Candidate submissions WITH merchant identity (deal_number + business_name) —
    // this is what lets us verify WHICH merchant an inbound reply is about instead
    // of blindly stamping the funder's newest open submission.
    const dealIds = [...new Set(lenderPending.map((p) => p.deal_id))];
    const { data: dealRows } = await db.from("deals")
      .select("id, deal_number, customer:customers!customer_id ( business_name )")
      .in("id", dealIds);
    const dealMeta = new Map<string, { dealNumber: string | null; businessName: string | null }>();
    for (const d of dealRows ?? []) {
      dealMeta.set(d.id as string, {
        dealNumber: (d.deal_number as string | null) ?? null,
        businessName: ((d.customer as { business_name?: string } | null)?.business_name) ?? null,
      });
    }
    const subCands: SubCandidate[] = lenderPending.map((p) => ({
      submissionId: p.id, dealId: p.deal_id,
      dealNumber: dealMeta.get(p.deal_id)?.dealNumber ?? null,
      businessName: dealMeta.get(p.deal_id)?.businessName ?? null,
      submittedAt: (p.submitted_at as string | null) ?? null,
    }));

    // Conversations across ALL of this funder's contacts (linked + same email
    // domain). Funders often reply from a different address (support@ vs the
    // submissions@ we sent to), which lands on a separate GHL contact.
    const contactIds = await gatherFunderContactIds(cfg, lender as FunderContactSrc);
    const conversations: Array<{ id: string }> = [];
    for (const cid of contactIds) {
      const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
        cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${cid}`,
      );
      for (const c of conv.data?.conversations ?? []) conversations.push(c);
    }
    // Pull every conversation's messages once, and capture our own outbound replies
    // typed in GHL Conversations (resolved to the correct deal, never forced onto
    // the newest). The message-level body/direction are NOT reliable — a TYPE_EMAIL
    // message bundles many email RECORDS (meta.email.messageIds); we resolve each
    // record and judge inbound-ness by the RECORD itself.
    const allMessages: Array<Record<string, unknown>> = [];
    for (const c of conversations) {
      const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
        cfg, "GET", `/conversations/${c.id}/messages?limit=20`,
      );
      const list = msgs.data?.messages?.messages ?? [];
      const outLogged = await captureOutboundFunderEmails(db, cfg, lender.company_name, subCands, list);
      if (outLogged) details.push(`${lender.company_name} ← ${outLogged} reply (Conversations)`);
      for (const m of list) allMessages.push(m);
    }

    // Dedupe against what we've already logged across ALL of this funder's open
    // deals, plus anything already parked — so a record already handled is skipped
    // BEFORE we spend an API call fetching it, and re-polls never re-park.
    const { data: markedRows } = await db.from("activity_log")
      .select("content").eq("entity_type", "deal").in("entity_id", dealIds)
      .like("content", "%[emsg:%");
    const markedEids = new Set<string>(parkedEids);
    for (const r of markedRows ?? []) {
      for (const mm of String((r as { content?: string }).content ?? "").matchAll(/\[emsg:([^\]]+)\]/g)) {
        markedEids.add(mm[1]);
      }
    }

    // Candidate UNSEEN email-record ids, newest message first. Cap fetches.
    const refs: Array<{ eid: string; msgDate: string }> = [];
    const refSeen = new Set<string>();
    for (const m of allMessages) {
      if (!/email/i.test(String(m.messageType ?? ""))) continue;
      const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
      for (const eid of ids) {
        const id = String(eid);
        if (markedEids.has(id) || refSeen.has(id)) continue;
        refSeen.add(id);
        refs.push({ eid: id, msgDate: String(m.dateAdded ?? "") });
      }
    }
    refs.sort((a, b) => Date.parse(b.msgDate) - Date.parse(a.msgDate));

    // Resolve + route EACH unseen inbound record to its TRUE deal. Unlike before,
    // we no longer pick a single "newest" reply and force it onto the newest
    // submission — every record is identity-checked (deal number / business name)
    // and either attached to the deal it names, re-homed by deal number, or parked.
    let fetched = 0;
    for (const ref of refs) {
      if (fetched >= 25) break;
      fetched++;
      if (markedEids.has(ref.eid)) continue; // handled earlier in THIS run
      const emailRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
        cfg, "GET", `/conversations/messages/email/${ref.eid}`,
      );
      const e = (emailRes.data?.emailMessage ?? emailRes.data ?? {}) as Record<string, unknown>;
      if (String(e.direction ?? "") !== "inbound") continue;
      const from = String(e.from ?? "").toLowerCase();
      // Self-loop guard: our own sender bounced back is not a funder reply.
      if (from.includes("send.mfunding.net") || from.includes("socrates73@gmail.com")) continue;
      const subject = String(e.subject ?? "");
      let text = String(e.body ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ").trim();
      const quoteIdx = text.search(/\bOn\s.{4,80}\swrote:/);
      if (quoteIdx > 0) text = text.slice(0, quoteIdx).trim();
      if (!text) text = "(reply received — open the conversation to read it)";
      const at = String(e.dateAdded ?? e.date ?? ref.msgDate);
      const fromRaw = String(e.from ?? "");
      const reply = { text, from: fromRaw, at, eid: ref.eid };

      const res = resolveReplyTarget({ subject, body: text, subs: subCands, lenderName: lender.company_name, emailDate: at });
      markedEids.add(ref.eid); // don't reconsider this record again this run

      if (res.kind === "match") {
        const sub = lenderPending.find((p) => p.id === res.sub.submissionId);
        if (!sub) continue;
        const detail = await applyFunderReply(
          db, cfg, lender,
          { id: sub.id, deal_id: sub.deal_id, status: String(sub.status), response_at: (sub.response_at as string | null) ?? null },
          reply,
        );
        replies++; details.push(`${detail} [${res.via}]`);
      } else if (res.kind === "wrong_deal_number") {
        const routed = await routeByDealNumber(db, cfg, lender, res.dealNumber, reply);
        if (routed) { replies++; details.push(`${routed} [re-homed]`); }
        else {
          await parkFunderEmail(db, { eventType: "FunderReplyUnmatched", lenderName: lender.company_name, from: fromRaw, subject, snippet: text, eid: ref.eid, reason: `names deal ${res.dealNumber} — no submission to this funder` });
          parked.push(`${lender.company_name}: unmatched (deal ${res.dealNumber})`);
        }
      } else if (res.kind === "general") {
        // Marketing / onboarding / welcome chatter — about no file. Keep it OFF deal
        // cards; record it in the general bucket so it never re-processes.
        await parkFunderEmail(db, { eventType: "FunderReplyGeneral", lenderName: lender.company_name, from: fromRaw, subject, snippet: text, eid: ref.eid, reason: "funder general / onboarding (not about a specific file)" });
      } else {
        // wrong_merchant | stale | ambiguous | none — never attach; park for a human.
        const reason = res.kind === "wrong_merchant" ? `names a different merchant: ${res.merchant}`
          : res.kind === "stale" ? res.reason
          : res.kind === "ambiguous" ? "could not tell which open deal it is about"
          : "no open submission to this funder";
        await parkFunderEmail(db, { eventType: "FunderReplyUnmatched", lenderName: lender.company_name, from: fromRaw, subject, snippet: text, eid: ref.eid, reason });
        parked.push(`${lender.company_name}: ${res.kind}`);
      }
    }
  }

  const mp = await runMerchantPhase(db, cfg);
  const opensFlagged = await harvestOpens(db, cfg);
  return json({
    ok: true, checked: (lenders ?? []).length, replies, details,
    parked: parked.length, parked_details: parked,
    merchant_replies: mp.merchantReplies, merchant_details: mp.merchantDetails,
    opens_flagged: opensFlagged,
  });
});
