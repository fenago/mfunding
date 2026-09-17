// applicationSignature — the UI's three-state answer to "has the merchant
// actually SIGNED their application?", and nothing else.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
// It does NOT decide which document counts as the application, and it does NOT
// decide signed-vs-unsigned. Both live in SQL:
//   · public.is_application_doc_name(text)  — the doc-name rule
//   · processor_application_queue() / deal_application_status(uuid[])
//                                          — the resolved three-state verdict
// An earlier version of this file carried a TypeScript mirror of the doc-name
// rule. That mirror is gone on purpose: the rule had already been copy-pasted
// into five places, and one of those copies (/application|prefill/i) missed
// '04C MCA PARTIAL' — the DEFAULT send path — so signed applications on the most
// common template read as unsigned. A mirror that is only checked by hand is a
// drift bug with a delay fuse. The readers call the RPC.
//
// What is left here is presentation-layer: the shape the badge consumes, and the
// one adapter that maps a queue row onto it. (deal_application_status rows are
// mapped by signatureFromStatus in src/hooks/useApplicationSignatures.ts, next
// to the hook that reads them.)
//
// ── WHY THE OWNER ASKED FOR THIS ────────────────────────────────────────────
// 2026-09-17: "in many places i see 'application sent' but there is not a
// visible way to see if it was signed... just saying application sent (but it is
// unsigned), that is a problem." Measured the same day: 63 deals carry an
// application_sent_at, 4 of those stamps are not sends at all, and of the 59
// real sends only 16 have a signed application on file.
//
// ── UNREADABLE IS NEVER "UNSIGNED" ──────────────────────────────────────────
// An "UNSIGNED" badge is an accusation aimed at whoever was supposed to chase
// the signature. It may only be rendered off a verdict that was actually
// established. ghl_doc_completions used to be a lazy mirror written only when a
// human opened a contact's documents (16 of 339 customers ever), so absence
// meant "nobody looked" far more often than "they didn't sign"; ghl-doc-sweep
// now refreshes the whole account hourly in two API calls and 'unchecked' is
// zero across the board. The third state stays for two live reasons: a crawl can
// fail, and a customer with no VibeReach contact id can never be proven either
// way (there is one). The day a sweep breaks, the honest output is "we don't
// know" — not three hundred accusations.

/**
 * The signature answer. THREE states, never two.
 *
 * `unknown` is not a nicety — it is where the UI must land whenever the verdict
 * was not established, so that a failed sweep never renders as a merchant who
 * refused to sign.
 */
export type SignatureState =
  | {
      kind: "unknown";
      /** Why we can't say — shown to the reader, never swallowed. */
      message: string;
    }
  | {
      kind: "unsigned";
      /** Set when they signed the compensation disclosure but NOT the
       *  application — the specific near-miss that looks like progress.
       *
       *  The Broker Compensation Disclosure is a separate one-page document a
       *  merchant can sign without ever opening the funding application. Two
       *  merchants have signed only that, and showing them as "signed" would
       *  stop the processor chasing the exact signature she is chasing. The SQL
       *  rule excludes /disclosure/i before anything else so it can never
       *  contaminate the application verdict. */
      disclosureSignedAt: string | null;
    }
  | {
      kind: "signed";
      /** The merchant's REAL signature time (GHL recipient.signedDate) since
       *  ghl-doc-sweep — not "when our copy noticed", which could lag by however
       *  long nobody happened to open that contact. Safe to show as an age. */
      signedAt: string | null;
      /** Which document came back, where the caller knows it. */
      docName: string | null;
    };

/** UNREADABLE. Use this — never `unsigned` — when a verdict was not established. */
export function signatureUnknown(message: string): SignatureState {
  return { kind: "unknown", message };
}

/**
 * The tri-state the RPCs return per document:
 *   signed      — a completion for that document is on file.
 *   not_signed  — we HAVE read this contact's documents and there isn't one.
 *   unchecked   — not read yet (no ghl_contact_id, or ghl_docs_checked_at null).
 *                 NOT a denial.
 */
export type SignedState = "signed" | "not_signed" | "unchecked";

/** Map a processor_application_queue() row to the UI's SignatureState. */
export function signatureFromQueueRow(row: {
  app_signed_at: string | null;
  app_signed_state: string | null;
  app_signed_checked_at: string | null;
  disclosure_signed_at: string | null;
  disclosure_state: string | null;
}): SignatureState {
  if (row.app_signed_state === "signed" || row.app_signed_at) {
    return { kind: "signed", signedAt: row.app_signed_at, docName: null };
  }
  if (row.app_signed_state !== "not_signed") {
    // "unchecked", or a state we don't recognise. Either way nothing has been
    // established, so we say so rather than accusing the merchant of not signing.
    return signatureUnknown(
      "this merchant's e-signed documents have not been read yet — the hourly signature sweep has not covered them",
    );
  }
  return {
    kind: "unsigned",
    // Only claim disclosure-only when the disclosure check itself succeeded.
    disclosureSignedAt: row.disclosure_state === "signed" ? row.disclosure_signed_at : null,
  };
}
