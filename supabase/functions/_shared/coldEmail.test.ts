// deno test supabase/functions/_shared/coldEmail.test.ts
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  INDUSTRY_FALLBACK, buildInstantlyLead, classifyEvent, decideEnrollment, eventKey,
  isOptOutReply, nameParts, ownReplyText, parseEnrollPayload, parseInstantlyEvent,
  timingSafeEqualStr, worstHealth,
} from "./coldEmail.ts";
import { normaliseLeadVerdict } from "./coldEmailStore.ts";

Deno.test("enroll payload: customData wins, industry falls back, email lower-cased", () => {
  const p = parseEnrollPayload({
    contact_id: "top", email: "Top@X.com", first_name: "Top",
    customData: { contact_id: "cd", email: " Owner@Shop.COM ", company_name: "Shop LLC", industry: "" },
  });
  assertEquals(p.contactId, "cd");
  assertEquals(p.email, "owner@shop.com");
  assertEquals(p.firstName, "Top");
  assertEquals(p.companyName, "Shop LLC");
  assertEquals(p.industry, INDUSTRY_FALLBACK);
  assert(p.industryWasFallback);
  assertEquals(p.test, false);
});

Deno.test("enroll payload: an unresolved GHL merge tag is blank, not an industry", () => {
  const p = parseEnrollPayload({ customData: { industry: "{{contact.industry}}" } });
  assertEquals(p.industry, INDUSTRY_FALLBACK);
  const q = parseEnrollPayload({ customData: { industry: "Trucking", test: "true" } });
  assertEquals(q.industry, "Trucking");
  assertEquals(q.test, true);
});

Deno.test("verification gate: only 'verified' enrolls", () => {
  assertEquals(decideEnrollment("verified", { suppressed: false }), "enroll");
  assertEquals(decideEnrollment("invalid", { suppressed: false }), "refuse_invalid");
  assertEquals(decideEnrollment("bounced", { suppressed: false }), "refuse_bounced");
  assertEquals(decideEnrollment("catch_all", { suppressed: false }), "refuse_unverifiable");
  assertEquals(decideEnrollment("risky", { suppressed: false }), "refuse_unverifiable");
  assertEquals(decideEnrollment(null, { suppressed: false }), "verify_first");
  assertEquals(decideEnrollment("unknown", { suppressed: false }), "verify_first");
  // after an on-the-fly check, "still unknown" must refuse, not loop
  assertEquals(decideEnrollment("unknown", { suppressed: false, afterVerification: true }), "refuse_unverifiable");
  // suppression beats a pass
  assertEquals(decideEnrollment("verified", { suppressed: true }), "refuse_suppressed");
});

Deno.test("worst verdict wins; proof outranks prediction", () => {
  assertEquals(worstHealth(["verified", "bounced", null]), "bounced");
  assertEquals(worstHealth(["verified", "catch_all"]), "catch_all");
  assertEquals(worstHealth(["verified"]), "verified");
  assertEquals(worstHealth([null, undefined, "nonsense"]), null);
});

Deno.test("lead_records vocabulary folds onto EmailHealth", () => {
  assertEquals(normaliseLeadVerdict("valid"), "verified");
  assertEquals(normaliseLeadVerdict("ACCEPT_ALL"), "catch_all");
  assertEquals(normaliseLeadVerdict("invalid"), "invalid");
  assertEquals(normaliseLeadVerdict("pending"), "unknown");
});

Deno.test("instantly lead body carries industry + the GHL contact id back to us", () => {
  const b = buildInstantlyLead("camp-1", parseEnrollPayload({ customData: { contact_id: "c1", email: "a@b.co", first_name: "A" } }));
  assertEquals(b.campaign, "camp-1");
  assertEquals(b.skip_if_in_campaign, true);
  assertEquals((b.custom_variables as Record<string, string>).ghl_contact_id, "c1");
  assertEquals((b.custom_variables as Record<string, string>).industry, INDUSTRY_FALLBACK);
});

const reply = (text: string) => parseInstantlyEvent({
  event_type: "reply_received", lead_email: "Owner@Shop.com", campaign_id: "c", timestamp: "t", reply_text: text,
});

Deno.test("classify: replies, labels, clicks, unsubscribes, bounces, unknowns", () => {
  assertEquals(classifyEvent(reply("Yes, call me at 3")).action, "reply");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "lead_interested", lead_email: "a@b.co" })).action, "reply");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "link_clicked", lead_email: "a@b.co" })).action, "click");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "lead_unsubscribed", lead_email: "a@b.co" })).action, "unsubscribe");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "email_bounced", lead_email: "a@b.co" })).action, "bounce");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "My Custom Label", lead_email: "a@b.co" })).action, "park");
  assertEquals(classifyEvent(parseInstantlyEvent({})).action, "park");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "reply_received" })).action, "park"); // no lead_email
});

Deno.test("opt-out replies take the unsubscribe path, not a deal", () => {
  assert(isOptOutReply("STOP"));
  assert(isOptOutReply("Please remove me from your list"));
  assert(isOptOutReply("unsubscribe\n\nOn Mon, Nov 16, 2026 Ernesto wrote:\n> Not interested? Reply \"stop\""));
  assert(!isOptOutReply("Stop by our shop on Tuesday, I'd like to talk about $20k for equipment."));
  assert(!isOptOutReply("Sounds good, how much can I get?\n\nOn Mon wrote:\n> Reply \"stop\" and you won't hear from us"));
  assertEquals(classifyEvent(reply("stop")).action, "unsubscribe");
});

Deno.test("own reply text drops quoted history", () => {
  assertEquals(ownReplyText("Yes please\n> quoted\n> more"), "Yes please");
  assertEquals(ownReplyText("Call me\nOn Tue, Nov 17, 2026 at 9:00 AM Carlos wrote:\nold"), "Call me");
});

Deno.test("event key: stable for a redelivery, distinct across events, prefers an explicit id", async () => {
  const b = { event_type: "reply_received", lead_email: "a@b.co", campaign_id: "c", timestamp: "2026-11-16T10:00:00Z", email_id: "e1" };
  const k1 = await eventKey(b, parseInstantlyEvent(b));
  const k2 = await eventKey({ ...b }, parseInstantlyEvent({ ...b }));
  assertEquals(k1, k2);
  const other = { ...b, event_type: "lead_interested" };
  assertNotEquals(k1, await eventKey(other, parseInstantlyEvent(other)));
  assertEquals(await eventKey({ ...b, id: "evt_9" }, parseInstantlyEvent(b)), "id:evt_9");
});

Deno.test("lead fields + our custom variable are read from nested payloads too", () => {
  const ev = parseInstantlyEvent({ event_type: "reply_received", lead_email: "a@b.co", payload: { ghl_contact_id: "g1", company_name: "Co" } });
  assertEquals(ev.ghlContactId, "g1");
  assertEquals(ev.companyName, "Co");
});

Deno.test("names never come back empty (customers.first_name is NOT NULL)", () => {
  assertEquals(nameParts("", "", "john.smith@x.com").first, "John smith");
  assertEquals(nameParts("", "", "123@x.com").first, "Cold email");
  assertEquals(nameParts("Ann", "", "x@y.z"), { first: "Ann", last: "" });
});

Deno.test("secret compare", () => {
  assert(timingSafeEqualStr("abc", "abc"));
  assert(!timingSafeEqualStr("abc", "abd"));
  assert(!timingSafeEqualStr("abc", "abcd"));
});

import { isMissingColumn } from "./coldEmailStore.ts";
Deno.test("a missing column is 'source absent' on SELECT (42703) AND on UPDATE (PGRST204)", () => {
  assert(isMissingColumn({ code: "42703" }));
  assert(isMissingColumn({ code: "PGRST204" }));
  assert(!isMissingColumn({ code: "42501" }));
  assert(!isMissingColumn(null));
});

Deno.test("click: both the documented and the subscribable spelling route to a call task", () => {
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "link_clicked", lead_email: "a@b.co" })).action, "click");
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "email_link_clicked", lead_email: "a@b.co" })).action, "click");
});

import { companyDomain, ghlEmailDnd, normCompany, suppressesAddress, suppressesCompany } from "./coldEmail.ts";

Deno.test("unknown industry is sent EMPTY so the template's {{industry | your industry}} fallback renders", () => {
  assertEquals(INDUSTRY_FALLBACK, "");
  assertEquals(parseEnrollPayload({}).industry, "");
  assertEquals(parseEnrollPayload({ customData: { industry: "{{contact.industry}}" } }).industry, "");
  const b = buildInstantlyLead("c", parseEnrollPayload({ customData: { email: "a@b.co" } }));
  assert("industry" in (b.custom_variables as Record<string, unknown>));
  assertEquals((b.custom_variables as Record<string, string>).industry, "");
});

Deno.test("suppression: ANY reply/label/unsub/bounce suppresses the address; sends/opens/clicks do not", () => {
  for (const t of ["reply_received", "lead_interested", "lead_not_interested", "lead_neutral", "lead_meeting_booked",
    "lead_wrong_person", "custom_label_any_negative", "lead_unsubscribed", "email_bounced", "Some Custom Label"]) {
    assert(suppressesAddress(t), t);
  }
  // owner policy: an auto-reply / out-of-office alone is not a human reply
  for (const t of ["auto_reply_received", "lead_out_of_office",
    "email_sent", "email_opened", "link_clicked", "email_link_clicked", "campaign_completed", "account_error"]) {
    assert(!suppressesAddress(t), t);
    assert(!suppressesCompany(t), t);
  }
  assert(!suppressesAddress(null));
});

Deno.test("stop-for-company: replies and unsubscribes spread to the company, a bounce does not", () => {
  assert(suppressesCompany("reply_received"));
  assert(suppressesCompany("lead_unsubscribed"));
  assert(!suppressesCompany("email_bounced"));
  assert(!suppressesCompany("email_link_clicked"));
});

Deno.test("company identity: business domains count, consumer mail does not; names normalise", () => {
  assertEquals(companyDomain("Owner@JoesPizza.com"), "joespizza.com");
  assertEquals(companyDomain("joe@gmail.com"), null);
  assertEquals(companyDomain("joe@yahoo.com"), null);
  assertEquals(normCompany("Joe's Pizza, LLC"), normCompany("joes pizza"));
  assertEquals(normCompany("A & B Trucking Inc."), "a and b trucking");
  assertEquals(normCompany("LLC"), null);
  assertEquals(normCompany(""), null);
});

Deno.test("GHL email DND: global dnd or the Email channel active", () => {
  assert(ghlEmailDnd({ dnd: true }));
  assert(ghlEmailDnd({ dndSettings: { Email: { status: "active" } } }));
  assert(!ghlEmailDnd({ dndSettings: { Email: { status: "inactive" }, SMS: { status: "active" } } }));
  assert(!ghlEmailDnd(null));
});

Deno.test("negative labels + OOO are recorded (not parked); unknown labels still park", () => {
  for (const t of ["lead_not_interested", "lead_wrong_person", "lead_out_of_office", "custom_label_any_negative"]) {
    assertEquals(classifyEvent(parseInstantlyEvent({ event_type: t, lead_email: "a@b.co" })).action, "record", t);
  }
  assertEquals(classifyEvent(parseInstantlyEvent({ event_type: "My Custom Label", lead_email: "a@b.co" })).action, "park");
});
