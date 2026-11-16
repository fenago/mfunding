// bankLink tests — the two rules that go wrong silently.
//
//  1. REUSE. Every send minting a fresh token is the duplicate-document problem
//     one layer down: the merchant holds three links and uploads against
//     whichever one they find. The rule has to reuse a healthy token, refresh a
//     dying one, and NEVER hand out a token bound to a different deal.
//  2. THE SHAPE. contact.bank_statement_link holds the BARE TOKEN and
//     contact.ph_connect_bank_url holds the FULL URL, because the GHL document
//     composes `…/connect-bank/{{tag}}` itself. Feed the field a URL and the
//     merchant's link resolves to `…/connect-bank/https://…/connect-bank/<token>`
//     — populated everywhere we can see, dead in their hands. An exact-equality
//     read-back would happily confirm it, so the shape is gated before the write.
//  3. THE LOG. The link is a bearer credential for one merchant's file, and it
//     reaches GHL as `{ customFields: [{ id, value }] }` — a key name the
//     redactor can never match. A bare token has no "/connect-bank/" to latch
//     onto either, so it is redacted by the sibling FIELD ID. Both pinned here.
//
// A check nobody has watched fail is not a check, so each assertion below has a
// negative twin: flip MIN_REMAINING_DAYS, drop the deal-id comparison, loosen the
// token pattern or delete a redaction rule and a named test here goes red.
//
// Run: deno test supabase/functions/_shared/bankLink.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BANK_STATEMENT_LINK_FIELD_ID,
  bankLinkShapeError,
  bankLinkUrl,
  isBankLinkToken,
  isBankLinkUrl,
  type LiveTokenRow,
  MIN_REMAINING_DAYS,
  pickReusableToken,
} from "./bankLink.ts";
import { maskBankLinkTokens, redactForLog } from "./ghl.ts";

const TOKEN = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-02T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

const row = (token: string, dealId: string | null, days: number): LiveTokenRow => ({
  token, deal_id: dealId, expires_at: inDays(days),
});

Deno.test("a healthy token for the same deal is reused as-is", () => {
  const { match, needsExtension } = pickReusableToken([row("t1", "deal-a", 80)], "deal-a", NOW);
  assertEquals(match?.token, "t1");
  assertEquals(needsExtension, false);
});

Deno.test("a token running out is reused but refreshed, never left to die in the merchant's inbox", () => {
  const { match, needsExtension } = pickReusableToken(
    [row("t1", "deal-a", MIN_REMAINING_DAYS - 1)],
    "deal-a",
    NOW,
  );
  assertEquals(match?.token, "t1");
  assertEquals(needsExtension, true);
});

Deno.test("a token bound to ANOTHER deal is not reused — their statements would land on the wrong file", () => {
  const { match } = pickReusableToken([row("t1", "deal-a", 80)], "deal-b", NOW);
  assertEquals(match, null);
});

Deno.test("a deal-less token is not handed out for a known deal, and vice versa", () => {
  assertEquals(pickReusableToken([row("t1", null, 80)], "deal-a", NOW).match, null);
  assertEquals(pickReusableToken([row("t1", "deal-a", 80)], null, NOW).match, null);
  // …but a deal-less token IS right for a deal-less send.
  assertEquals(pickReusableToken([row("t1", null, 80)], null, NOW).match?.token, "t1");
});

Deno.test("an unparseable expiry is treated as dying, not as plenty of time", () => {
  const broken: LiveTokenRow = { token: "t1", deal_id: null, expires_at: "not a date" };
  const { match, needsExtension } = pickReusableToken([broken], null, NOW);
  assertEquals(match?.token, "t1");
  assertEquals(needsExtension, true);
});

Deno.test("no live token means mint — and only an EMPTY list may say so", () => {
  assertEquals(pickReusableToken([], "deal-a", NOW).match, null);
});

Deno.test("a URL is never accepted where the bare token belongs — the double-compose bug", () => {
  const url = bankLinkUrl(TOKEN);
  assertEquals(bankLinkShapeError(TOKEN, "token"), null);
  assert(bankLinkShapeError(url, "token"), "a URL was accepted into the bare-token field");
  assert(
    (bankLinkShapeError(url, "token") ?? "").includes("a URL"),
    "the refusal does not say WHAT was wrong with it",
  );
});

Deno.test("…and a bare token is never accepted where the full URL belongs", () => {
  assertEquals(bankLinkShapeError(bankLinkUrl(TOKEN), "url"), null);
  assert(bankLinkShapeError(TOKEN, "url"), "a bare token was accepted into the full-URL field");
  // A URL on some other host is not our link either.
  assert(bankLinkShapeError(`https://evil.example/connect-bank/${TOKEN}`, "url"), "a foreign host passed");
});

Deno.test("the token predicate rejects every URL-ish thing, not just ours", () => {
  assert(isBankLinkToken(TOKEN));
  assertEquals(isBankLinkToken(bankLinkUrl(TOKEN)), false);
  assertEquals(isBankLinkToken("https://my.mfunding.net"), false);
  assertEquals(isBankLinkToken("tok/with/slashes"), false);
  assertEquals(isBankLinkToken(""), false);
  assertEquals(isBankLinkToken("short"), false);
  assert(isBankLinkUrl(bankLinkUrl(TOKEN)));
});

Deno.test("the composed URL matches what the GHL template prefixes around the merge tag", () => {
  // The document body and the post-signing redirect both say
  // `https://my.mfunding.net/connect-bank/{{contact.bank_statement_link}}`.
  // If PORTAL_BASE ever drifts from that, the link we mint and the link the
  // merchant is sent stop being the same link.
  assertEquals(bankLinkUrl("TOKEN_HERE"), "https://my.mfunding.net/connect-bank/TOKEN_HERE");
});

Deno.test("a full URL in a log line keeps its shape but loses its token", () => {
  const masked = maskBankLinkTokens(`PUT failed for ${bankLinkUrl(TOKEN)}`);
  assert(!masked.includes("ab12cd34"), "the token is still in the log line");
  assert(masked.includes("https://my.mfunding.net/connect-bank/"), "the URL shape was lost");
});

Deno.test("redactForLog masks a BARE token by its field id — content masking cannot see it", () => {
  // Literally what updateContactCustomFields sends. The key is "value", so
  // key-name redaction cannot fire; the value is a bare token, so the
  // "/connect-bank/" content mask cannot fire either. Only the sibling id can.
  const body = { customFields: [{ id: BANK_STATEMENT_LINK_FIELD_ID, value: TOKEN }] };
  const logged = JSON.stringify(redactForLog(body));
  assert(!logged.includes("ab12cd34"), "the bank-link token leaked into the log body");
  assert(logged.includes("[redacted]"), "the field-id redaction did not fire");
  // An ordinary merge field alongside it is still readable — a redactor that
  // blanks everything teaches you nothing when a send fails.
  const mixed = {
    customFields: [
      { id: BANK_STATEMENT_LINK_FIELD_ID, value: TOKEN },
      { id: "uUpbL8PP2iGbGKkof7jX", value: "Acme Plumbing LLC" },
    ],
  };
  assert(JSON.stringify(redactForLog(mixed)).includes("Acme Plumbing LLC"));
});
