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
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

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
  let text = raw.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
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
): Promise<{ text: string; from: string; at: string } | null> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET",
    `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  let best: { text: string; from: string; at: string } | null = null;
  for (const c of conv.data?.conversations ?? []) {
    const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
      cfg, "GET", `/conversations/${c.id}/messages?limit=15`,
    );
    const list = msgs.data?.messages?.messages ?? [];
    const candidates = list.filter((m) =>
      String(m.direction ?? "") === "inbound" &&
      /email/i.test(String(m.messageType ?? "")) &&
      String(m.dateAdded ?? "") > afterIso,
    );
    for (const m of candidates) {
      const at = String(m.dateAdded ?? "");
      if (best && at <= best.at) continue; // already hold a newer one
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
        best = { text, from: String(e.from ?? ""), at };
        break;
      }
    }
  }
  return best;
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
    .select("id, deal_number, merchant_reply_at, created_at, customer:customers!customer_id ( ghl_contact_id, email, business_name, first_name, last_name )")
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
    const cust = deal.customer as
      { ghl_contact_id: string; email?: string; business_name?: string; first_name?: string; last_name?: string } | null;
    if (!cust?.ghl_contact_id) continue;

    // Baseline: only ever look for inbound newer than what we've already seen
    // (or, on the first pass, newer than the deal's creation).
    const afterIso = (deal.merchant_reply_at as string | null) ?? (deal.created_at as string);
    let reply: { text: string; from: string; at: string } | null = null;
    let dbgErr = "";
    try {
      reply = await findMerchantReply(cfg, cust.ghl_contact_id, afterIso);
    } catch (e) { dbgErr = e instanceof Error ? e.message : String(e); }
    merchantDetails.push(`dbg ${deal.deal_number}: after=${afterIso} reply=${reply ? reply.at : "null"} err=${dbgErr}`);
    if (!reply) continue;

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
    const { data: stamped, error: stampErr } = await db.from("deals")
      .update({ merchant_reply_at: reply.at, merchant_reply_summary: summary })
      .eq("id", deal.id)
      .or(`merchant_reply_at.is.null,merchant_reply_at.lt.${reply.at}`)
      .select("id");
    if (stampErr) merchantDetails.push(`dbg stampErr ${deal.deal_number}: ${stampErr.message}`);
    if (!stamped?.length) continue; // another run beat us to this reply

    merchantReplies++;
    await db.from("activity_log").insert({
      entity_type: "deal", entity_id: deal.id, interaction_type: "email",
      subject: "merchant:reply",
      content: `[re: merchant] ${summary ?? "Merchant replied"}: "${snippet.slice(0, 180)}"`,
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

  // Every funder with an outstanding (answered-by-nobody) submission.
  const { data: pending } = await db.from("deal_submissions")
    .select("id, deal_id, lender_id, submitted_at")
    .not("submitted_at", "is", null)
    .is("response_at", null);
  if (!pending?.length) {
    const mp = await runMerchantPhase(db, cfg);
    return json({ ok: true, checked: 0, replies: 0, merchant_replies: mp.merchantReplies, merchant_details: mp.merchantDetails });
  }

  const lenderIds = [...new Set(pending.map((p) => p.lender_id))];
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, ghl_contact_id")
    .in("id", lenderIds)
    .not("ghl_contact_id", "is", null);

  let replies = 0;
  const details: string[] = [];

  for (const lender of lenders ?? []) {
    const subs = pending
      .filter((p) => p.lender_id === lender.id)
      .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
    const newest = subs[0];
    if (!newest) continue;

    // Conversations for this funder contact.
    const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
      cfg, "GET",
      `/conversations/search?locationId=${cfg.locationId}&contactId=${lender.ghl_contact_id}`,
    );
    for (const c of conv.data?.conversations ?? []) {
      const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
        cfg, "GET", `/conversations/${c.id}/messages?limit=15`,
      );
      const list = msgs.data?.messages?.messages ?? [];
      // Candidate inbound messages. IMPORTANT: the message-level \`body\` is NOT
      // the reply — GHL fills it with the quoted original. The real reply text
      // lives in the linked email record (meta.email.messageIds), so we resolve
      // that and judge authenticity by the email record's from-address.
      const candidates = list.filter((m) =>
        String(m.direction ?? "") === "inbound" &&
        /email/i.test(String(m.messageType ?? "")) &&
        String(m.dateAdded ?? "") > String(newest.submitted_at),
      );

      let replyText = "";
      let replyFrom = "";
      for (const m of candidates) {
        const meta = m.meta as { email?: { messageIds?: string[] } } | undefined;
        const ids = meta?.email?.messageIds ?? [];
        for (const eid of ids) {
          const emailRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
            cfg, "GET", `/conversations/messages/email/${eid}`,
          );
          const e = (emailRes.data?.emailMessage ?? emailRes.data ?? {}) as Record<string, unknown>;
          if (String(e.direction ?? "") !== "inbound") continue;
          const from = String(e.from ?? "").toLowerCase();
          // Self-loop guard: our own sender bounced back is not a funder reply.
          if (from.includes("send.mfunding.net") || from.includes("socrates73@gmail.com")) continue;
          let text = String(e.body ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
            .replace(/\s+/g, " ").trim();
          // Trim the quoted original ("On <date> ... wrote:") so alerts carry
          // only what the funder actually said.
          const quoteIdx = text.search(/\bOn\s.{4,80}\swrote:/);
          if (quoteIdx > 0) text = text.slice(0, quoteIdx).trim();
          if (!text) text = "(reply received — open the conversation to read it)";
          replyText = text;
          replyFrom = String(e.from ?? "");
          break;
        }
        if (replyText) break;
      }
      if (!replyText) continue;

      // Stamp (idempotent: only the NULL row updates).
      const now = new Date().toISOString();
      const { data: stamped } = await db.from("deal_submissions")
        .update({ response_at: now }).eq("id", newest.id).is("response_at", null)
        .select("id");
      if (!stamped?.length) break; // webhook (or a prior poll) beat us — done

      replies++;
      const { data: deal } = await db.from("deals")
        .select("deal_number, customer_id").eq("id", newest.deal_id).maybeSingle();
      const dealNumber = (deal?.deal_number as string) ?? newest.deal_id;
      const snippet = replyText.slice(0, 300);

      // Classify the reply (best-effort — NEVER blocks the stamp/alert above).
      let classification: ReplyClassification | null = null;
      try {
        classification = await classifyReply(db, replyText);
        if (classification) {
          await db.from("deal_submissions").update({
            response_type: classification.type,
            response_summary: classification.summary || null,
            classified_at: new Date().toISOString(),
            response_data: { raw: replyText, from: replyFrom, parsed: classification },
          }).eq("id", newest.id);
        }
      } catch { /* classification is best-effort; the stamp is the record */ }

      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: newest.deal_id, interaction_type: "email",
        subject: `ghl:funder-reply — ${lender.company_name}`,
        content: `${classification?.type ?? "reply"}: "${snippet.slice(0, 180)}" (${replyFrom})`,
      });

      // Internal alert — owner only.
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
            `Read + respond in GHL → Conversations. Log any offer on the deal's Submissions tab.`;
          await sendEmailToContact(cfg, ownerId, subj,
            `<div style="font-family:Arial;font-size:14px;white-space:pre-wrap">${esc(bodyText)}</div>`,
            { text: bodyText });
        }
      } catch { /* alert is best-effort; the stamp is the record */ }

      details.push(`${lender.company_name} → ${dealNumber}`);
      break; // one stamp per funder per run
    }
  }

  const mp = await runMerchantPhase(db, cfg);
  return json({
    ok: true, checked: (lenders ?? []).length, replies, details,
    merchant_replies: mp.merchantReplies, merchant_details: mp.merchantDetails,
  });
});
