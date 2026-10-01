// ── Email DELIVERY events → the per-recipient truth about a submission ───────
//
// Lives in _shared, and not inside ghl-webhook, for ONE reason that matters more
// than tidiness: ghl-webhook/index.ts calls Deno.serve at module scope, so
// importing it from a test starts a server and leaks an op. A handler that
// cannot be exercised by a test is a handler verified only by reading, and this
// codebase has already paid for several of those. Everything below takes its
// database as an argument so a stub can drive it and the failure path can be
// made to go RED on demand — see emailDelivery.test.ts.
//
// There is exactly ONE consumer (ghl-webhook). Nothing here is duplicated
// anywhere, deliberately: the lockstep-copy trap in this repo is real.
import { getGhlConfig, sendEmailToContact, serviceClient, upsertContact } from "./ghl.ts";
import {
  failureLine, isProvenPermanentFailure, parseEmailStats, recipientRole, type ParsedStats,
} from "./emailStats.ts";

/** The same client type the rest of the function tree uses. Taken from
 *  serviceClient rather than re-imported from supabase-js: ghl.ts pins the esm.sh
 *  build, and a second import specifier produces a structurally identical but
 *  NON-assignable type. */
type DB = ReturnType<typeof serviceClient>;

/** Internal alerts go ONLY here — never to a funder or a merchant. Same address
 *  the funder-reply alert uses in ghl-webhook. */
const OWNER_EMAIL = "socrates73@gmail.com";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface DeliveryResult {
  outcome: "processed" | "ignored" | "error";
  detail: string;
  result: Record<string, unknown>;
}

// ── PER-RECIPIENT email delivery events ──────────────────────────────────────
//
// THE PROBLEM THIS CLOSES. Funders told the owner they never received
// submissions our system records as sent, and nothing could have told us
// otherwise: no email event was subscribed, Return-Path is Mailgun's own address
// so bounce NDRs never reach us, and GHL's email RECORD carries one aggregate
// status across to + cc + bcc — so a permanent failure to the funder's `to:`
// address reads as a healthy send because our own CC copies delivered fine.
//
// WHAT THE OWNER MUST DO IN GHL for anything to arrive here (neither is done,
// and nothing below can fire until one is):
//
//   A) `LCEmailStats` — the full-fidelity path. Per recipient, with the remote
//      server's SMTP code, enhanced-code, mx-host and message. Its doc says
//      "Available only to Location Level Apps", and no other webhook event doc
//      in GHL's repo carries that note, so it is a real constraint and not
//      boilerplate: it needs a Marketplace app whose distribution type is
//      Sub-Account, subscribed to LCEmailStats, installed on this location. A
//      Private Integration Token (what every other call in this codebase uses)
//      cannot subscribe to webhooks at all.
//
//   B) A native "Email Events" workflow trigger (filters: Bounced, Complained,
//      Opened, Clicked, Unsubscribed) with a Webhook action pointing here. No
//      app, no owner marketplace work — buildable in the VibeReach UI today.
//      It fires on the CONTACT, so it carries no per-recipient address and no
//      SMTP reply: it can say "a message to this funder bounced" and no more.
//      Handled as the weaker signal it is, never dressed up as the stronger one.
//
// CORRELATION. GHL exposes no SMTP Message-ID at send time — verified against a
// live email record (GET /conversations/messages/email/{id} returns id,
// direction, status, from, to, cc, subject, threadId, provider, attachments and
// NO message-id header), so a Message-ID captured at send and matched here is
// not achievable. What IS achievable is binding it on first sight: the first
// event for a message carries both its Message-ID and its recipient, so when
// the recipient resolves to exactly one submission we record the Message-ID on
// that submission and every later event for the same message matches EXACTLY.
// When the recipient resolves to more than one, we refuse to guess and say so.
const DELIVERY_MATCH_WINDOW_DAYS = 21;

interface SubMatchRow {
  id: string; deal_id: string; lender_id: string;
  submitted_at: string | null; sent_payload: Record<string, unknown> | null;
  deal?: { deal_number?: string | null } | null;
  lender?: { company_name?: string | null } | null;
}

interface Placement {
  rung: "smtp_message_id" | "recipient_unique" | "contact_unique" | "unplaced_none" | "unplaced_ambiguous";
  sub: SubMatchRow | null;
  candidates: SubMatchRow[];
}

const SUB_MATCH_COLS =
  "id, deal_id, lender_id, submitted_at, sent_payload, " +
  "deal:deals!deal_id ( deal_number ), lender:lenders!lender_id ( company_name )";

/** Tie an event to the submission it is about, or say which it could be.
 *  Never returns a single submission it had to pick between. */
export async function placeDeliveryEvent(db: DB, p: ParsedStats): Promise<Placement> {
  // Rung 1 — exact. A Message-ID we bound on an earlier event for this message.
  if (p.smtpMessageId) {
    const { data } = await db.from("deal_submissions").select(SUB_MATCH_COLS)
      .eq("sent_payload->>smtp_message_id", p.smtpMessageId).limit(1).maybeSingle();
    if (data) return { rung: "smtp_message_id", sub: data as unknown as SubMatchRow, candidates: [] };
  }

  const since = new Date(Date.parse(p.occurredAt) - DELIVERY_MATCH_WINDOW_DAYS * 864e5).toISOString();
  // A delivery event cannot precede its own send by more than clock skew. The
  // 5-minute slack is for that skew only, not for guessing.
  const until = new Date(Date.parse(p.occurredAt) + 5 * 60_000).toISOString();

  // Rung 2 — by the ADDRESS this message was sent to. Prefer our own To: header
  // (so a bounce of one of our CC copies still resolves to the right funder
  // submission) and fall back to the recipient itself.
  const addr = (p.headerTo ?? p.recipient).toLowerCase();
  if (addr.includes("@")) {
    const { data } = await db.from("deal_submissions").select(SUB_MATCH_COLS)
      .eq("sent_payload->>to", addr)
      .gte("submitted_at", since).lte("submitted_at", until)
      .order("submitted_at", { ascending: false });
    const rows = (data ?? []) as unknown as SubMatchRow[];
    if (rows.length === 1) return { rung: "recipient_unique", sub: rows[0], candidates: rows };
    if (rows.length > 1) return { rung: "unplaced_ambiguous", sub: null, candidates: rows };
  }

  // Rung 3 — the workflow shape gives a CONTACT, not an address. A funder
  // contact maps to a lender; their submissions in the window are the
  // candidates. Same refusal to guess when there is more than one.
  if (p.contactId) {
    const { data: lender } = await db.from("lenders")
      .select("id").eq("ghl_contact_id", p.contactId).maybeSingle();
    if (lender?.id) {
      const { data } = await db.from("deal_submissions").select(SUB_MATCH_COLS)
        .eq("lender_id", lender.id)
        .gte("submitted_at", since).lte("submitted_at", until)
        .order("submitted_at", { ascending: false });
      const rows = (data ?? []) as unknown as SubMatchRow[];
      if (rows.length === 1) return { rung: "contact_unique", sub: rows[0], candidates: rows };
      if (rows.length > 1) return { rung: "unplaced_ambiguous", sub: null, candidates: rows };
    }
  }

  return { rung: "unplaced_none", sub: null, candidates: [] };
}

const candidateLabel = (r: SubMatchRow) =>
  `${r.deal?.deal_number ?? r.deal_id} (${r.lender?.company_name ?? r.lender_id}, sent ${r.submitted_at ?? "?"})`;

export async function handleEmailDeliveryEvent(db: DB, evt: Record<string, unknown>): Promise<DeliveryResult> {
  const p = parseEmailStats(evt);
  if (!p) {
    return { outcome: "ignored", detail: "email-stats: payload carried neither a recipient nor a contact", result: {} };
  }

  const place = await placeDeliveryEvent(db, p);
  const sub = place.sub;

  // Which of OUR addresses is this event about? Read the submission's own to/cc
  // when we have it, so "the funder's inbox refused us" is never confused with
  // "our audit CC bounced".
  const sp = (sub?.sent_payload ?? {}) as Record<string, unknown>;
  const subTo = typeof sp.to === "string" ? sp.to : null;
  const ccList = Array.isArray(sp.cc) ? (sp.cc as unknown[]).map(String) : [];
  const role = recipientRole(p, subTo, ccList);
  const permanent = isProvenPermanentFailure(p);
  const lenderName = sub?.lender?.company_name ?? null;
  const dealNumber = sub?.deal?.deal_number ?? null;

  // The ledger row goes in FIRST and unconditionally: whatever we can or cannot
  // do about this event, the event itself is now recorded. `provider_event_id`
  // dedupes GHL's retries; a conflict is a redelivery, not an error.
  const ledger = {
    event: p.event, event_raw: p.eventRaw, severity: p.severity,
    recipient: p.recipient || (subTo ?? "unknown"), recipient_role: role,
    header_to: p.headerTo,
    smtp_code: p.smtpCode, smtp_enhanced_code: p.smtpEnhancedCode,
    smtp_message: p.smtpMessage, mx_host: p.mxHost,
    smtp_message_id: p.smtpMessageId, provider_event_id: p.providerEventId,
    occurred_at: p.occurredAt,
    deal_submission_id: sub?.id ?? null, deal_id: sub?.deal_id ?? null,
    lender_id: sub?.lender_id ?? null, ghl_contact_id: p.contactId,
    match_rung: place.rung,
    candidates: place.candidates.length > 1
      ? place.candidates.map((r) => ({
        submissionId: r.id, dealId: r.deal_id, dealNumber: r.deal?.deal_number ?? null,
        lender: r.lender?.company_name ?? null, submittedAt: r.submitted_at,
      }))
      : null,
    payload: evt,
  };
  const ins = await db.from("email_delivery_events").insert(ledger);
  // 23505 = our provider_event_id unique index: GHL redelivered an event we
  // already hold. Everything below is idempotent, so it is safe to continue —
  // but it must not be mistaken for a successful first insert.
  const duplicate = ins.error?.code === "23505";
  if (ins.error && !duplicate) {
    // The ledger is the record. If it could not be written, say so loudly rather
    // than carrying on and reporting a clean outcome.
    return {
      outcome: "error",
      detail: `email-stats: LEDGER WRITE FAILED (${ins.error.message}) — event ${p.eventRaw} to ${p.recipient} not recorded`,
      result: { recorded: false, event: p.event },
    };
  }

  // ── Bind the Message-ID so later events for this message match exactly ─────
  if (sub && p.smtpMessageId && place.rung !== "smtp_message_id") {
    await db.from("deal_submissions")
      .update({ sent_payload: { ...sp, smtp_message_id: p.smtpMessageId } })
      .eq("id", sub.id);
  }

  // ── DELIVERED to the funder's own to: address ─────────────────────────────
  // The positive fact nobody had: the recipient's mail server accepted the
  // message. Only from the to: address — a delivered CC proves nothing about
  // the funder, which is the entire masking bug.
  if (p.event === "delivered" && sub && role === "to") {
    await db.from("deal_submissions")
      .update({ delivered_at: p.occurredAt, delivered_to: p.recipient })
      .eq("id", sub.id);
    return {
      outcome: "processed",
      detail: `email-stats: delivered to ${p.recipient} for ${dealNumber ?? sub.deal_id} (${lenderName ?? "?"})${duplicate ? " [redelivery]" : ""}`,
      result: { event: "delivered", submissionId: sub.id, recipient: p.recipient, rung: place.rung },
    };
  }

  // ── PROVEN PERMANENT FAILURE ─────────────────────────────────────────────
  if (permanent) {
    const line = failureLine(p);

    // Placed, and it was the funder's own inbox → the submission did NOT arrive.
    // submitted_at is kept on purpose: we did send it. status goes back to
    // 'pending' so the board's retry affordance appears, and delivery_failed_at
    // gives stateOf() a chip that outranks "⏳ Awaiting".
    if (sub && role !== "cc") {
      await db.from("deal_submissions").update({
        status: "pending",
        delivery_failed_at: p.occurredAt,
        delivery_error: line,
        error: `Delivery failed: ${line}`,
      }).eq("id", sub.id);

      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: sub.deal_id, interaction_type: "email",
        subject: `ghl:delivery-failed — ${lenderName ?? "funder"}`,
        content: `The recipient's mail server permanently refused our submission. ${line}. ` +
          `This funder did NOT receive the package — resend to a working address.`,
      });

      await alertOwnerDeliveryFailure(db, {
        lenderName, dealNumber, recipient: p.recipient, line,
        candidates: [], submissionId: sub.id,
      });

      return {
        outcome: "processed",
        detail: `email-stats: PERMANENT FAILURE to ${p.recipient} — ${dealNumber ?? sub.deal_id} (${lenderName ?? "?"}) marked undelivered`,
        result: { event: p.event, submissionId: sub.id, permanent: true, rung: place.rung },
      };
    }

    // A CC copy of ours bounced. Worth knowing (our audit trail is broken) but
    // it says nothing about whether the funder got the submission, so the
    // submission is left exactly as it is.
    if (sub && role === "cc") {
      await db.from("ghl_webhook_events").insert({
        event_type: "EmailDeliveryFailedCc", ghl_contact_id: p.contactId,
        outcome: "error",
        detail: `Our CC copy to ${p.recipient} bounced on ${dealNumber ?? sub.deal_id} (${lenderName ?? "?"}): ${line}. ` +
          `The funder's own copy is unaffected — this breaks our audit trail, not the submission.`,
        payload: { source: "ghl-webhook/email-stats", role, line, submissionId: sub.id },
      });
      return {
        outcome: "processed",
        detail: `email-stats: CC bounce to ${p.recipient} (submission untouched) — ${line}`,
        result: { event: p.event, submissionId: sub.id, role, permanent: true },
      };
    }

    // UNPLACED. The most dangerous case to get wrong in either direction: we
    // must not silently drop a 550 to a funder's inbox, and we must not mark a
    // submission undelivered that may well have arrived. So: park it where a
    // human looks, name every candidate, and touch no submission.
    const names = place.candidates.map(candidateLabel);
    await db.from("ghl_webhook_events").insert({
      event_type: "EmailDeliveryFailedUnplaced", ghl_contact_id: p.contactId,
      outcome: "error",
      detail: `PERMANENT delivery failure to ${p.recipient}: ${line}. ` +
        (names.length
          ? `Could belong to ${names.length} submissions — ${names.join(" · ")}. Nothing was marked undelivered; verify which.`
          : `No submission matched this address within ${DELIVERY_MATCH_WINDOW_DAYS} days — it may be a merchant or marketing email.`),
      payload: { source: "ghl-webhook/email-stats", rung: place.rung, line, recipient: p.recipient, candidates: ledger.candidates },
    });
    if (names.length) {
      // Say it on each candidate's own deal too — the park alone is a page
      // nobody has open, and a processor chasing this funder needs to see it.
      for (const r of place.candidates) {
        await db.from("activity_log").insert({
          entity_type: "deal", entity_id: r.deal_id, interaction_type: "email",
          subject: `ghl:delivery-failed? — ${r.lender?.company_name ?? "funder"}`,
          content: `A PERMANENT delivery failure to ${p.recipient} (${line}) could not be tied to a single submission — ` +
            `it belongs to this deal or to ${names.filter((n) => !n.startsWith(String(r.deal?.deal_number))).join(" / ")}. ` +
            `Confirm with the funder before assuming they received the package.`,
        });
      }
      await alertOwnerDeliveryFailure(db, {
        lenderName: place.candidates[0]?.lender?.company_name ?? null,
        dealNumber: null, recipient: p.recipient, line, candidates: names, submissionId: null,
      });
    }
    return {
      outcome: "error",
      detail: `email-stats: PERMANENT FAILURE to ${p.recipient} could not be placed (${place.rung}) — parked, ${names.length} candidate(s)`,
      result: { event: p.event, permanent: true, rung: place.rung, candidates: names },
    };
  }

  // ── Everything else: recorded, and nothing claimed ───────────────────────
  // An unproven failure (Mailgun still retrying a 4xx), an open or click (a
  // pixel load, possibly by a scanner), a complaint, an unsubscribe. The ledger
  // row is the outcome; none of these may move a submission's state.
  const note = p.event === "opened" || p.event === "clicked"
    ? " (pixel load — not evidence anyone read it)"
    : p.event === "failed" || p.event === "rejected"
    ? " (severity unproven — provider may still be retrying)"
    : "";
  // Merchant-side open ledger (email_open_events + the customers aggregate the
  // Campaign Audit reads) still gets its row — that feature measures whether a
  // LEAD is engaging, where a pixel load is a legitimate weak signal. The
  // funder path is the one where it was being read as proof of a read.
  if ((p.event === "opened" || p.event === "clicked") && p.contactId) {
    try {
      await db.rpc("record_lead_email_open", {
        p_contact_id: p.contactId, p_message_id: p.smtpMessageId ?? p.providerEventId,
      });
    } catch (e) {
      console.warn("[ghl-webhook] record_lead_email_open skipped:", e instanceof Error ? e.message : e);
    }
  }
  if (p.event === "complained") {
    await db.from("ghl_webhook_events").insert({
      event_type: "EmailComplaint", ghl_contact_id: p.contactId, outcome: "error",
      detail: `${p.recipient} marked our email as SPAM${lenderName ? ` (${lenderName})` : ""}. ` +
        `This damages sending reputation for send.mfunding.net — stop mailing this address.`,
      payload: { source: "ghl-webhook/email-stats", recipient: p.recipient, submissionId: sub?.id ?? null },
    });
  }
  return {
    outcome: "processed",
    detail: `email-stats: ${p.eventRaw}${note} to ${p.recipient || "?"} — recorded, ${place.rung}` +
      (duplicate ? " [redelivery]" : ""),
    result: { event: p.event, rung: place.rung, submissionId: sub?.id ?? null, recorded: true },
  };
}

/** Internal alert, owner ONLY — never a funder or a merchant. Mirrors the funder-
 *  reply alert in handleInboundMessage. Fires only on a PROVEN permanent failure,
 *  which should be rare; an unproven or transient one gets no email. */
async function alertOwnerDeliveryFailure(db: DB, a: {
  lenderName: string | null; dealNumber: string | null; recipient: string;
  line: string; candidates: string[]; submissionId: string | null;
}): Promise<void> {
  try {
    const cfg = await getGhlConfig(db);
    const owner = await upsertContact(cfg, {
      email: OWNER_EMAIL, firstName: "Momentum", lastName: "Funding",
      tags: ["staff"], source: "Delivery Failure Alert",
    });
    const ownerContactId = owner.data?.contact?.id;
    if (!ownerContactId) return;
    const who = a.lenderName ?? a.recipient;
    const subject = a.dealNumber
      ? `Submission did NOT reach ${who} — ${a.dealNumber}`
      : `Submission bounced at ${who} — which deal is unclear`;
    const lead = a.dealNumber
      ? `Our submission to ${who} on ${a.dealNumber} was permanently refused by their mail server. They did not receive it.`
      : `A submission to ${a.recipient} was permanently refused by their mail server, and it could not be tied to a single deal.`;
    const cand = a.candidates.length
      ? `\n\nIt belongs to one of: ${a.candidates.join(" · ")}. Nothing was marked undelivered — verify which.`
      : "";
    const text = `${lead}\n\nServer said: ${a.line}${cand}\n\n— Momentum Funding (automated)`;
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px">` +
      `<p>${esc(lead)}</p>` +
      `<p><strong>Server said:</strong> <code>${esc(a.line)}</code></p>` +
      (a.candidates.length
        ? `<p>It belongs to one of: ${esc(a.candidates.join(" · "))}. Nothing was marked undelivered — verify which.</p>`
        : "") +
      `</div>`;
    await sendEmailToContact(cfg, ownerContactId, subject, html, { text });
  } catch { /* best-effort — an alert failure must never lose the ledger row */ }
}

