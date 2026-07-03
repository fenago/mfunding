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

const OWNER_EMAIL = "socrates73@gmail.com";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  if (!pending?.length) return json({ ok: true, checked: 0, replies: 0 });

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

      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: newest.deal_id, action: "ghl:funder-reply",
        details: { lender: lender.company_name, submissionId: newest.id, via: "poll", from: replyFrom, snippet },
      });

      // Internal alert — owner only.
      try {
        const owner = await upsertContact(cfg, {
          email: OWNER_EMAIL, firstName: "Momentum", lastName: "Funding",
          tags: ["staff"], source: "Funder Reply Alert",
        });
        const ownerId = owner.data?.contact?.id;
        if (ownerId) {
          const subj = `Funder replied: ${lender.company_name} on ${dealNumber}`;
          const bodyText =
            `${lender.company_name} (${replyFrom}) replied on ${dealNumber}.\n\n` +
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

  return json({ ok: true, checked: (lenders ?? []).length, replies, details });
});
