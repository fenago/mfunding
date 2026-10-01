// Replay tests for the email delivery handler.
//
// These exist because the thing that keeps biting this codebase is a handler
// verified by READING. Each case below drives the real handler with a real
// payload shape and asserts what it wrote — and, critically, what it did NOT
// write. The two that matter most are the two refusals: a transient deferral
// must not un-deliver a submission, and an ambiguous failure must not pick a
// deal.
//
// Run:  deno test --allow-env --allow-net supabase/functions/_shared/emailDelivery.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleEmailDeliveryEvent } from "./emailDelivery.ts";
import { isEmailStatsPayload, parseEmailStats } from "./emailStats.ts";

// ── A recording stub standing in for the database ────────────────────────────
interface Write { table: string; op: "insert" | "update"; row: Record<string, unknown>; match?: unknown }

function stubDb(subs: Record<string, unknown>[], lender: { id: string } | null = null) {
  const writes: Write[] = [];
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    // Rows this table would return for the filters accumulated so far.
    const rows = () => {
      if (table !== "deal_submissions") return [];
      return subs.filter((r) => {
        const sp = (r.sent_payload ?? {}) as Record<string, unknown>;
        if (filters["sent_payload->>smtp_message_id"] !== undefined) {
          return sp.smtp_message_id === filters["sent_payload->>smtp_message_id"];
        }
        if (filters["sent_payload->>to"] !== undefined) return sp.to === filters["sent_payload->>to"];
        if (filters.lender_id !== undefined) return r.lender_id === filters.lender_id;
        return false;
      });
    };
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
      gte: () => chain, lte: () => chain, order: () => Promise.resolve({ data: rows(), error: null }),
      limit: () => chain,
      maybeSingle: () => {
        if (table === "lenders") return Promise.resolve({ data: lender, error: null });
        const r = rows();
        return Promise.resolve({ data: r[0] ?? null, error: null });
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, op: "insert", row });
        return Promise.resolve({ error: null });
      },
      update: (row: Record<string, unknown>) => ({
        eq: (_k: string, v: unknown) => {
          writes.push({ table, op: "update", row, match: v });
          return Promise.resolve({ error: null });
        },
      }),
    };
    Object.assign(q, chain);
    return chain;
  };
  // get_ghl_config is made to fail so the owner-alert path exits immediately:
  // these tests assert the DATA writes, and sending mail is not under test.
  const db = { from: builder, rpc: () => Promise.reject(new Error("stub: no ghl config")) };
  return { db: db as unknown as Parameters<typeof handleEmailDeliveryEvent>[0], writes };
}

const SUB = {
  id: "sub-1", deal_id: "deal-1", lender_id: "lender-1",
  submitted_at: "2026-09-30T20:47:54.000Z",
  sent_payload: { to: "submissions@highlandhillcap.com", cc: ["socrates73@gmail.com"] },
  deal: { deal_number: "MF-2026-0418" },
  lender: { company_name: "Highland Hill Capital" },
};
const SUB2 = {
  ...SUB, id: "sub-2", deal_id: "deal-2",
  submitted_at: "2026-09-30T20:51:40.000Z",
  deal: { deal_number: "MF-2026-0421" },
};

/** The real LCEmailStats envelope, per GHL's own schema doc. */
function lcEvent(over: Record<string, unknown>, ds: Record<string, unknown> = {}) {
  return {
    type: "LCEmailStats",
    locationId: "t7NmVR4WCy927j4Zon4b",
    webhookPayload: {
      event: "delivered",
      id: "evt-" + Math.random().toString(36).slice(2),
      timestamp: 1790801282, // seconds, as Mailgun sends them
      message: {
        attachments: [],
        headers: {
          "message-id": "<20260930204802.1@send.mfunding.net>",
          from: "Momentum Funding <sales@send.mfunding.net>",
          to: "submissions@highlandhillcap.com",
        },
        size: 1725,
      },
      recipient: "submissions@highlandhillcap.com",
      "recipient-domain": "highlandhillcap.com",
      "recipient-provider": "Microsoft",
      "delivery-status": { "attempt-no": 1, code: 250, message: "OK", "enhanced-code": "", ...ds },
      ...over,
    },
  } as Record<string, unknown>;
}

const find = (w: Write[], table: string, op: Write["op"]) => w.filter((x) => x.table === table && x.op === op);

// ── 1. The headline case: a permanent 550 to the funder's own inbox ─────────
Deno.test("a 5xx to the submission's to: address marks it undelivered", async () => {
  const { db, writes } = stubDb([SUB]);
  const evt = lcEvent(
    { event: "failed", recipient: "submissions@highlandhillcap.com" },
    { code: 550, message: "550 5.1.10 RESOLVER.ADR.RecipientNotFound", "enhanced-code": "5.1.10", "mx-host": "highlandhillcap-com.mail.protection.outlook.com" },
  );
  assert(isEmailStatsPayload(evt), "router must recognise an LCEmailStats payload");

  const r = await handleEmailDeliveryEvent(db, evt);
  assertEquals(r.outcome, "processed");
  assertEquals(r.result.permanent, true);
  assertEquals(r.result.submissionId, "sub-1");

  const ledger = find(writes, "email_delivery_events", "insert");
  assertEquals(ledger.length, 1);
  assertEquals(ledger[0].row.event, "failed");
  assertEquals(ledger[0].row.severity, "permanent");
  assertEquals(ledger[0].row.recipient_role, "to");
  assertEquals(ledger[0].row.smtp_code, 550);
  assertEquals(ledger[0].row.smtp_enhanced_code, "5.1.10");
  assertEquals(ledger[0].row.match_rung, "recipient_unique");

  const upd = find(writes, "deal_submissions", "update");
  // One binds the Message-ID, one records the failure.
  const failPatch = upd.find((u) => u.row.delivery_failed_at !== undefined);
  assert(failPatch, "the submission must be stamped delivery_failed_at");
  assertEquals(failPatch!.row.status, "pending");
  assert(String(failPatch!.row.delivery_error).includes("550"), "the SMTP reply must survive into delivery_error");
  // The code appears ONCE: Mailgun's own message already opens with it, and the
  // first live replay produced "550 5.1.10 550 5.1.10 RESOLVER..." — which reads
  // as a broken parser in the one line a processor is meant to trust.
  assertEquals(String(failPatch!.row.delivery_error).match(/550/g)?.length, 1);
  assertEquals(String(failPatch!.row.delivery_error).match(/5\.1\.10/g)?.length, 1);
  // submitted_at is deliberately NOT cleared — we really did send it.
  assertEquals(failPatch!.row.submitted_at, undefined);

  const act = find(writes, "activity_log", "insert");
  assertEquals(act.length, 1);
  assert(String(act[0].row.subject).includes("delivery-failed"));
  assertEquals(act[0].row.entity_id, "deal-1");
});

// ── 2. The positive fact we never had ──────────────────────────────────────
Deno.test("a delivered to the to: address stamps delivered_at and nothing else", async () => {
  const { db, writes } = stubDb([SUB]);
  const r = await handleEmailDeliveryEvent(db, lcEvent({ event: "delivered" }));
  assertEquals(r.outcome, "processed");
  assertEquals(r.result.event, "delivered");

  const ledger = find(writes, "email_delivery_events", "insert");
  assertEquals(ledger[0].row.event, "delivered");
  assertEquals(ledger[0].row.recipient_role, "to");

  const upd = find(writes, "deal_submissions", "update");
  const d = upd.find((u) => u.row.delivered_at !== undefined);
  assert(d, "delivered_at must be stamped");
  assertEquals(d!.row.delivered_to, "submissions@highlandhillcap.com");
  // A delivery is not an open and must not touch the open columns or the status.
  assertEquals(d!.row.opened_at, undefined);
  assertEquals(d!.row.status, undefined);
  assertEquals(find(writes, "activity_log", "insert").length, 0);
});

// ── 3. The first refusal: a deferral is not a failure ──────────────────────
Deno.test("a 4xx deferral records the event and un-delivers nothing", async () => {
  const { db, writes } = stubDb([SUB]);
  const evt = lcEvent(
    { event: "failed", severity: "temporary" },
    { code: 451, message: "451 4.7.1 Greylisted, try again later" },
  );
  const r = await handleEmailDeliveryEvent(db, evt);
  assertEquals(r.outcome, "processed");
  assertEquals(r.result.permanent, undefined);

  const ledger = find(writes, "email_delivery_events", "insert");
  assertEquals(ledger[0].row.severity, "temporary");
  // Nothing may claim this submission failed — Mailgun is still retrying.
  const upd = find(writes, "deal_submissions", "update");
  assertEquals(upd.filter((u) => u.row.delivery_failed_at !== undefined).length, 0);
  assertEquals(upd.filter((u) => u.row.status !== undefined).length, 0);
  assertEquals(find(writes, "activity_log", "insert").length, 0);
});

// ── 4. The second refusal: the Highland Hill shape ─────────────────────────
Deno.test("an ambiguous permanent failure picks no deal and parks instead", async () => {
  const { db, writes } = stubDb([SUB, SUB2]);
  const evt = lcEvent({ event: "failed" }, { code: 550, message: "550 5.1.10 RecipientNotFound" });
  const r = await handleEmailDeliveryEvent(db, evt);

  // The outcome is an ERROR, not a quiet success: something actionable arrived
  // and we could not place it.
  assertEquals(r.outcome, "error");
  assertEquals(r.result.rung, "unplaced_ambiguous");

  const ledger = find(writes, "email_delivery_events", "insert");
  assertEquals(ledger[0].row.deal_submission_id, null);
  assertEquals((ledger[0].row.candidates as unknown[]).length, 2);

  // No submission may be marked undelivered on a guess.
  assertEquals(find(writes, "deal_submissions", "update").length, 0);
  // It is parked where a human looks…
  const parked = find(writes, "ghl_webhook_events", "insert");
  assertEquals(parked.length, 1);
  assertEquals(parked[0].row.event_type, "EmailDeliveryFailedUnplaced");
  assert(String(parked[0].row.detail).includes("MF-2026-0418"));
  assert(String(parked[0].row.detail).includes("MF-2026-0421"));
  // …and said on BOTH candidate deals, since the park alone is a page nobody
  // has open.
  const notes = find(writes, "activity_log", "insert");
  assertEquals(notes.length, 2);
  assertEquals(new Set(notes.map((n) => n.row.entity_id)), new Set(["deal-1", "deal-2"]));
});

// ── 5. The masking bug, from the other side ────────────────────────────────
Deno.test("a bounce of OUR cc copy leaves the submission alone", async () => {
  const { db, writes } = stubDb([SUB]);
  const evt = lcEvent(
    { event: "failed", recipient: "socrates73@gmail.com", "recipient-domain": "gmail.com" },
    { code: 550, message: "550 mailbox full" },
  );
  const r = await handleEmailDeliveryEvent(db, evt);
  assertEquals(r.outcome, "processed");
  assertEquals(r.result.role, "cc");

  assertEquals(find(writes, "email_delivery_events", "insert")[0].row.recipient_role, "cc");
  // The funder's own copy is unaffected — the submission must not be touched.
  assertEquals(find(writes, "deal_submissions", "update").filter((u) => u.row.delivery_failed_at !== undefined).length, 0);
  assertEquals(find(writes, "ghl_webhook_events", "insert")[0].row.event_type, "EmailDeliveryFailedCc");
});

// ── 6. The app-free path, handled as the weaker signal it is ───────────────
Deno.test("a workflow-shaped Bounced resolves by contact and carries no invented SMTP detail", async () => {
  const { db, writes } = stubDb([SUB], { id: "lender-1" });
  const evt = {
    customData: { type: "EmailDeliveryEvent", email_event: "bounced", contactId: "ghl-contact-1" },
  } as Record<string, unknown>;
  assert(isEmailStatsPayload(evt), "the workflow shape must also route here");

  const r = await handleEmailDeliveryEvent(db, evt);
  assertEquals(r.outcome, "processed");
  assertEquals(r.result.rung, "contact_unique");

  const row = find(writes, "email_delivery_events", "insert")[0].row;
  assertEquals(row.event, "failed");
  assertEquals(row.severity, "permanent"); // GHL's Bounced filter IS the hard-bounce one
  assertEquals(row.smtp_code, null);       // and it tells us nothing more than that
  assertEquals(row.smtp_message, null);
  assert(find(writes, "deal_submissions", "update").some((u) => u.row.delivery_failed_at !== undefined));
});

// ── 7. The router must not have gained an appetite ─────────────────────────
Deno.test("ordinary GHL events are not email-stats payloads", () => {
  for (const evt of [
    { type: "OpportunityStageUpdate", opportunity: { id: "o1" }, contact: { id: "c1" } },
    { type: "ContactCreate", contact: { id: "c1", email: "a@b.com" } },
    { type: "InboundMessage", contactId: "c1", messageType: "Email", body: "hi" },
    // A flat workflow opportunity payload — the shape that actually arrives today.
    { id: "o1", pipeline_id: "bG9ZEh4eP9x60E1CyaMx", contact_id: "c1", opportunity_name: "X" },
  ]) {
    assertEquals(isEmailStatsPayload(evt as Record<string, unknown>), false, JSON.stringify(evt).slice(0, 60));
  }
});

// ── 8. Unit-level traps the handler depends on ─────────────────────────────
Deno.test("timestamps are seconds, and an unproven failure stays unproven", () => {
  const p = parseEmailStats(lcEvent({ event: "failed" }, { code: null, message: "" }))!;
  assertEquals(p.severity, null, "no code and no severity means UNKNOWN, not permanent");
  const d = parseEmailStats(lcEvent({ event: "delivered", timestamp: 1790801282 }))!;
  assertEquals(d.occurredAt.slice(0, 4), "2026", "a seconds timestamp read as ms lands in 1970");
});
