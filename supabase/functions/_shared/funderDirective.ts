// funderDirective — find the funder replies that tell us to CHANGE HOW WE SUBMIT,
// and park them somewhere a human has to answer for.
//
// THE FAILURE THIS EXISTS FOR (2026-09-17 → 2026-09-29, measured):
// Scott Villavicencio at Uplyft Capital replied on submission
// dbd565ba-12ec-4728-bb2a-9f525da3be0c (MF-2026-0196): "Effective immediately,
// please send all new deal submissions to submissions@uplyftcapital.com. Please
// stop sending submissions to underwriting@uplyftcapital.com, as that inbox is
// now reserved for internal underwriting communication."
//
// The pipeline did everything right except the last step. It received the reply,
// classified it, and wrote response_summary = "Funder is notifying the ISO to
// update their submission email to submissions@uplyftcapital.com and stop using
// the old underwriting inbox immediately." Then it filed it as
// response_type = 'other' — a bucket with NO READER — and nothing happened.
// Twelve days later MF-2026-0366 and MF-2026-0385 both went to
// underwriting@uplyftcapital.com and both got silence. The system understood the
// instruction, wrote down what it meant, and had no path from there to anything
// happening.
//
// ── TWO HARD RULES, both load-bearing ──────────────────────────────────────
//
// 1. NEVER AUTO-APPLY. An inbound email claiming to be from a funder, saying
//    "send submissions to this new address", is UNTRUSTED INPUT. Auto-applying
//    it means anyone who can spoof or compromise one reply thread redirects a
//    merchant's signed application and bank statements — full financial identity
//    documents — to a mailbox they control, and our own system does the
//    forwarding. One email, credential-grade breach. There is no trusted-sender
//    shortcut either: the attack IS a reply inside a known thread from a known
//    domain. So this module only ever DETECTS and writes a flag. It never
//    touches `lenders` or `funder_submission_profiles`. A person applies it.
//
// 2. NO LLM IN THE DETECTION PATH. The flag is produced by the rules below and
//    nothing else. The LLM summary, when one exists, is decoration on a row that
//    was already written. This is deliberate: the classifier that saw the Scott
//    reply is best-effort and wrapped in a bare `catch`, so a provider outage or
//    an empty account degrades it to silence — and silence here reads as
//    "nothing actionable", which is the exact lie we are fixing. A regex that
//    cannot reach the internet cannot go quiet.
//
// Every rule below requires its triggering words to co-occur in ONE SENTENCE.
// That is not stylistic. Funder signature blocks are wall-to-wall email
// addresses ("Email . scott@uplyftcapital.com"), and a body-wide match treats
// every signature as a routing instruction.

/** Kinds of instruction. Each one changes how the NEXT submission must be sent. */
export const DIRECTIVE_KINDS = [
  "submission_email_change",
  "use_portal",
  "new_required_docs",
  "contact_change",
] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export interface DetectedDirective {
  kind: DirectiveKind;
  /** The funder's own sentence. The human judges THIS, not our paraphrase. */
  evidence_quote: string;
  /** Which patterns fired, so the detection itself is reviewable. */
  matched_phrases: string[];
  /** The address the funder named as the new destination (email-change only). */
  new_email: string | null;
  /** The address the funder told us to STOP using (email-change only). */
  retired_email: string | null;
  /** A plain sentence written by the rule — never by a model. */
  summary: string;
}

// Addresses on our own side of the thread are never a funder's new destination.
const OUR_DOMAIN_RE = /(^|\.)(mfunding\.(net|com)|agenticvoice\.(ai|io|com)|momentumfunding\.(net|com))$/i;
// Free-mail providers: a funder redirecting submissions to gmail is possible but
// is exactly what a spoof looks like, so it still flags — it is NOT excluded
// here. This list only exists to label the risk on the row.
const FREEMAIL_RE = /^(gmail|yahoo|outlook|hotmail|aol|icloud|proton(mail)?)\./i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function isOurAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return OUR_DOMAIN_RE.test(email.slice(at + 1).toLowerCase());
}

export function isFreemail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return FREEMAIL_RE.test(email.slice(at + 1).toLowerCase());
}

/**
 * Split a flattened body into sentences.
 *
 * Funder emails are not prose — they are one-liners separated by newlines as
 * often as by periods, and an address like "submissions@uplyftcapital.com ."
 * has a space before its period. So: break on sentence punctuation followed by
 * whitespace, and on newlines, but NEVER inside an email address or a URL.
 */
export function sentencesOf(body: string): string[] {
  const protectedText = body
    // Shield the dots inside addresses/URLs from the splitter.
    .replace(EMAIL_RE, (m) => m.replace(/\./g, ""))
    .replace(/https?:\/\/\S+/g, (m) => m.replace(/\./g, ""));
  return protectedText
    .split(/(?<=[.!?;])\s+|[\r\n]+|•/)
    .map((s) => s.replace(//g, ".").trim())
    .filter((s) => s.length > 0);
}

// ── Pattern vocabulary ──────────────────────────────────────────────────────
// Each entry is [label, regex]. The label is what lands in matched_phrases, so a
// human reviewing a false positive can see WHICH rule misfired rather than
// re-deriving it from the sentence.

/** What is being routed. Without one of these, an email address is a signature. */
const SUBJECT_OF_SUBMISSION: Array<[string, RegExp]> = [
  ["submissions", /\bsubmissions?\b/i],
  ["new deals", /\bnew (?:deal|file|submission|app)s?\b/i],
  ["deals", /\bdeals?\b/i],
  ["files", /\bfiles?\b/i],
  ["packages", /\bpackages?\b/i],
  ["applications", /\bapp(?:lication)?s?\b/i],
  ["paperwork", /\bpaperwork\b/i],
];

/**
 * A GENERIC, PLURAL routing object — "submissions", "files", "deals" — as
 * opposed to one specific file on one deal.
 *
 * THIS IS WHAT MAKES AN INSTRUCTION STANDING, and it took Instagreen Capital
 * to show it. They asked three times for submissions to go to
 * isabel@instagreencapital.com (2026-07-06 twice, 2026-08-13 "send submissions
 * DIRECTLY to isabel@") and the detector caught ONE of the three, because the
 * other two carried no temporal cue — no "effective immediately", no "going
 * forward". They were simply standing facts about how this funder takes deals.
 * Meanwhile our recipe sent to submit@, her CC address, for three months.
 *
 * The real difference between "please forward THE FILE to me" (one deal, not a
 * recipe change) and "please send SUBMISSIONS to X" (a recipe change) is the
 * generic plural object, not an adverb of time. Strict plural on purpose:
 * `/\bfiles?\b/` matches "the file" and would pull every one-off back in.
 */
const GENERIC_PLURAL_OBJECT: Array<[string, RegExp]> = [
  ["submissions (plural)", /\bsubmissions\b/i],
  ["files (plural)", /\bfiles\b/i],
  ["deals (plural)", /\bdeals\b/i],
  ["applications (plural)", /\bapplications\b/i],
  ["packages (plural)", /\bpackages\b/i],
];

/** A directive to route somewhere. */
const SEND_VERB: Array<[string, RegExp]> = [
  // Past participles included: "files should be SENT to X" and "deals are
  // SUBMITTED to X" are routing instructions, and the first version matched
  // only the bare stems. Caught by the test asserting a real portal move still
  // fires — Lendini's genuine "all submissions will need to be SENT either API
  // or Portal" only passed because the real body left it unsplit next to a
  // sentence that happened to contain "email".
  ["send", /\bsen[dt](?:ing)?\b/i],
  ["submit", /\bsubmit(?:ting|ted)?\b/i],
  ["forward", /\bforward(?:ing|ed)?\b/i],
  ["email-to", /\be-?mail(?:ing)?\b/i],
  ["use", /\buse\b/i],
  ["direct", /\bdirect\b/i],
  ["route", /\broute\b/i],
  ["upload", /\bupload(?:ing)?\b/i],
];

/** Words that make an instruction forward-looking rather than about this file. */
const STANDING_CUE: Array<[string, RegExp]> = [
  ["effective immediately", /\beffective (?:immediately|today)\b/i],
  ["going forward", /\b(?:going|moving) forward\b/i],
  ["from now on", /\bfrom now on\b/i],
  ["all new", /\ball (?:new |future )?(?:deal|submission|file|app)/i],
  ["update your records", /\bupdate your records\b/i],
  ["new email", /\b(?:new|updated|correct) (?:submissions?\s+)?(?:e-?mail|address|inbox)\b/i],
  ["is now", /\bis now\b/i],
  ["please stop", /\b(?:please )?stop\b/i],
  ["no longer", /\bno longer\b/i],
  ["in the future", /\bin the future\b/i],
  // NOT a bare /future/. A ROK Financial marketing blast ("A $19,360
  // Commission... From One Referral 💰") fired on the word "future" in its
  // own unsubscribe footer — "To unsubscribe from future emails" — and
  // proposed the sender's signature address as our new submissions inbox.
  // The cue has to be about future DEALS, not about future anything.
  ["future submissions", /\b(?:future|upcoming|subsequent)\s+(?:deal|submission|file|app|package|business)/i],
];

/** Sentence-level marker that the named address is the one to ABANDON. */
const RETIRE_CUE: Array<[string, RegExp]> = [
  ["stop sending", /\bstop\b/i],
  ["no longer", /\bno longer\b/i],
  ["do not send", /\b(?:do not|don'?t|never)\b/i],
  ["discontinue", /\b(?:discontinue|cease|retire[d]?)\b/i],
  ["instead of", /\b(?:instead of|rather than)\b/i],
  ["now internal", /\b(?:internal|reserved for)\b/i],
];

const PORTAL_CUE: Array<[string, RegExp]> = [
  ["portal", /\bportal\b/i],
  // "our system" is GONE, and it was a false positive on a real row. Instagreen
  // wrote "let me know which members of your team we will be working with so we
  // can add them to our system and ensure they are properly set up" — that is
  // "add your staff to our CRM", not "stop emailing and use our portal", and it
  // sat in the actionable queue telling a processor to change how we submit.
  // A portal instruction says portal. The looser phrasing bought nothing and
  // cost a row in the queue that matters.
];

const DOC_NOUN: Array<[string, RegExp]> = [
  ["bank statements", /\bbank statements?\b/i],
  ["months of statements", /\b\d+\s*(?:months?|mos?)\b/i],
  ["application", /\bapp(?:lication)?s?\b/i],
  ["driver's license", /\b(?:driver'?s? licen[sc]e|photo id|\bID\b)/i],
  ["voided check", /\bvoided check\b/i],
  ["tax returns", /\btax returns?\b/i],
  ["ISO agreement", /\biso agreement\b/i],
  ["stips", /\bstips?\b/i],
  ["SSN", /\bssn\b|\bsocial security\b/i],
  ["P&L", /\bp\s?&\s?l\b|\bprofit and loss\b/i],
];

const REQUIRE_VERB: Array<[string, RegExp]> = [
  ["require", /\brequir(?:e|es|ed|ing|ement)\b/i],
  ["must include", /\bmust (?:include|have|contain|be)\b/i],
  ["we need", /\bwe(?:'ll| will)? (?:now )?need\b/i],
  ["cannot process without", /\b(?:can'?t|cannot|unable to) (?:process|review|underwrite)\b/i],
  ["mandatory", /\bmandator(?:y|ily)\b/i],
];

const CONTACT_ROLE: Array<[string, RegExp]> = [
  ["ISO rep", /\biso (?:rep(?:resentative)?|manager)\b/i],
  ["account manager", /\baccount (?:manager|executive)\b/i],
  ["point of contact", /\bpoint of contact\b/i],
  ["funding advisor", /\bfunding advisor\b/i],
];

const CONTACT_CHANGE_CUE: Array<[string, RegExp]> = [
  ["going forward", /\b(?:going|moving) forward\b/i],
  ["from now on", /\bfrom now on\b/i],
  // `send .{0,20}to` is GONE from this list. It is a ROUTING phrase, and
  // putting it in a CONTACT-CHANGE cue made every "please send all deals to X
  // and cc your Account Manager" read as the contact having changed. Lendini's
  // onboarding email said exactly that — it names who the account manager IS,
  // on day one; nothing changed — and it sat in the actionable queue.
  // A contact CHANGE needs language about a change.
  ["please contact", /\bplease (?:contact|reach out to|direct your)\b/i],
  ["has left", /\b(?:has|have) (?:left|departed|moved on|been replaced)\b/i],
  ["no longer with", /\bno longer (?:with|here|at)\b/i],
  ["replacing", /\b(?:replacing|taking over|took over)\b/i],
  ["new rep", /\b(?:new|different|another)\s+(?:iso\s+)?(?:rep(?:resentative)?|manager|contact)\b/i],
];

/**
 * Markers that identify OUR OWN outbound submission email, quoted back at us.
 *
 * DEFENCE IN DEPTH, AND IT CAUGHT A LIVE BUG. The detector is supposed to be
 * handed a quote-stripped body, but on the first run over all 156 captured
 * replies it fired on five 1 West emails and proposed `bayfinish@gmail.com`,
 * `aafmbruce@gmail.com` and `bobjann22@gmail.com` as new funder submission
 * addresses. Those are MERCHANTS' personal gmail addresses, lifted from the
 * "Owner email:" line of our own submission template, which had survived
 * stripping because coreBody()'s quote-header cap was 80 characters and 1
 * West's thread header is 99 (fixed in funderDecline.ts the same day).
 *
 * The caller's bug became the detector's false positive, and the proposal was
 * to redirect a merchant's bank statements to an address pulled out of our own
 * email. Nothing auto-applies, so no harm reached production — but a detector
 * that is only correct when its input is correct is not a check. So it now
 * refuses to read a window carrying our template's own field labels, whatever
 * the caller did or failed to do upstream.
 */
const OWN_TEMPLATE_MARKERS: RegExp[] = [
  /\bOwner email\s*:/i,
  /\bDeal #\s*:/i,
  /\bMonthly revenue\s*:/i,
  /\bAmount requested\s*:/i,
  /\bTime in business\s*:/i,
  /\bNew (?:MCA )?submission from\b/i,
  /\bMomentum Funding\b/i,
  /\bAgentic Voice\b/i,
];

function isOwnTemplate(s: string): boolean {
  return OWN_TEMPLATE_MARKERS.some((re) => re.test(s));
}

/**
 * Corporate email-security banners. Never a routing instruction, and shaped
 * exactly like one: a send verb, an address, and an imperative.
 *
 * Kapitus Partners, funder_replies a659527e, 2026-07-20 — an ISO onboarding
 * questionnaire whose header carried
 *
 *   "This email originated from outside of Kapitus. If this message or
 *    attachments are unusual or unexpected in your typical business
 *    interactions please forward to cybersecurity@kapitus.com."
 *
 * The detector proposed `cybersecurity@kapitus.com` as Kapitus's submissions
 * inbox. "forward" supplied the verb, the address supplied the destination, and
 * the word "deals" came from the questionnaire 150 characters away — close
 * enough for the ±160 window, nothing to do with the banner. Banners like this
 * sit at the top of a large share of corporate mail, so without this guard the
 * class recurs for every funder on a filtered tenant.
 */
const SECURITY_BANNER: RegExp[] = [
  /originated from outside/i,
  /\bexternal (?:sender|email)\b/i,
  /\bphishing\b/i,
  /\bcyber ?security\b/i,
  /\bsuspicious\b/i,
  /\bdo not click\b/i,
  /\breport (?:it|this)\b/i,
  /verify the sender/i,
];

function isSecurityBanner(s: string): boolean {
  return SECURITY_BANNER.some((re) => re.test(s));
}

/** Collect the labels of every pattern in `set` that `s` matches. */
function hits(s: string, set: Array<[string, RegExp]>): string[] {
  return set.filter(([, re]) => re.test(s)).map(([label]) => label);
}

/** Emails in a sentence that could plausibly be a funder destination. */
function candidateEmails(s: string): string[] {
  const found = s.match(EMAIL_RE) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const e = raw.toLowerCase().replace(/[.,;:)]+$/, "");
    if (isOurAddress(e)) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** Trim an evidence quote without cutting it mid-address. */
function quote(s: string, max = 400): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Find every standing instruction in one funder reply body.
 *
 * `body` must already be flattened/quote-stripped — pass coreBody() output from
 * funderDecline.ts. Pure, synchronous, no I/O: the same input always produces
 * the same flags, which is what lets it be replayed over history and tested in
 * both directions.
 */
export function detectDirectives(body: string): DetectedDirective[] {
  const text = String(body ?? "");
  if (!text.trim()) return [];
  const out: DetectedDirective[] = [];
  const sentences = sentencesOf(text);

  // ── 1. submission_email_change ────────────────────────────────────────────
  // Scanned per ADDRESS, over a ±WINDOW-character window around it, not per
  // sentence.
  //
  // WHY NOT PER SENTENCE: a funder email is often not prose. 1 West's quoted
  // template is a 6KB field list with no sentence punctuation at all, so the
  // splitter returns it as ONE "sentence" — and a rule asking "does this
  // sentence contain a send verb, a submissions noun and an address?" is
  // trivially satisfied somewhere inside 6KB of unrelated text. The three
  // signals have to be NEAR each other to mean anything, so the window is the
  // rule and the sentence is only used for the quote.
  const WINDOW = 160;
  /**
   * The address must be the grammatical DESTINATION of the instruction: the
   * text immediately before it ends in "to", "at", or a colon.
   *
   * This one test is what separates "send all submissions to X" from a
   * signature block, and it is why the ROK marketing blast above no longer
   * fires: "Best, Anthony Cerchia acerchia@rok.biz" has no preposition in
   * front of the address, so the address is a byline, not a destination.
   */
  const DESTINATION_PREP = /(?:\b(?:to|at)\b|:)\s*(?:this\s+|our\s+|the\s+|new\s+|updated\s+|e-?mail\s+|address\s+|inbox\s+)*$/i;
  /**
   * A CONTACT LABEL in a signature block — "E:", "Email:", "Direct:" — which
   * satisfies DESTINATION_PREP through its colon and means the opposite of a
   * routing instruction: here is a person's address, not where to send deals.
   *
   * BOTH of the false positives the team lead caught were this, and both would
   * have moved submissions off a working inbox:
   *
   *   True Advance — "P: 551-341-1453 E: submissions@trueadvance.biz" is the
   *   Submissions Team's signature. We already send to
   *   submissions@trueadvancefunding.com, which has replied to us by name.
   *
   *   Velocity — "Your ISO Representative is Jesse Guzman Email:
   *   jesse@velocitycg.com". The SAME email says "To Subs@velocitycg.com" and
   *   "Deal Submissions: Subs@velocitycg.com". jesse@ is a salesperson's
   *   mailbox; subs@ is the inbox, named twice, and is what we already use.
   *   Acting on that row would have routed a merchant's file to a rep.
   *
   * The discriminator is what sits in front of the label: a routing noun
   * ("Submissions Email:", "Deal Submissions:") makes it a designation; a name
   * or a phone number makes it a signature.
   */
  const CONTACT_LABEL = /\b(e|e-?mail|direct|phone|tel|cell|mobile|fax|office|web|website|contact)\s*:\s*$/i;
  const ROUTING_NOUN_BEFORE_LABEL = /\b(submissions?|deals?|files?|packages?|applications?|underwriting|new\s+business|paperwork)\b[^:]{0,12}$/i;
  const newEmails: string[] = [];
  const retiredEmails: string[] = [];
  const routingSentences: string[] = [];
  const routingLabels = new Set<string>();
  /** Addresses we matched but could not place on either side of the change. */
  let ambiguousSide = false;

  for (const m of text.matchAll(EMAIL_RE)) {
    const raw = m[0].toLowerCase().replace(/[.,;:)]+$/, "");
    if (isOurAddress(raw)) continue;
    const at = m.index ?? 0;
    const win = text.slice(Math.max(0, at - WINDOW), at + raw.length + WINDOW);
    // Our own template quoted back is not the funder telling us anything.
    if (isOwnTemplate(win)) continue;
    // Nor is their mail gateway's anti-phishing banner.
    if (isSecurityBanner(win)) continue;
    const before = text.slice(Math.max(0, at - 60), at);
    if (!DESTINATION_PREP.test(before)) continue;
    // A bare contact label is a signature, not a destination — unless a routing
    // noun sits in front of it ("Submissions Email:" vs "Jesse Guzman Email:").
    const label = before.match(CONTACT_LABEL);
    if (label) {
      const beforeLabel = before.slice(0, before.length - label[0].length);
      if (!ROUTING_NOUN_BEFORE_LABEL.test(beforeLabel)) continue;
    }
    const verbs = hits(win, SEND_VERB);
    const subjects = hits(win, SUBJECT_OF_SUBMISSION);
    if (verbs.length === 0 || subjects.length === 0) continue;

    const standing = [...hits(win, STANDING_CUE), ...hits(win, GENERIC_PLURAL_OBJECT)];
    // Quote the sentence the address actually sits in — a window cut mid-word
    // is evidence a human can't read, and the whole point of the row is that a
    // human reads the funder's own line before changing anything.
    const own = sentences.find((s) => s.toLowerCase().includes(raw)) ?? null;
    const q = quote(own ?? win);
    if (!routingSentences.includes(q)) routingSentences.push(q);
    for (const l of [...verbs, ...subjects, ...standing]) routingLabels.add(l);

    // WHICH SIDE OF THE CHANGE IS THIS ADDRESS ON — and this is scoped to the
    // SENTENCE, never the window, because the window got it exactly backwards.
    //
    // The real Uplyft email is two sentences: "…please send all new deal
    // submissions to submissions@uplyftcapital.com." then "Please stop sending
    // submissions to underwriting@uplyftcapital.com, as that inbox is now
    // reserved for internal underwriting communication." The two addresses are
    // 70 characters apart, so a ±160 window around the NEW address contains the
    // word "stop" — and the first version of this rule duly filed the new
    // address as the retired one and reported "stop sending submissions to
    // submissions@uplyftcapital.com". It would have told a human to abandon the
    // only inbox that works.
    //
    // A retire cue only counts when it is in the same sentence as the address.
    // When the address sits in no clean sentence (an unsplittable block), the
    // side is left UNKNOWN rather than guessed: the flag still raises and the
    // human reads the quote. A guess here points at a mailbox.
    if (!own) { ambiguousSide = true; continue; }
    const retireHits = hits(own, RETIRE_CUE);
    for (const l of retireHits) routingLabels.add(l);
    if (retireHits.length > 0) {
      if (!retiredEmails.includes(raw)) retiredEmails.push(raw);
    } else if (!newEmails.includes(raw)) newEmails.push(raw);
  }

  if (routingSentences.length > 0 && (newEmails.length > 0 || retiredEmails.length > 0 || ambiguousSide)) {
    // An address named as retired in one sentence is not also the new one.
    const fresh = newEmails.filter((e) => !retiredEmails.includes(e));
    const newEmail = fresh[0] ?? null;
    const retired = retiredEmails[0] ?? null;
    // Both halves of the instruction must be about routing somewhere NEW for
    // this to be worth a human's time: either a standing cue, or an explicit
    // retirement. A bare "send the file to me" on one deal is a stip-style
    // request, not a change to the recipe, and must not land in this queue.
    const isStanding = routingLabels.has("effective immediately") ||
      routingLabels.has("going forward") || routingLabels.has("from now on") ||
      routingLabels.has("all new") || routingLabels.has("update your records") ||
      routingLabels.has("new email") || routingLabels.has("in the future") ||
      routingLabels.has("future submissions") ||
      // A generic plural object is standing on its own — no adverb of time
      // required. See GENERIC_PLURAL_OBJECT: two of Instagreen's three requests
      // had no temporal cue and were dropped for three months.
      GENERIC_PLURAL_OBJECT.some(([label]) => routingLabels.has(label)) ||
      retired !== null;
    if (isStanding && (newEmail || retired || ambiguousSide)) {
      out.push({
        kind: "submission_email_change",
        evidence_quote: routingSentences.join(" "),
        matched_phrases: [...routingLabels].sort(),
        new_email: newEmail,
        retired_email: retired,
        // When we could not place the address on either side of the change,
        // the row says SO. "Read the funder's words" is a true statement a
        // human can act on; a confidently wrong address is not.
        summary: newEmail && retired
          ? `Funder says to send submissions to ${newEmail} and stop using ${retired}.`
          : newEmail
          ? `Funder says to send submissions to ${newEmail} from now on.`
          : retired
          ? `Funder says to stop sending submissions to ${retired}.`
          : `Funder appears to be changing where submissions go — which address is which could not be read automatically. Read the quote below before changing anything.`,
      });
    }
  }

  // Rules 2–4 are sentence-scoped, and a "sentence" longer than this is not a
  // sentence — it is a block the splitter could not break (a quoted field list,
  // a pasted rate sheet). Co-occurrence inside one of those means nothing, so
  // they are skipped rather than scanned. Same lesson as the window above.
  const MAX_SENTENCE = 400;
  const prose = sentences.filter((s) => s.length <= MAX_SENTENCE && !isOwnTemplate(s));

  // ── 2. use_portal ─────────────────────────────────────────────────────────
  for (const s of prose) {
    const portal = hits(s, PORTAL_CUE);
    if (portal.length === 0) continue;
    const verbs = hits(s, SEND_VERB);
    const subjects = hits(s, SUBJECT_OF_SUBMISSION);
    const standing = hits(s, STANDING_CUE);
    const retire = hits(s, RETIRE_CUE);
    if (verbs.length === 0 || subjects.length === 0) continue;
    if (standing.length === 0 && retire.length === 0) continue;
    out.push({
      kind: "use_portal",
      evidence_quote: quote(s),
      matched_phrases: [...portal, ...verbs, ...subjects, ...standing, ...retire],
      new_email: null,
      retired_email: null,
      summary: "Funder says to submit through their portal rather than by email.",
    });
    break; // one per reply is enough to make a human read it
  }

  // ── 3. new_required_docs ──────────────────────────────────────────────────
  for (const s of prose) {
    const req = hits(s, REQUIRE_VERB);
    if (req.length === 0) continue;
    const docs = hits(s, DOC_NOUN);
    const standing = hits(s, STANDING_CUE);
    if (docs.length === 0 || standing.length === 0) continue;
    out.push({
      kind: "new_required_docs",
      evidence_quote: quote(s),
      matched_phrases: [...req, ...docs, ...standing],
      new_email: null,
      retired_email: null,
      summary: `Funder says future submissions must include: ${docs.join(", ")}.`,
    });
    break;
  }

  // ── 4. contact_change ─────────────────────────────────────────────────────
  for (const s of prose) {
    const role = hits(s, CONTACT_ROLE);
    if (role.length === 0) continue;
    const cue = hits(s, CONTACT_CHANGE_CUE);
    if (cue.length === 0) continue;
    out.push({
      kind: "contact_change",
      evidence_quote: quote(s),
      matched_phrases: [...role, ...cue],
      new_email: candidateEmails(s)[0] ?? null,
      retired_email: null,
      summary: "Funder says who to deal with has changed.",
    });
    break;
  }

  return out;
}

// ── Persist ──────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { coreBody } from "./funderDecline.ts";

export interface RecordDirectivesOpts {
  lenderId: string;
  funderReplyId: string | null;
  fullBody: string;
  dealId?: string | null;
  dealSubmissionId?: string | null;
  subject?: string | null;
  fromEmail?: string | null;
  receivedAt?: string | null;
}

export interface RecordDirectivesResult {
  kinds: DirectiveKind[];
  /**
   * How many rows are ON FILE for this reply afterwards, read back from the
   * table — NOT what the upsert claimed. `null` means the read-back itself
   * failed, which is a different fact from zero. See the long note at the
   * read-back for why this is not taken from the write's own return value.
   */
  written: number | null;
  error: string | null;
}

/**
 * Detect and persist the standing instructions in one funder reply.
 *
 * Idempotent on (funder_reply_id, kind), so the 10-minute poller, the live
 * webhook, the 15-minute vendor sweep and the nightly safety-net scan can all
 * see the same email and only the first one writes a row.
 *
 * ⚠️ THIS ONE IS NOT ALLOWED TO FAIL QUIETLY.
 *
 * captureFunderReply(), which calls this, is best-effort by contract: a capture
 * failure must never break the reply path. That contract is right for the
 * capture and WRONG for this, because a silently-dropped directive is the exact
 * bug being fixed — the Uplyft instruction was already "handled" by a code path
 * that returned without complaining. So on a write failure this also writes an
 * activity_log note against the LENDER, which puts the failure on a human
 * surface, and returns the error to its caller. It still never throws.
 *
 * `interaction_type` is 'note' and `entity_type` is 'lender'. 'system' is not a
 * permitted interaction_type in this schema, and a bad value makes the insert
 * fail silently — which would hide the report of a hidden failure.
 */
export async function recordDirectives(
  db: SupabaseClient,
  o: RecordDirectivesOpts,
): Promise<RecordDirectivesResult> {
  const found = detectDirectives(coreBody(o.fullBody ?? ""));
  if (!o.lenderId || found.length === 0) {
    return { kinds: [], written: 0, error: null };
  }

  const rows = found.map((d) => ({
    lender_id: o.lenderId,
    funder_reply_id: o.funderReplyId,
    deal_submission_id: o.dealSubmissionId ?? null,
    deal_id: o.dealId ?? null,
    kind: d.kind,
    status: "open",
    detected_by: "rule",
    retired_email: d.retired_email,
    new_email: d.new_email,
    matched_phrases: d.matched_phrases,
    summary: d.summary,
    evidence_quote: d.evidence_quote,
    from_email: o.fromEmail ?? null,
    received_at: o.receivedAt ?? null,
  }));

  // No funder_reply_id means the unique key cannot dedupe, so a re-run would
  // mint duplicates. Rather than spraying rows, check for an identical open row
  // on this lender+kind first. Every live path passes a reply id; this is the
  // fallback for a caller that could not capture one.
  if (!o.funderReplyId) {
    const kinds = rows.map((r) => r.kind);
    const { data: already, error: readErr } = await db
      .from("funder_directives")
      .select("kind")
      .eq("lender_id", o.lenderId)
      .is("funder_reply_id", null)
      .in("kind", kinds)
      .eq("status", "open");
    // An UNREADABLE check is not an empty one. Writing on a failed read would
    // duplicate; skipping silently would drop a real directive. Report it.
    if (readErr) {
      await noteFailure(db, o, `could not check for an existing directive: ${readErr.message}`);
      return { kinds: found.map((d) => d.kind), written: 0, error: readErr.message };
    }
    const seen = new Set((already ?? []).map((r) => r.kind as string));
    for (let i = rows.length - 1; i >= 0; i--) if (seen.has(rows[i].kind)) rows.splice(i, 1);
    if (rows.length === 0) return { kinds: found.map((d) => d.kind), written: 0, error: null };
  }

  const { error } = await db
    .from("funder_directives")
    .upsert(rows, { onConflict: "funder_reply_id,kind", ignoreDuplicates: true });

  if (error) {
    await noteFailure(db, o, error.message);
    return { kinds: found.map((d) => d.kind), written: 0, error: error.message };
  }

  // READ BACK WHAT ACTUALLY EXISTS, rather than trusting what the write said.
  //
  // `.upsert(..., { ignoreDuplicates: true }).select()` returns an EMPTY array
  // even when it inserted — PostgREST's ON CONFLICT DO NOTHING path returns no
  // representation. The first live backfill therefore reported
  // `repliesWithADirective: 4, rowsWritten: 0` while writing all 7 rows, so the
  // one number a reader would check said nothing had been recorded. Counting
  // the write's own claim is how "nothing happened" and "we did not look" end
  // up indistinguishable, which is the entire defect this module exists for.
  //
  // `onFile` is therefore the number of rows that are THERE, verified by a
  // separate read, not the number the upsert believed it wrote. `null` means
  // the read-back failed — never 0, which would assert they are absent.
  const { data: back, error: backErr } = await db
    .from("funder_directives")
    .select("id")
    .eq("funder_reply_id", o.funderReplyId)
    .in("kind", rows.map((r) => r.kind));
  if (backErr) {
    return {
      kinds: found.map((d) => d.kind),
      written: null,
      error: `written, but the read-back failed so the count is unknown: ${backErr.message}`,
    };
  }
  return {
    kinds: found.map((d) => d.kind),
    written: (back ?? []).length,
    error: null,
  };
}

/** Put a dropped directive on a human surface. Best-effort, checked, no throw. */
async function noteFailure(
  db: SupabaseClient,
  o: RecordDirectivesOpts,
  why: string,
): Promise<void> {
  const { error } = await db.from("activity_log").insert({
    entity_type: "lender",
    entity_id: o.lenderId,
    interaction_type: "note",
    subject: "funder:directive-detect-failed",
    content:
      `A funder reply looked like a standing instruction (how we submit to this funder) ` +
      `but the flag could NOT be recorded: ${why}. ` +
      `Read the reply by hand — reply id ${o.funderReplyId ?? "(not captured)"}, ` +
      `subject "${o.subject ?? "—"}", from ${o.fromEmail ?? "—"}.`,
  });
  // Nowhere left to escalate to; say it in the function logs at least.
  if (error) console.error("[funderDirective] could not log the drop either:", error.message);
}
