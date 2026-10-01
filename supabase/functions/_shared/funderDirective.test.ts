// funderDirective tests — BOTH DIRECTIONS, on real bodies copied verbatim out of
// public.funder_replies.
//
// A detector that flags everything is exactly as useless as one that flags
// nothing, so this file asserts both: the Uplyft address change goes RED, and
// the ordinary declines, acknowledgements and the stray court-case citation
// stay GREEN. The bodies below are not invented samples — each one is a real
// captured reply, with its funder_replies.id in the comment, so the asserts can
// be traced back to the row they came from.
//
// Run: deno test --allow-none supabase/functions/_shared/funderDirective.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectDirectives } from "./funderDirective.ts";
import { coreBody } from "./funderDecline.ts";

const detect = (body: string) => detectDirectives(coreBody(body));
const kinds = (body: string) => detect(body).map((d) => d.kind);

// ── MUST FIRE ───────────────────────────────────────────────────────────────

// funder_replies 598cfc5c-6673-4ed0-a157-3b70222d81f5 — Scott Villavicencio,
// Uplyft Capital, 2026-09-17. THE case this whole feature exists for: filed as
// response_type 'other', never read, and twelve days later MF-2026-0366 and
// MF-2026-0385 both went to the retired inbox and got silence.
const UPLYFT = `Hi! Quick update: Effective immediately, please send all new deal submissions to submissions@uplyftcapital.com . Please stop sending submissions to underwriting@uplyftcapital.com , as that inbox is now reserved for internal underwriting communication. This change will help us process your deals faster and avoid delays. Please update your records and begin using the new email immediately. Thank you! -- Thank you, Scott Villavicencio | Senior Funding Advisor Phone . 754-732-1153 | Fax . (305) 999-5312 Email . scott@uplyftcapital.com`;

Deno.test("the Uplyft address change is flagged", () => {
  const d = detect(UPLYFT).find((x) => x.kind === "submission_email_change");
  assert(d, "the reply that cost us two dead submissions must be flagged");
  // The two addresses must not be swapped. An inversion here would tell a human
  // to abandon the only inbox that works — an earlier version of the rule did
  // exactly that, because a ±160-char window around the new address catches the
  // word "stop" from the next sentence.
  assertEquals(d!.new_email, "submissions@uplyftcapital.com");
  assertEquals(d!.retired_email, "underwriting@uplyftcapital.com");
  assert(d!.matched_phrases.includes("effective immediately"));
  assert(d!.evidence_quote.includes("underwriting@uplyftcapital.com"));
});

// funder_replies 1cfbfd86-3789-4c95-8b00-8382194852ea — True Advance, 2026-07-06.
Deno.test("a standing 'all submissions go to this address' is flagged", () => {
  const d = detect(
    `All submissions need to be sent to this email submissions@trueadvancefunding.com and CC me jc@trueadvance.biz so i can see that it is being worked on in underwriting.`,
  ).find((x) => x.kind === "submission_email_change");
  assert(d);
  assertEquals(d!.new_email, "submissions@trueadvancefunding.com");
});

// funder_replies 9ae239cc-2372-48ff-a412-7892d05549f1 — Funding Metrics /
// Lendini, 2026-07-07. Also carries the portal warning.
Deno.test("a funder moving submissions to a portal is flagged", () => {
  const k = kinds(
    `Please send all deals to submissions@lendini.com and cc your Account Manager, Mia Stephenson using the email mia.stephenson@lendini.com We offer an API submissions connection! (Please note that all submissions will need to be sent either API or Portal in the very near future) Lendini Portal You should receive credentials to the Funding Metrics Portal via email within the next few minutes.`,
  );
  assert(k.includes("submission_email_change"));
  assert(k.includes("use_portal"));
});

// ── MUST NOT FIRE ───────────────────────────────────────────────────────────

Deno.test("ordinary declines are not flagged", () => {
  // funder_replies 8c8322c1-4dac-4c02-af01-a0b7a9b5f46f — 1 West on MF-2026-0418.
  assertEquals(kinds(`Declined Reasons- Ineligible due to recent decline`), []);
  // funder_replies 2289865a-64dd-4dad-a395-7b0f828f4cd8 — Green Note on MF-2026-0418.
  assertEquals(kinds(`declined for 526 credit`), []);
  // Green Note on MF-2026-0138 — a decline that names documents and a reason.
  assertEquals(
    kinds(`Unfortunately we have to pass on this one. Debt collection activity showing in the bank statements.`),
    [],
  );
});

Deno.test("the stray court-case citation is not flagged", () => {
  // funder_replies 2958cb2c-2734-42ed-bfd4-48180edd281b — the other row that sat
  // in response_type 'other'. Correctly non-actionable: it must stay that way.
  assertEquals(
    kinds(
      `SAGE CREEK CAPITAL, LLC v. BLACK HILLS MANAGEMENT CORP. et al Erie County Supreme Court Commercial and Trade Jan 21, 2026 Open Party Defensive #801180/2026`,
    ),
    [],
  );
});

Deno.test("a one-off 'send me this file' is not a recipe change", () => {
  // funder_replies 1d6d0089-8066-4ea1-97f7-788add173708 — Jeff at Uplyft asking
  // for ONE file on ONE deal. Real, urgent, and correctly not a standing
  // instruction: if this landed in the queue the queue would be noise by week
  // two and nobody would read the one row that mattered.
  assertEquals(
    kinds(
      `Hello Ernesto, Please forward the file to me directly. It doesn't appear that we received it, and it is not reflecting in the portal. Thank you, Jeff Soulouque | ISO Manager Email. jeffs@uplyftcapital.com`,
    ),
    [],
  );
});

Deno.test("a signature block is not a submission address", () => {
  // Every funder email ends in one of these. A body-wide match on "email" plus
  // "deals" plus an address treats all of them as routing instructions.
  assertEquals(
    kinds(
      `got it - thanks Thank you, Jeff Soulouque | ISO Manager Phone. (954) 834-6321 Email. jeffs@uplyftcapital.com Sign-up link https://daydreamos.com/broker-intake/uplyft-capital`,
    ),
    [],
  );
});

Deno.test("a marketing blast's own footer is not a routing instruction", () => {
  // funder_replies 25f970f7-8d59-4588-9aa3-d26778c80080 — ROK Financial,
  // 2026-07-29. Fired on the word "future" in "unsubscribe from future emails"
  // and proposed the sender's byline as our new submissions inbox.
  assertEquals(
    kinds(
      `Refer deals and earn. Upload your referrals and we handle the rest. Best, Anthony Cerchia acerchia@rok.biz (631) 459-5705 To unsubscribe from future emails or to update your email preferences, click here .`,
    ),
    [],
  );
});

Deno.test("OUR OWN submission email quoted back is never read as the funder's words", () => {
  // funder_replies 995f5780-56d1-41dd-90a1-03cf1f7114f6 — 1 West, 2026-08-11,
  // the real body, verbatim head. coreBody()'s quote-header cap was 80 chars
  // and 1 West's header is 99, so the strip silently failed and our whole 6KB
  // submission survived as "what the funder wrote". The detector then read the
  // merchant's personal address off our own "Owner email:" line and proposed
  // `bayfinish@gmail.com` as the funder's new submissions inbox. Nothing
  // auto-applies, so nothing reached a mailbox — but the proposal was to
  // redirect a merchant's bank statements to an address lifted out of our own
  // email.
  const ONE_WEST = `Received On Tue, Aug 11, 2026 at 10:52 AM Momentum Funding via Partner Submissions partnersubs@1westfinance.com wrote: New submission from Momentum Funding (ISO) for your review. Business: Bay Finish Construction LLC Owner: Robert Gaar Industry: construction State: CA EIN: — Time in business: — Monthly revenue: $35,000 Amount requested: $25,000 Use of funds: Working capital Owner phone: +18319157959 Owner email: bayfinish@gmail.com Deal #: MF-2026-0163 Documents: Signed application (04B_MCA_PREFILL.pdf) — https://ehibjeonqpqskhcvizow.supabase.co/storage/v1/object/sign/customer-documents/x.pdf?token=abc This is a purchase of future receivables (MCA) — not a loan. Reply with any questions. — Kristine, Momentum Funding Submissions`;
  assertEquals(kinds(ONE_WEST), []);
  // Belt-and-braces: with the quote strip bypassed entirely, it still refuses.
  // A detector that is only correct when its caller is correct is not a check.
  assertEquals(detectDirectives(ONE_WEST).map((d) => d.kind), []);
});

Deno.test("the own-template guard is what stops a merchant's address being proposed", () => {
  // ⚠ THIS TEST EXISTS BECAUSE THE GUARD HAD NEVER FIRED.
  //
  // Disabling isOwnTemplate() changed NOTHING on any of the 156 captured
  // replies — on the real 1 West bodies the destination-preposition rule and
  // the standing-cue rule already reject them, so the own-template guard was
  // a check that had never once been the reason for an answer. Per
  // `a-fix-can-make-a-lie-more-specific`: a check you have never seen fail is
  // not a check.
  //
  // So this body is built to pass every OTHER guard and leave the own-template
  // guard as the only thing standing. The colon in "Owner email:" satisfies the
  // destination-preposition rule, "send"/"submissions" sit in the window, and
  // "Going forward" supplies the standing cue — which a per-funder recipe
  // body_template could easily introduce, since those are free text we write
  // ourselves. Comment out isOwnTemplate's body and this test goes red while
  // every other test stays green.
  const CRAFTED = `Owner phone: +18319157959 Owner email: bayfinish@gmail.com Deal #: MF-2026-0163 Going forward, please send all new deal submissions quoting this deal number.`;
  const d = detectDirectives(CRAFTED);
  assertEquals(
    d.map((x) => x.new_email),
    [],
    "a merchant's personal address out of our own template must never be proposed as a funder destination",
  );
});

Deno.test("our own addresses are never proposed as a funder destination", () => {
  assertEquals(
    kinds(`Going forward please send all submissions to sales@send.mfunding.net instead.`),
    [],
  );
});

// ── Recall: a standing instruction needs no adverb of time ──────────────────

Deno.test("Instagreen's two un-cued requests are flagged", () => {
  // funder_replies 45843ed5 (2026-07-06) and f9a48560 (2026-08-13). Instagreen
  // asked THREE times for submissions to go to isabel@instagreencapital.com and
  // the detector originally caught ONE, because the other two carried no
  // "effective immediately" / "going forward" cue — they were just standing
  // facts about how the funder takes deals. Our recipe sent to submit@, her CC
  // address, for three months.
  const a = detect(
    `Submission instructions Please send files to isabel@instagreencapital.com Cc submit@instagreencapital.com for faster processing`,
  ).find((d) => d.kind === "submission_email_change");
  assert(a, "a plural routing object is standing on its own");
  assertEquals(a!.new_email, "isabel@instagreencapital.com");

  const b = detect(
    `Please send submissions directly to isabel@instagreencapital.com and CC submit@instagreencapital.com . I've also attached our current guidelines.`,
  ).find((d) => d.kind === "submission_email_change");
  assert(b);
  assertEquals(b!.new_email, "isabel@instagreencapital.com");
});

Deno.test("a mail gateway's anti-phishing banner is not a submissions inbox", () => {
  // funder_replies a659527e — Kapitus Partners, 2026-07-20. An ISO onboarding
  // questionnaire whose security header got read as a routing instruction:
  // "forward" was the verb, and "deals" came from the questionnaire 150
  // characters away. It proposed cybersecurity@kapitus.com as their
  // submissions inbox. Comment out isSecurityBanner's body and this goes red.
  assertEquals(
    kinds(
      `Subject: Follow-Up: Kapitus ISO Partner Program This email originated from outside of Kapitus. If this message or attachments are unusual or unexpected in your typical business interactions please forward to cybersecurity@kapitus.com. Good afternoon, which lenders are you currently funding deals with?`,
    ),
    [],
  );
});

Deno.test("a one-off singular file request still does not fire", () => {
  // The recall widening is strict-plural on purpose. `/\bfiles?\b/` would have
  // matched "the file" and pulled every one-deal request back into the queue.
  assertEquals(
    kinds(`Please send the file to me at jeffs@uplyftcapital.com so I can look at it today.`),
    [],
  );
});

// ── The four false positives the team lead caught, kept dead ────────────────
//
// All five rows in the first actionable queue were reviewed by hand. FOUR were
// wrong, and two of those would have moved submissions off a working address.
// A queue that cries wolf four times out of five teaches a processor to dismiss
// the fifth, which is the Scott reply all over again — so each one gets a test.

Deno.test("True Advance: a signature block is not a second submissions inbox", () => {
  // funder_replies 977d5e41, 2026-08-10. We send to
  // submissions@trueadvancefunding.com, which has replied to us by name. The
  // detected address came out of the Submissions Team's own sign-off.
  assertEquals(
    kinds(
      `Received, we will review. -- Highest regards, Submissions Team True Advance P: 551-341-1453 E: submissions@trueadvance.biz www.trueadvance.biz`,
    ),
    [],
  );
});

Deno.test("Velocity: the rep's address loses to the inbox named in the same email", () => {
  // funder_replies 92c2ea0e, 2026-07-07. "Email: jesse@velocitycg.com" is the
  // ISO rep; the same message says "To Subs@velocitycg.com" and "Deal
  // Submissions: Subs@velocitycg.com". Acting on jesse@ would have routed a
  // merchant's file to a salesperson's mailbox, off the funder's stated inbox.
  const d = detect(
    `Your ISO Representative is Jesse Guzman Email: jesse@velocitycg.com Phone: 516-202-2202 To submit your file please send One-page Funding Application To Subs@velocitycg.com Contact us General Email: Info@velocitycg.com Deal Submissions: Subs@velocitycg.com`,
  ).find((x) => x.kind === "submission_email_change");
  assert(d, "the inbox IS named here, so this should still detect something");
  assertEquals(d!.new_email, "subs@velocitycg.com");
});

Deno.test("'Submissions Email:' is still a designation, not a signature", () => {
  // The guard keys on what precedes the label, so this must survive it.
  // funder_replies 33b93a92 — Capital Express.
  const d = detect(
    `Underwriting Guidelines Submission Requirements Submissions Email: underwriting@capitalexpressllc.com .`,
  ).find((x) => x.kind === "submission_email_change");
  assert(d);
  assertEquals(d!.new_email, "underwriting@capitalexpressllc.com");
});

Deno.test("Instagreen: 'add them to our system' is not a portal instruction", () => {
  // funder_replies b9ead23a. "let me know which members of your team we will be
  // working with so we can add them to our system" is "add your staff to our
  // CRM". It sat in the actionable queue as a submission-method change.
  assert(
    !kinds(
      `Please send all submissions to: Isabel@instagreencapital.com Cc submit@instagreencapital.com Additionally, please let me know which members of your team we will be working with so we can add them to our system and ensure they are properly set up on our end.`,
    ).includes("use_portal"),
  );
});

Deno.test("Lendini: naming the account manager on day one is not a contact change", () => {
  // funder_replies 9ae239cc. `send .{0,20}to` was in the CONTACT-CHANGE cue
  // list, so every "please send all deals to X and cc your Account Manager"
  // read as the contact having changed. Nothing had changed; it was onboarding.
  assert(
    !kinds(
      `Please send all deals to submissions@lendini.com and cc your Account Manager, Mia Stephenson using the email mia.stephenson@lendini.com`,
    ).includes("contact_change"),
  );
});

Deno.test("a real portal move and a real contact change still fire", () => {
  // Tightening both cue lists must not have switched the kinds off entirely.
  assert(kinds(
    `Please note that all submissions will need to be sent either API or Portal in the very near future. You should receive credentials to the Funding Metrics Portal via email.`,
  ).includes("use_portal"));
  assert(kinds(
    `Jesse has left the company. Going forward your new ISO representative is Dana Ruiz, please contact her at dana@example-funder.com for anything on your files.`,
  ).includes("contact_change"));
});
