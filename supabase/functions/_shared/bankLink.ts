// bankLink — the ONE definition of a merchant's personal, no-login bank link.
//
// The link is `https://my.mfunding.net/connect-bank/<token>`: the logged-OUT page
// that both (a) uploads bank statements (merchant-upload-doc → merchantDocArrived)
// and (b) starts a Plaid connection (plaid-create-link-token / plaid-exchange).
// Its token is a row in `merchant_bank_link_tokens`, validated server-side by
// resolvePlaidCaller (_shared/plaidAuth.ts) — so "is this link valid" already had
// exactly one definition. The MINTING of it did not: plaid-mint-link and
// ph-send-packet each carried their own copy of the same twelve lines. This file
// is that one definition; both now call it.
//
// WHY IT ALSO HAS TO BE MINTED ON THE APPLICATION SEND
// -----------------------------------------------------------------------------
// The merchant application document's closing section tells the merchant how to
// send bank statements, and its post-signing redirect sends them there. Both
// compose the link around {{contact.bank_statement_link}}. GHL renders an EMPTY
// custom field as nothing at all, so a document sent without this field
// populated says "here is your link" followed by blank space — the merchant is
// handed an instruction with the instruction missing. Hence requireBankLink-
// OnContact(), which the application senders call BEFORE they enroll the document
// workflow and which REFUSES the send rather than let a broken document go out.
//
// THAT FIELD HOLDS THE BARE TOKEN, NOT THE URL — the document composes the URL
// around it, because GHL's redirect setting rejects a value that isn't shaped
// like a URL. The full reasoning is on bankLinkUrl() below; read it before
// changing what gets written.
//
// THE LINK IS A BEARER CREDENTIAL. Whoever holds the URL can upload documents to
// that merchant's file, start a Plaid connect against it, and read back (via the
// page's "status" action) the merchant's business name, deal number and document
// list. It is not a secret the way a password is — it travels by email to the
// merchant on purpose — but it must never be written to a log line, so every log
// here passes through maskBankLinkTokens() and so does redactForLog() in ghl.ts.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. Nothing here is
// merchant-facing copy; the page itself owns that language.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BANK_STATEMENT_LINK_FIELD_ID, getContact, updateContactCustomFields,
  maskBankLinkTokens, type GhlConfig,
} from "./ghl.ts";

/** contact.bank_statement_link (TEXT) in MFunding location t7NmVR4WCy927j4Zon4b.
 *  The id itself lives in ghl.ts, which needs it for log redaction and cannot
 *  import this file; re-exported here because this is where callers look. */
export { BANK_STATEMENT_LINK_FIELD_ID };
import { loadMerchantIdentity } from "./merchantIdentity.ts";

/** The host that serves the React /connect-bank/:token route. mfunding.net and
 *  my.mfunding.net are Netlify aliases of the SAME bundle and both serve it
 *  (verified 2026-11-02: identical index.html on both); my.mfunding.net is the
 *  merchant-portal host and the one every link already in the wild carries, so
 *  it stays the single definition. Change it HERE or not at all. */
export const PORTAL_BASE = "https://my.mfunding.net";

/**
 * How long a freshly minted (or refreshed) link lives.
 *
 * WAS 30 DAYS, AND 30 DAYS DOES NOT SURVIVE THIS FLOW. Measured against the live
 * table on 2026-11-02: 13 tokens ever minted, **0 of them still valid** — the
 * newest was minted 2026-09-07 and died on 2026-10-07. Every merchant who still
 * holds one of those emails gets "This bank-connection link has expired."
 *
 * That is tolerable for a link a closer texts and watches. It is NOT tolerable
 * for a link printed inside a document the merchant signs and keeps: the document
 * says "upload your statements here" forever, so the link has to outlive the
 * merchant's attention span, not ours. 90 days covers the real span of an MCA
 * file — sign this week, statements next week, the funder asking for one more
 * month six weeks later — without leaving a bearer URL alive for a year.
 *
 * It is also a FLOOR, not a ceiling: every send refreshes the live token (see
 * MIN_REMAINING_DAYS), so a merchant anyone is actually working always holds a
 * link with ~90 days left from the last touch. The absolute expiry only reaches
 * a merchant nobody has contacted in three months.
 */
export const TTL_DAYS = 90;

/** A reused token with less than this left is pushed back out to a full TTL. A
 *  merchant must never be emailed a link that dies next week. */
export const MIN_REMAINING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * THE TWO FIELDS HOLD DIFFERENT SHAPES ON PURPOSE. Do not "fix" this.
 *
 *  · contact.bank_statement_link  → the BARE TOKEN
 *  · contact.ph_connect_bank_url  → the FULL URL
 *
 * WHY. GHL's document "redirect after signing" setting validates its value as a
 * URL: a bare `{{contact.bank_statement_link}}` is rejected outright ("Invalid
 * redirect url configuration / Invalid URL format"), while the same merge tag
 * embedded inside a well-formed URL passes validation and survives a save and a
 * reload — the validator checks URL SHAPE and does not mind the braces (proven
 * in the GHL UI, 2026-11-02). So the application template composes the link at
 * its use sites instead:
 *
 *     https://my.mfunding.net/connect-bank/{{contact.bank_statement_link}}
 *
 * — in the signing redirect AND in the document body. If this field held the
 * full URL, that composition would resolve to
 * `…/connect-bank/https://my.mfunding.net/connect-bank/<token>`, and the
 * merchant's upload link would be broken on the one document that matters.
 *
 * ph_connect_bank_url predates all of this, has its own consumers and its own
 * (non-document) delivery, and stays a full URL. The shapes differ because the
 * CONSUMERS differ; making them match would break one of the two.
 *
 * PORTAL_BASE / bankLinkUrl() below remain the one definition of the URL — they
 * are now used by the callers that need a whole link (the copy-and-text
 * affordance, API responses, the PH packet) rather than by this field's write.
 * The constant here MUST stay in step with what the GHL template prefixes.
 */
export function bankLinkUrl(token: string): string {
  return `${PORTAL_BASE}/connect-bank/${token}`;
}

/** What a caller is writing into a contact field. Stated explicitly at every
 *  call site so the bare-token field and the full-URL field can never be fed
 *  each other's shape by a refactor that "looks right". */
export type BankLinkShape = "token" | "url";

/** A token is opaque, alphanumeric and contains no URL punctuation — so this
 *  rejects a URL, which is the exact mistake it exists to catch. Deliberately
 *  not pinned to the current 64-hex generator. */
export function isBankLinkToken(v: string): boolean {
  return /^[A-Za-z0-9_-]{24,200}$/.test(v);
}

/** A full link is PORTAL_BASE + a token, and nothing else. */
export function isBankLinkUrl(v: string): boolean {
  const prefix = `${PORTAL_BASE}/connect-bank/`;
  return v.startsWith(prefix) && isBankLinkToken(v.slice(prefix.length));
}

/** The value for `shape`, or null with the reason it is not that shape. */
export function bankLinkShapeError(value: string, shape: BankLinkShape): string | null {
  if (shape === "token") {
    return isBankLinkToken(value)
      ? null
      : `expected a bare bank-link token but got ${value.includes("://") ? "a URL" : "an unrecognized value"}`;
  }
  return isBankLinkUrl(value) ? null : "expected a full bank-link URL but got an unrecognized value";
}

function mintTokenValue(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ── Mint / reuse ──────────────────────────────────────────────────────────────

export interface LiveTokenRow { token: string; deal_id: string | null; expires_at: string }

/**
 * THE REUSE RULE, pure and therefore testable (see bankLink.test.ts).
 *
 * Bind to the same deal we're sending for. null-deal matches null-deal: a link
 * minted without a deal must not be handed out as if it named one, and a link
 * naming deal A must not be reused for deal B — the merchant's statements would
 * attach to the wrong file. An unparseable expiry counts as needing extension
 * rather than as "plenty of time left".
 *
 * @param rows live (unexpired) tokens for ONE customer, newest expiry first.
 */
export function pickReusableToken(
  rows: LiveTokenRow[],
  dealId: string | null,
  nowMs: number,
): { match: LiveTokenRow | null; needsExtension: boolean } {
  const match = rows.find((r) => (r.deal_id ?? null) === dealId) ?? null;
  if (!match) return { match: null, needsExtension: false };
  const remainingMs = Date.parse(match.expires_at) - nowMs;
  const healthy = Number.isFinite(remainingMs) && remainingMs >= MIN_REMAINING_DAYS * DAY_MS;
  return { match, needsExtension: !healthy };
}

export interface EnsureBankLinkResult {
  ok: boolean;
  url: string | null;
  token: string | null;
  expiresAt: string | null;
  /** An existing live token was handed back instead of a new one. */
  reused: boolean;
  /** A reused token's expiry was pushed back out to a full TTL. */
  extended: boolean;
  /** Present only on ok:false. Already safe to show a human. */
  error?: string;
}

/**
 * Hand back THE merchant's bank link, minting one only if they don't already
 * have a live one.
 *
 * REUSE IS THE POINT. Every send minting a fresh token is the duplicate-document
 * problem one layer down: the merchant ends up holding three links, uploads
 * against whichever one they find, and ops cannot tell which. So we reuse, and
 * when a reused token is running out we EXTEND it rather than replace it — that
 * way the URL in the email they received three weeks ago keeps working.
 *
 * READS MUST DISTINGUISH UNREADABLE. A failed SELECT here is returned as an
 * error, never as "they have no token" — the latter would mint a duplicate on
 * every transient DB blip, which is precisely the thing this function exists to
 * prevent.
 *
 * @param dealId The deal the link should be bound to, when the caller knows it.
 *   The token names exactly one deal, and merchantDocArrived prefers that over
 *   its own "most recently updated deal" fallback (which is a guess — the nightly
 *   score job rewrites deals.updated_at). Pass null when you genuinely don't know;
 *   do not guess here.
 */
export async function ensureBankLink(
  db: SupabaseClient,
  opts: { customerId: string; dealId?: string | null; createdBy?: string | null },
): Promise<EnsureBankLinkResult> {
  const dealId = opts.dealId ?? null;
  const nowMs = Date.now();

  // ── Is there already a live one? ──
  const { data: existing, error: readErr } = await db
    .from("merchant_bank_link_tokens")
    .select("token, deal_id, expires_at")
    .eq("customer_id", opts.customerId)
    .gt("expires_at", new Date(nowMs).toISOString())
    .order("expires_at", { ascending: false })
    .limit(20);

  if (readErr) {
    // NOT "no token exists" — we could not look. Minting here would create the
    // duplicate this function is supposed to prevent.
    return {
      ok: false, url: null, token: null, expiresAt: null, reused: false, extended: false,
      error: `Could not read this merchant's existing bank links (${readErr.message}), ` +
        `so we could not tell whether they already have one. Nothing was minted.`,
    };
  }

  const rows = (existing ?? []) as LiveTokenRow[];
  const { match, needsExtension } = pickReusableToken(rows, dealId, nowMs);

  if (match) {
    if (!needsExtension) {
      return {
        ok: true, url: bankLinkUrl(match.token), token: match.token,
        expiresAt: match.expires_at, reused: true, extended: false,
      };
    }
    // Running out: push it back to a full TTL so the link in their inbox lives on.
    const newExpiry = new Date(nowMs + TTL_DAYS * DAY_MS).toISOString();
    const { error: upErr } = await db
      .from("merchant_bank_link_tokens")
      .update({ expires_at: newExpiry })
      .eq("token", match.token);
    if (!upErr) {
      return {
        ok: true, url: bankLinkUrl(match.token), token: match.token,
        expiresAt: newExpiry, reused: true, extended: true,
      };
    }
    // Could not extend. Fall through and mint a fresh one — a second live link is
    // worse than one link, but far better than emailing one that expires next week.
    console.warn("[bankLink] could not extend an expiring token; minting a fresh one", upErr.message);
  }

  // ── Mint ──
  const token = mintTokenValue();
  const expiresAt = new Date(nowMs + TTL_DAYS * DAY_MS).toISOString();
  const { error: insErr } = await db.from("merchant_bank_link_tokens").insert({
    token,
    customer_id: opts.customerId,
    deal_id: dealId,
    created_by: opts.createdBy ?? null,
    expires_at: expiresAt,
  });
  if (insErr) {
    return {
      ok: false, url: null, token: null, expiresAt: null, reused: false, extended: false,
      error: `Could not create this merchant's bank link (${insErr.message}).`,
    };
  }
  return { ok: true, url: bankLinkUrl(token), token, expiresAt, reused: false, extended: false };
}

// ── Write it onto the GHL contact, and PROVE it landed ────────────────────────

export interface WriteBankLinkResult {
  /** GHL accepted the custom-field PUT. */
  written: boolean;
  /** We read the contact back and SAW our URL in the field. */
  verified: boolean;
  /**
   * FALSE means the read-back itself failed — GHL would not tell us. That is a
   * different answer from "the field is empty", and reporting it as the latter
   * would be an accusation we cannot support.
   */
  readable: boolean;
  error?: string;
}

/**
 * PUT the URL onto one contact custom field and then read the contact back to
 * confirm the field actually holds it. An enrollment 200 proved nothing on
 * 2026-07-13 and a field-write 200 proves nothing either; the read-back is the
 * evidence.
 *
 * Read-after-write on GHL is not instant, so the read is retried briefly before
 * it is believed.
 */
export async function writeBankLinkToContact(
  cfg: GhlConfig,
  contactId: string,
  opts: { value: string; shape: BankLinkShape; fieldId?: string },
): Promise<WriteBankLinkResult> {
  const fieldId = opts.fieldId ?? BANK_STATEMENT_LINK_FIELD_ID;
  const { value, shape } = opts;

  // ── SHAPE GATE ──
  // The caller says what it is writing and we check it, because the two fields
  // this function serves hold different shapes and the failure is invisible:
  // writing a URL into bank_statement_link produces a document whose link
  // composes to `…/connect-bank/https://…/connect-bank/<token>`, which looks
  // populated everywhere we can see and is dead in the merchant's hands. An
  // exact-equality read-back cannot catch that — it would happily confirm the
  // wrong shape — so the shape is checked BEFORE the write, not after.
  const shapeError = bankLinkShapeError(value, shape);
  if (shapeError) {
    console.error("[bankLink] refusing to write the wrong shape into a contact field", JSON.stringify({
      contactId, fieldId, shape, problem: shapeError,
    }));
    return { written: false, verified: false, readable: true, error: shapeError };
  }

  const put = await updateContactCustomFields(cfg, contactId, [{ id: fieldId, value }]);
  if (!put.ok) {
    console.error("[bankLink] custom-field write rejected", JSON.stringify({
      contactId, fieldId, status: put.status, error: (put.error ?? "").slice(0, 300),
    }));
    return { written: false, verified: false, readable: true, error: put.error ?? String(put.status) };
  }

  // `sawContact` is the whole distinction: did GHL ever actually tell us what the
  // field holds? If it never did, the field being "empty" is OUR blindness, not a
  // fact about the contact, and must not be reported as one.
  let sawContact = false;
  let lastError = "no read attempted";
  for (const wait of [0, 700, 1800]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    let got;
    try {
      got = await getContact(cfg, contactId);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (!got.ok || !got.data?.contact) {
      lastError = got.error ?? `HTTP ${got.status}`;
      continue;
    }
    sawContact = true;
    const cf = ((got.data.contact as Record<string, unknown>).customFields ?? []) as Array<{ id?: string; value?: unknown }>;
    if (cf.some((f) => f.id === fieldId && String(f.value ?? "") === value)) {
      return { written: true, verified: true, readable: true };
    }
    // Readable, and our value is not there (yet). Keep trying for the lag case.
    lastError = "the field did not hold the link";
  }

  return {
    written: true,
    verified: false,
    readable: sawContact,
    error: sawContact
      ? "GHL accepted the write but the contact still does not hold the link"
      : `we could not read the contact back to confirm the write (${lastError})`,
  };
}

// ── The policy the application senders use ────────────────────────────────────

export interface RequireBankLinkResult extends EnsureBankLinkResult {
  verified: boolean;
  /** HTTP status the caller should surface on failure. */
  status: number;
  /** Resolved along the way (the contact-only callers don't know it up front). */
  customerId: string | null;
  dealId: string | null;
}

/**
 * Put a live bank link on the contact BEFORE a document that prints it is sent,
 * or refuse the send.
 *
 * ORDERING IS THE WHOLE POINT. Call this before enrolling the document workflow.
 * If it returns ok:false, DO NOT ENROLL: the document would reach the merchant
 * telling them "here is your personal link" with nothing after it, which is the
 * partial-prefill failure that converts at a third of the fully-prefilled rate.
 * Refusing is recoverable; a broken signed document is not.
 *
 * Every failure message says what to do about it, because the person reading it
 * is a setter mid-call, not an engineer.
 */
export async function requireBankLinkOnContact(
  cfg: GhlConfig,
  db: SupabaseClient,
  opts: {
    contactId: string;
    /** Known on the deal-based senders; resolved from the contact when absent. */
    customerId?: string | null;
    dealId?: string | null;
    createdBy?: string | null;
    fieldId?: string;
  },
): Promise<RequireBankLinkResult> {
  const base = {
    url: null as string | null, token: null as string | null, expiresAt: null as string | null,
    reused: false, extended: false, verified: false,
    customerId: opts.customerId ?? null, dealId: opts.dealId ?? null,
  };

  // ── Who is this? ──
  let customerId = opts.customerId ?? null;
  let dealId = opts.dealId ?? null;
  if (!customerId) {
    const identity = await loadMerchantIdentity(db, { contactId: opts.contactId });
    if (!identity.readable) {
      return {
        ...base, ok: false, status: 502,
        error: `Could not look up the merchant behind GHL contact ${opts.contactId} ` +
          `(${identity.unreadableReason ?? "unknown reason"}), so their bank-statement link could not be ` +
          `prepared. Nothing was sent — try again in a moment.`,
      };
    }
    customerId = identity.customerId;
    if (!customerId) {
      // TWO DIFFERENT FAILURES, and they must not share a sentence. `partial`
      // means we DID find something — a contact tied to more than one merchant,
      // or one we hold no merchant row for at all — and the scopeNote says which.
      // Reporting an ambiguous merchant as "no merchant on file" is an accusation
      // the data does not support (one such contact exists live, read 2026-11-02).
      return {
        ...base, ok: false, status: 422,
        error: identity.partial && identity.scopeNote
          ? `The merchant behind this GHL contact could not be pinned down — ${identity.scopeNote}. ` +
            `Their bank-statement link names exactly one merchant file, so creating it would risk ` +
            `pointing their statements at the wrong business, and the application prints that link. ` +
            `NOTHING WAS SENT. Open the right business in the Playbook and send from there.`
          : `There is no merchant record on file for this GHL contact, so their personal ` +
            `bank-statement link cannot be created — and the application prints that link, so it ` +
            `would go out blank. Nothing was sent. Open the merchant in the Playbook first (that ` +
            `creates their record), then send the application.`,
      };
    }
    base.customerId = customerId;
  }

  // ── Which deal? Bind it when the answer is unambiguous; never guess. ──
  if (!dealId) {
    const { data: deals, error: dealErr } = await db
      .from("deals").select("id").eq("customer_id", customerId).limit(2);
    if (dealErr) {
      return {
        ...base, ok: false, status: 502,
        error: `Could not read this merchant's deals (${dealErr.message}), so their bank-statement ` +
          `link could not be prepared. Nothing was sent — try again in a moment.`,
      };
    }
    // Exactly one deal = no ambiguity. Two or more and we leave it unbound rather
    // than attach their statements to the wrong file; merchantDocArrived's own
    // documented fallback then applies.
    if ((deals ?? []).length === 1) dealId = (deals![0] as { id: string }).id;
    base.dealId = dealId;
  }

  // ── Mint or reuse ──
  const link = await ensureBankLink(db, { customerId, dealId, createdBy: opts.createdBy ?? null });
  if (!link.ok || !link.url || !link.token) {
    return {
      ...base, ok: false, status: 502,
      error: `${link.error ?? "Could not create the bank-statement link."} The application prints ` +
        `that link, so nothing was sent.`,
    };
  }

  // ── Write it where the document reads it from, and prove it landed ──
  // The BARE TOKEN: the document composes PORTAL_BASE around the merge tag at
  // both its use sites (body §9 and the post-signing redirect), because GHL's
  // redirect setting only accepts a value shaped like a URL. See the shape note
  // at the top of this file before changing this to link.url.
  const write = await writeBankLinkToContact(cfg, opts.contactId, {
    value: link.token,
    shape: "token",
    fieldId: opts.fieldId,
  });
  if (!write.verified) {
    console.error("[bankLink] refusing the send — link not confirmed on the contact", JSON.stringify({
      contactId: opts.contactId, customerId, dealId,
      written: write.written, readable: write.readable, error: write.error,
    }));
    return {
      ...base, ...link, ok: false, status: 502, customerId, dealId,
      error: write.written
        ? `The merchant's bank-statement link was created, but ${write.error}. The application ` +
          `prints that link and would have reached them with it missing, so NOTHING WAS SENT. ` +
          `Re-fire the send; if it keeps failing, the "Bank Statement Link" contact field in GHL ` +
          `needs looking at.`
        : `GHL rejected the write of the merchant's bank-statement link (${write.error}). The ` +
          `application prints that link, so NOTHING WAS SENT.`,
    };
  }

  console.log("[bankLink] link confirmed on contact", JSON.stringify({
    contactId: opts.contactId, customerId, dealId,
    reused: link.reused, extended: link.extended, expires_at: link.expiresAt,
    // Never the token: the URL is a bearer credential for this merchant's file.
    url: maskBankLinkTokens(link.url),
  }));

  return { ...link, ok: true, status: 200, verified: true, customerId, dealId };
}

/** One short clause for an activity-log note. No URL, no token. */
export function bankLinkTrailNote(r: RequireBankLinkResult): string {
  if (!r.ok) return "";
  const which = r.reused ? (r.extended ? "their existing bank link (expiry extended)" : "their existing bank link") : "a new bank link";
  const until = r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : "unknown";
  return `Bank-statement link: ${which}, confirmed on the GHL contact, valid to ${until}.`;
}
