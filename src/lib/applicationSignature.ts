// applicationSignature — THE one definition of "has the merchant actually SIGNED
// their application?", and the honest three-state answer to that question.
//
// WHY THIS FILE EXISTS
// The owner's complaint, 2026-09-17: "in many places i see 'application sent' but
// there is not a visible way to see if it was signed... just saying application
// sent (but it is unsigned), that is a problem." Measured against live the same
// day: of 63 deals with an application sent, only 14 have a signed application on
// file, and 12 of the rest are still parked at status `application_sent`. So the
// stage chip alone is actively misleading on roughly four deals in five.
//
// (The precise claim is "14 signed, 49 not established" — see the LAZY LEDGER
// note on signaturesByCustomer. Either way the stage chip is silent about the
// one thing that matters.)
//
// Fixing that means putting a signed/unsigned badge on every surface that says
// "Application sent" — and the instant you do that, the TEST for "signed" is
// being evaluated in a dozen places. It was already being evaluated in four:
// SetterDealList, QuickAppModal, campaignAuditService, campaignMonteCarloService,
// each carrying its own copy of /application|prefill|partial/i, plus a fifth copy
// inside processor_pipeline_rows() in SQL. This codebase has been bitten
// repeatedly by lockstep duplicates, so the test lives here now and those callers
// import it.
//
// ── WHERE THE SIGNATURE ACTUALLY LIVES ──────────────────────────────────────
// public.ghl_doc_completions — the ledger of GHL/VibeReach e-sign completions,
// keyed on CUSTOMER (not deal), written when a document comes back completed.
// Nothing else records a merchant signature: merchant_documents holds 2 rows,
// both void, and mca_applications has no signature column at all. Measured
// inventory of doc_name, 2026-09-17:
//
//     MCA — Broker Compensation Disclosure   15 completions / 13 merchants
//     04B MCA PREFILL                        12 completions / 11 merchants
//     04C MCA PARTIAL                         2 completions /  2 merchants
//     MCA_Merchant_Funding_Application        1 completion  /  1 merchant
//
// ── THE DISCLOSURE TRAP ─────────────────────────────────────────────────────
// The Broker Compensation Disclosure is NOT the application. It is a one-page
// compensation disclosure a merchant can sign without ever completing (or even
// opening) the funding application. Two merchants have signed ONLY that, and
// rendering them as "signed" would tell the processor to stop chasing the exact
// signature she is supposed to be chasing.
//
// Today's doc names don't collide — "Broker Compensation Disclosure" contains no
// "application"/"prefill"/"partial" — so even the loose legacy pattern happens to
// be safe right now. It is one badly-named future template away from not being
// safe, and the failure mode is silent and points the wrong way, so
// isApplicationDoc() EXCLUDES disclosure docs explicitly before it tests anything
// else. Belt and braces on the one classification that must not go wrong.
//
// KEEP IN SYNC: public.is_application_doc_name(text) is the SQL half of this
// same classification, used by processor_application_queue(). The two are
// MIRRORS — the whitelist and the defensive pattern below are ported from it
// verbatim. If one changes the other changes in the same commit.
//
// (The legacy `doc_name ~* 'application|prefill|partial'` inside
// processor_pipeline_rows() is LOOSER than both: it would classify a document
// called e.g. "MCA Application Authorization" as a signed application. It has no
// false positives against today's four doc names, but it is not the definition —
// this is.)
//
// ── UNREADABLE IS NEVER "UNSIGNED" ──────────────────────────────────────────
// An "UNSIGNED" badge is an accusation aimed at whoever was supposed to chase the
// signature. It may only be rendered off a read that SUCCEEDED and came back
// without an application completion. A failed read is a third state — `unknown` —
// and every surface must render it as such. This is the same rule that governs
// NEVER DIALED in HotLeadsPanel, and it exists because this codebase has shipped
// four outages where a failed read was consumed as a successful empty one.

/** The application templates we actually send, by exact name. */
const APPLICATION_DOC_NAMES = new Set([
  "04B MCA PREFILL",
  "04C MCA PARTIAL",
  "MCA_Merchant_Funding_Application",
]);

/** Defensive: a renamed or newly added application template still reads as the
 *  application rather than silently becoming invisible. */
const APPLICATION_DOC_RE = /(funding[ _-]*application|mca[ _]*(prefill|partial))/i;

/** Doc names that are the compensation disclosure — signed separately, and NOT
 *  the application. See "THE DISCLOSURE TRAP" above. */
const DISCLOSURE_DOC_RE = /disclosure/i;

/** Is this completed document the merchant's signed APPLICATION?
 *  MIRROR of public.is_application_doc_name(text). */
export function isApplicationDoc(docName: string | null | undefined): boolean {
  const name = (docName ?? "").trim();
  if (!name) return false;
  // Disclosure first, deliberately: a doc that reads as both is a disclosure,
  // never an application.
  if (DISCLOSURE_DOC_RE.test(name)) return false;
  if (APPLICATION_DOC_NAMES.has(name)) return true;
  return APPLICATION_DOC_RE.test(name);
}

/** Is this completed document the Broker Compensation Disclosure (or similar)? */
export function isDisclosureDoc(docName: string | null | undefined): boolean {
  return DISCLOSURE_DOC_RE.test((docName ?? "").trim());
}

/** One row of the completion ledger, as any caller reads it. */
export interface DocCompletion {
  customer_id?: string | null;
  doc_name: string | null;
  completed_seen_at?: string | null;
}

/**
 * The signature answer. THREE states, never two.
 *
 * `unknown` is not a nicety — it is the state the UI must land in whenever the
 * completion ledger could not be read, so that a network blip never renders as
 * an accusation that a merchant didn't sign.
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
       *  application — the specific near-miss that looks like progress. */
      disclosureSignedAt: string | null;
    }
  | {
      kind: "signed";
      signedAt: string | null;
      /** Which document came back — "04B MCA PREFILL" etc. */
      docName: string | null;
    };

/** UNREADABLE. Use this — never `unsigned` — when a read fails. */
export function signatureUnknown(message: string): SignatureState {
  return { kind: "unknown", message };
}

/**
 * Classify one merchant's completion rows.
 *
 * @param rows the ledger rows for ONE customer. `null`/`undefined` means the read
 *   FAILED or this customer was never looked up — both are `unknown`, never
 *   "unsigned".
 *
 * ⚠ An EMPTY ARRAY returns `unsigned`, and that is only CORRECT for a customer
 * you have separately established we actually checked. The ledger is lazy (see
 * signaturesByCustomer), so for an unchecked merchant an empty array means
 * "nobody looked", not "they didn't sign". Prefer signaturesByCustomer(), which
 * applies that gate for you; call this directly only when you already hold the
 * ghl_docs_checked_at proof.
 */
export function signatureFromCompletions(
  rows: DocCompletion[] | null | undefined,
  unknownMessage = "the signature ledger could not be read",
): SignatureState {
  if (!rows) return signatureUnknown(unknownMessage);

  let signedAt: string | null = null;
  let docName: string | null = null;
  let disclosureSignedAt: string | null = null;

  for (const r of rows) {
    if (isApplicationDoc(r.doc_name)) {
      const at = r.completed_seen_at ?? null;
      // Newest application completion wins; a row with no stamp still counts as
      // signed (we know it came back, we just can't date it).
      if (signedAt === null || (at !== null && at > signedAt)) {
        signedAt = at ?? signedAt;
        docName = r.doc_name;
      }
      if (docName === null) docName = r.doc_name;
    } else if (isDisclosureDoc(r.doc_name)) {
      const at = r.completed_seen_at ?? null;
      if (at !== null && (disclosureSignedAt === null || at > disclosureSignedAt)) {
        disclosureSignedAt = at;
      }
    }
  }

  if (docName !== null) return { kind: "signed", signedAt, docName };
  return { kind: "unsigned", disclosureSignedAt };
}

/**
 * Build the per-customer map from ONE batched ledger read.
 *
 * ── THE LEDGER IS LAZY, AND THAT CHANGES EVERYTHING ────────────────────────
 * public.ghl_doc_completions is NOT a sweep. It is written only by the
 * ghl-docs-status edge function, i.e. only for merchants whose documents
 * somebody actually opened. Measured 2026-09-17: just 16 of 339 customers have
 * ever been checked (customers.ghl_docs_checked_at), and of the 63 deals with an
 * application sent, only 16 have a checked merchant.
 *
 * So an ABSENT completion row means EITHER "they didn't sign" OR "nobody ever
 * looked", and those are not the same claim. Treating the second as the first is
 * the accusation this whole module exists to prevent — it would send the
 * processor chasing signatures merchants may already have given, and would tell
 * the owner 49 people failed to sign when the true figure is "14 signed, and 49
 * we haven't established". `unsigned` is therefore returned ONLY for a customer
 * we have positively checked.
 *
 * `customers.ghl_docs_checked_at` is the marker that we DID look, stamped by
 * ghl-docs-status when its read could genuinely have seen that contact's
 * documents. The Application chase tab's "Check signature" button resolves an
 * unknown into a real answer by calling that function.
 *
 * @param rows every completion row returned for `customerIds`, or `null` if the
 *   read failed (→ everyone `unknown`).
 * @param checked the customers we have positively checked, and when. A customer
 *   absent from this map has NOT been checked → `unknown`, never `unsigned`.
 *   Pass `null` when the customers read itself failed (→ everyone `unknown`).
 * @param customerIds the customers that were ASKED about. A customer NOT in this
 *   list is absent from the returned map, and callers must treat absence as
 *   `unknown`.
 */
export function signaturesByCustomer(
  rows: DocCompletion[] | null,
  customerIds: string[],
  checked: Map<string, string | null> | null,
  unknownMessage = "the signature ledger could not be read",
): Map<string, SignatureState> {
  const out = new Map<string, SignatureState>();
  if (!rows || !checked) {
    for (const id of customerIds) out.set(id, signatureUnknown(unknownMessage));
    return out;
  }
  const grouped = new Map<string, DocCompletion[]>();
  for (const r of rows) {
    const id = r.customer_id ?? "";
    if (!id) continue;
    const list = grouped.get(id);
    if (list) list.push(r);
    else grouped.set(id, [r]);
  }
  for (const id of customerIds) {
    const mine = grouped.get(id) ?? [];
    const verdict = signatureFromCompletions(mine, unknownMessage);
    // A SIGNED verdict stands on its own: a completion row is positive evidence,
    // whether or not the "we looked" stamp happens to be set.
    if (verdict.kind === "signed") {
      out.set(id, verdict);
      continue;
    }
    // Everything else needs the stamp before it may be called "unsigned".
    out.set(
      id,
      checked.get(id)
        ? verdict
        : signatureUnknown(
            "nobody has ever checked this merchant's e-signed documents, so an absent signature proves nothing",
          ),
    );
  }
  return out;
}

/**
 * Classify from the timestamps a server-side RPC already resolved, instead of
 * from raw ledger rows. Used by surfaces fed by processor_pipeline_rows() /
 * processor_application_queue(), which do the doc-name matching in SQL.
 *
 * `readable: false` means the RPC itself told us it could not resolve the
 * signature — pass it through as `unknown` rather than inventing an "unsigned".
 */
/**
 * The tri-state processor_application_queue() returns per document:
 *   signed      — a completion for that document is on file.
 *   not_signed  — we HAVE checked this merchant's GHL documents and there isn't one.
 *   unchecked   — we have never checked (no ghl_contact_id, or ghl_docs_checked_at
 *                 is null). NOT a denial. This is the state that exists precisely
 *                 so an unsigned badge is never rendered off a check we never ran.
 */
export type SignedState = "signed" | "not_signed" | "unchecked";

/** Map one row of processor_application_queue() to the UI's SignatureState. */
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
    // "unchecked", or a state we don't recognise. Either way we have not proven
    // anything, so we say so rather than accusing the merchant of not signing.
    return signatureUnknown(
      "this merchant's e-signed documents have never been checked — they have no VibeReach contact link, or the document sweep has not run for them",
    );
  }
  return {
    kind: "unsigned",
    // Only claim disclosure-only when the disclosure check itself succeeded.
    disclosureSignedAt: row.disclosure_state === "signed" ? row.disclosure_signed_at : null,
  };
}

export function signatureFromStamps(opts: {
  appSignedAt: string | null | undefined;
  disclosureSignedAt?: string | null;
  /**
   * Whether an ABSENT signature may be reported as "unsigned". Pass `false` on
   * any surface whose RPC resolves the signature without also telling you
   * whether the merchant's documents were ever checked — processor_pipeline_rows
   * is one: it has no readability channel, so a null stamp there means "no
   * completion row", which for an unchecked merchant proves nothing.
   * A positive signature always wins and is reported regardless.
   */
  readable?: boolean;
  unknownMessage?: string;
}): SignatureState {
  // Positive evidence stands on its own — a completion row is a fact.
  if (opts.appSignedAt) {
    return { kind: "signed", signedAt: opts.appSignedAt, docName: null };
  }
  if (opts.readable === false) {
    return signatureUnknown(
      opts.unknownMessage ??
        "this view can't tell whether the merchant's documents were ever checked, so an absent signature proves nothing",
    );
  }
  return { kind: "unsigned", disclosureSignedAt: opts.disclosureSignedAt ?? null };
}
