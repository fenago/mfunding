// ── GHL email delivery events → one normalized, per-RECIPIENT fact ───────────
//
// PURE parsing and classification, deliberately with no database in it, so the
// rules below can be replayed against fixtures and made to go RED. The DB side
// (correlation + what we do about a failure) lives in ghl-webhook.
//
// TWO payload shapes arrive here, and they are NOT equally informative:
//
//   A) `LCEmailStats` — the native GHL/Mailgun webhook event. PER-RECIPIENT, and
//      it carries the remote server's own SMTP response (code, enhanced-code,
//      mx-host, message). This is the shape that can actually prove a funder's
//      inbox rejected a submission. It needs a Location-level Marketplace app
//      subscription; see the owner-action note in ghl-webhook.
//      Doc: github.com/gohighlevel/api-v2-docs/blob/main/docs/webhook%20events/LCEmailStats.md
//
//   B) A GHL "Email Events" workflow trigger (Bounced / Complained / Opened /
//      Clicked / Unsubscribed) firing a Webhook action. Needs no app, but it
//      fires on the CONTACT and carries NO SMTP detail and no per-recipient
//      address — so it can say "a message to this funder bounced" and nothing
//      more. Weaker, and handled as weaker: smtp_* stay null rather than being
//      filled with a plausible-looking guess.
//
// WHAT IS TRUSTWORTHY. `delivered` and the failure events are the receiving
// server speaking. `opened` is NOT: every message ever sent to one funder's
// submissions inbox read `opened`, including plain-text follow-ups with no
// attachments, from a team that says it received nothing — Microsoft EOP
// prefetches tracking pixels. So opens are classified, recorded, and never
// allowed to mean engagement.

/** Normalized event classes. Anything unrecognized becomes `other` rather than
 * being forced into a neighbour — a provider adding an event must not silently
 * acquire the semantics of an existing one. */
export type DeliveryEvent =
  | "delivered" | "failed" | "rejected"
  | "opened" | "clicked" | "complained" | "unsubscribed" | "other";

export type Severity = "permanent" | "temporary" | null;

export interface ParsedStats {
  /** Normalized class. */
  event: DeliveryEvent;
  /** Exactly what the provider called it. */
  eventRaw: string;
  /** 'permanent' only when the payload PROVES it (explicit severity, a 5xx, or
   * an outright rejection). Null means unknown — and unknown must never be
   * acted on as if it were permanent. */
  severity: Severity;
  recipient: string;
  recipientDomain: string | null;
  recipientProvider: string | null;
  /** Our To: header. For a funder submission this is the funder's submission
   * inbox even when `recipient` is one of our own CC copies — which is exactly
   * how a to:-failure gets told apart from a cc:-failure. */
  headerTo: string | null;
  smtpCode: number | null;
  smtpEnhancedCode: string | null;
  smtpMessage: string | null;
  mxHost: string | null;
  smtpMessageId: string | null;
  providerEventId: string | null;
  occurredAt: string;
  /** Workflow-shaped payloads identify a CONTACT instead of a recipient. */
  contactId: string | null;
  /** Which shape this came from — recorded so nobody reads SMTP-less rows as
   * "the server said nothing" when the truth is "this path never carries it". */
  shape: "lcemailstats" | "workflow";
}

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const orNull = (v: unknown): string | null => s(v) || null;

/** Does this payload look like an email delivery event at all? Checked before
 * the open/inbound branches so `LCEmailStats` stops being swallowed by them. */
export function isEmailStatsPayload(evt: Record<string, unknown>): boolean {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const type = s(evt.type ?? evt.eventType ?? cd.type).toLowerCase();
  if (type === "lcemailstats" || type === "emaildeliveryevent") return true;
  // Native shape without a type field.
  if (evt.webhookPayload && typeof evt.webhookPayload === "object") return true;
  // Workflow shape: an explicit email-event name in customData.
  const wf = s(cd.email_event ?? cd.emailEvent).toLowerCase();
  return wf !== "" && classify(wf).event !== "other";
}

/** Map a provider event name onto our class + what it implies about severity.
 * `bounced` is permanent by definition in GHL's Email Events trigger (it is the
 * hard-bounce filter); `failed` is NOT — Mailgun uses it for both a 4xx it is
 * still retrying and a 5xx it has given up on, which is why severity is derived
 * separately below and left null when unproven. */
function classify(raw: string): { event: DeliveryEvent; impliedSeverity: Severity } {
  switch (raw) {
    case "delivered": case "delivery": case "accepted":
      return { event: "delivered", impliedSeverity: null };
    case "failed": case "failure":
      return { event: "failed", impliedSeverity: null };
    case "permanent_fail": case "permanent-fail": case "hard_bounce": case "hardbounce":
      return { event: "failed", impliedSeverity: "permanent" };
    case "temporary_fail": case "temporary-fail": case "soft_bounce": case "softbounce": case "deferred":
      return { event: "failed", impliedSeverity: "temporary" };
    case "bounced": case "bounce":
      return { event: "failed", impliedSeverity: "permanent" };
    case "rejected": case "reject": case "suppressed": case "dropped":
      return { event: "rejected", impliedSeverity: "permanent" };
    case "opened": case "open":
      return { event: "opened", impliedSeverity: null };
    case "clicked": case "click":
      return { event: "clicked", impliedSeverity: null };
    case "complained": case "complaint": case "spam":
      return { event: "complained", impliedSeverity: null };
    case "unsubscribed": case "unsubscribe":
      return { event: "unsubscribed", impliedSeverity: null };
    default:
      return { event: "other", impliedSeverity: null };
  }
}

/** The ONE address a To: header is about. GHL sends one funder per submission,
 * so this is a single mailbox, but the header can be `Name <addr>` or a list —
 * take the first address and nothing else. */
function firstAddress(header: string): string | null {
  const first = header.split(",")[0] ?? "";
  const angle = first.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : first).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

/** Normalize either payload shape into one fact. Returns null when the payload
 * carries no recipient AND no contact — there is nothing a reader could place,
 * and inventing a recipient would be worse than refusing. */
export function parseEmailStats(evt: Record<string, unknown>): ParsedStats | null {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const wp = (evt.webhookPayload ?? null) as Record<string, unknown> | null;
  const shape: ParsedStats["shape"] = wp ? "lcemailstats" : "workflow";

  const rawName = s(
    wp?.event ?? cd.email_event ?? cd.emailEvent ?? cd.event ?? evt.event,
  ).toLowerCase();
  const { event, impliedSeverity } = classify(rawName);

  const msg = (wp?.message ?? {}) as Record<string, unknown>;
  const headers = (msg.headers ?? {}) as Record<string, unknown>;
  const ds = (wp?.["delivery-status"] ?? {}) as Record<string, unknown>;

  const codeRaw = ds.code ?? wp?.code;
  const smtpCode = codeRaw == null || codeRaw === "" ? null : Number(codeRaw);

  // Severity ladder, most-trustworthy first. An explicit provider severity wins;
  // then the SMTP class (5xx = the server has refused for good, 4xx = retrying);
  // then what the event NAME implies. If none of those speak, severity stays
  // null and the caller treats the failure as unproven rather than permanent.
  const explicit = s(wp?.severity ?? ds.severity ?? cd.severity).toLowerCase();
  let severity: Severity = null;
  if (explicit === "permanent" || explicit === "temporary") severity = explicit;
  else if (smtpCode != null && Number.isFinite(smtpCode) && smtpCode >= 500) severity = "permanent";
  else if (smtpCode != null && Number.isFinite(smtpCode) && smtpCode >= 400) severity = "temporary";
  else severity = impliedSeverity;

  const recipient = s(
    wp?.recipient ?? cd.recipient ?? cd.email ?? evt.email ?? cd.to,
  ).toLowerCase();
  const contactId = orNull(
    evt.contactId ?? evt.contact_id ?? cd.contactId ?? cd.contact_id ??
    (evt.contact as Record<string, unknown> | undefined)?.id,
  );
  if (!recipient && !contactId) return null;

  // Mailgun timestamps are UNIX SECONDS. Treating them as milliseconds puts the
  // event in 1970 and silently breaks every time-window match, so the unit is
  // checked rather than assumed.
  const tsRaw = wp?.timestamp ?? cd.timestamp;
  let occurredAt = new Date().toISOString();
  const tsNum = Number(tsRaw);
  if (Number.isFinite(tsNum) && tsNum > 0) {
    const ms = tsNum > 1e12 ? tsNum : tsNum * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
  } else {
    const iso = s(cd.occurredAt ?? cd.timestamp ?? evt.dateAdded);
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
    }
  }

  const toHeader = s(headers.to ?? cd.header_to);
  const descr = s(ds.description);
  const dsMsg = s(ds.message);
  // Mailgun puts the terse SMTP reply in `message` and the longer human
  // explanation in `description`; keep both — the first is what a mail admin
  // needs and the second is what a processor can read.
  const smtpMessage = [dsMsg, descr].filter(Boolean).join(" — ") || null;

  return {
    event,
    eventRaw: rawName || "unknown",
    severity,
    recipient: recipient || "",
    recipientDomain: orNull(wp?.["recipient-domain"]) ??
      (recipient.includes("@") ? recipient.split("@")[1] : null),
    recipientProvider: orNull(wp?.["recipient-provider"]),
    headerTo: toHeader ? firstAddress(toHeader) : null,
    smtpCode: smtpCode != null && Number.isFinite(smtpCode) ? smtpCode : null,
    smtpEnhancedCode: orNull(ds["enhanced-code"]),
    smtpMessage,
    mxHost: orNull(ds["mx-host"]),
    smtpMessageId: orNull(headers["message-id"]),
    providerEventId: orNull(wp?.id),
    occurredAt,
    contactId,
    shape,
  };
}

/** Did the receiving side refuse this message for good? The ONLY condition under
 * which we are entitled to un-mark a submission as delivered. An unproven
 * failure (severity null) deliberately returns false: Mailgun retries 4xx for
 * hours, and flipping a submission to "not sent" on a transient deferral would
 * send a processor chasing a funder who is about to receive it anyway. */
export function isProvenPermanentFailure(p: ParsedStats): boolean {
  return (p.event === "failed" || p.event === "rejected") && p.severity === "permanent";
}

/** Where did this address sit on OUR message? The distinction the GHL email
 * record cannot make, and the reason a funder's 550 was invisible: our own CC
 * copies delivered fine and the single aggregate status reported success.
 * `unknown` when the payload gives no To: header to compare against — said
 * plainly instead of defaulting to 'to' and over-claiming. */
export function recipientRole(
  p: ParsedStats, submissionTo: string | null, ccList: string[],
): "to" | "cc" | "unknown" {
  const r = p.recipient.toLowerCase();
  const to = (submissionTo ?? p.headerTo ?? "").toLowerCase();
  if (!r) return "unknown";
  if (to && r === to) return "to";
  if (ccList.some((c) => c.toLowerCase() === r)) return "cc";
  if (to) return "cc"; // we know the to: address and this is not it
  return "unknown";
}

/** One line a human can act on, in the receiving server's own words. Used for
 * the deal activity_log entry and the owner alert — a processor needs to see
 * `550 5.1.10 RecipientNotFound` rather than "delivery problem". */
export function failureLine(p: ParsedStats): string {
  // Mailgun's `message` usually ALREADY opens with the code and the enhanced
  // code ("550 5.1.10 RESOLVER.ADR.RecipientNotFound"). Prepending them blindly
  // produced "550 5.1.10 550 5.1.10 RESOLVER..." in the first live replay — a
  // small thing that reads as a broken parser in the one line a processor is
  // meant to trust. So each is added only when the message doesn't already
  // carry it.
  const body = (p.smtpMessage ?? "").trim();
  const code = p.smtpCode != null ? String(p.smtpCode) : null;
  // Any code the message ALREADY carries is dropped; one it lacks is appended
  // in parentheses rather than prepended. The first live run against a real
  // funder address produced "5.2.2 552 delivery refused" — the enhanced code
  // leading a sentence that already began with its own numeric code reads as
  // garbled machine output in the line we are asking a processor to trust.
  const missing = [code, p.smtpEnhancedCode].filter((c): c is string => !!c && !body.includes(c));
  const detail = body
    ? (missing.length ? `${body} (${missing.join(" ")})` : body)
    : missing.length
    ? missing.join(" ")
    : `no SMTP detail (${p.shape} payload)`;
  const sev = p.severity ?? "unproven severity";
  return `${p.eventRaw} (${sev}) to ${p.recipient || "unknown recipient"}: ${detail}` +
    (p.mxHost ? ` [mx ${p.mxHost}]` : "");
}
