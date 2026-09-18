// ───────────────────── GHL e-sign document grouping ─────────────────────
// Shared types + grouping helper for the live e-sign/upload status that the
// `ghl-docs-status` edge function returns for a merchant. Extracted verbatim from
// PlaybooksPage's DocsBack section so multiple surfaces (the Revenue Playbook and
// the Setter Operations console) render the SAME grouped view without duplicating
// the collapse-copies logic. Read-only shaping — no fetching, no side effects.
//
// ── IF YOU ARE ADDING A CALLER OF ghl-docs-status, READ THIS ────────────────
// The function caches the location-wide document list for 60s (isolate-local).
// That cache exists because paginating the list to fix a real bug — 53 of 61
// contacts with a document awaiting signature were invisible, 44 of them with a
// portal login who opened it and were shown nothing to sign — multiplied the
// function's cost by the page count, on a path the merchant portal polls on load
// and focus. It turned ~226 invocations/day into ~2,900 GHL calls against a
// 200k/day account cap, and the multiplier grows with the document count.
//
// So the cache is the default and should stay the default. Pass
// `{ refresh: true }` ONLY when this test is met:
//
//     DOES A STALE READ HERE PRODUCE AN ACCUSATION?
//
// Not "is this after a send" — that is the wrong question and it lets too much
// through. The question is whether a ≤60s-old answer would make this surface
// assert something false ABOUT A PERSON. Two of the twelve callers qualify:
//
//   PlaybooksPage's post-send guard — a cached pre-send list has no application
//     in it, so it announces "the send may have failed" about a send that just
//     succeeded. That accuses a closer.
//   AdHocSendMenu — a closer sends a document, reopens the menu to copy its
//     signing link, and inside the window the link is missing, implying they
//     never sent it. They send it twice, and the merchant gets two.
//
// The other ten are mount-time panels, context bars and the portal poll: a
// 60-second-old document list is simply a slightly old document list, which
// accuses nobody. They keep the cache.
//
// ⚠ The cache is ISOLATE-LOCAL. `refresh: true` guarantees the response YOU get
// is fresh; it does not flush other isolates, which may still serve a ≤60s copy
// to a different caller. Sound for a caller that reads its own response — do not
// lean on it to make a SUBSEQUENT poll fresh.
//
// The same question governs "NEVER DIALED", "UNSIGNED" and "the send failed"
// elsewhere in this codebase: a claim about what a person did or failed to do
// may only be made from data we can prove.

/** One document as GHL reports it: a proposal/estimate/contract sent to the
 *  merchant, its current status, whether it's signed, when it last changed, and
 *  the signer's (merchant-bound) link when present. */
export type GhlDoc = {
  name: string;
  status: string;
  signed: boolean;
  updatedAt: string | null;
  url: string | null;
};

/** The full ghl-docs-status payload. The fields after `uploads` exist so a
 *  caller can tell WHY the list is empty — see readDocsStatus below. */
export type GhlDocsStatus = {
  ok?: boolean;
  documents?: GhlDoc[];
  uploads?: Array<{ field: string; files: Array<{ name: string; url: string | null }> }>;
  documents_error?: string | null;
  uploads_error?: string | null;
  /** FALSE = we never worked out which GHL contacts to search. Not "none found". */
  identity_readable?: boolean;
  identity_error?: string | null;
  /** TRUE = only ONE contact was searched because it couldn't be tied to exactly
   *  one merchant. The documents shown are real; their absence isn't proof. */
  identity_partial?: boolean;
  identity_note?: string | null;
  /** Every GHL contact id this merchant is known by. >1 means the CRM has dupes. */
  merchant_contacts?: string[];
  merchant_contact_count?: number;
  error?: string;
};

/**
 * AN EMPTY DOCUMENT LIST MEANS TWO DIFFERENT THINGS AND A SURFACE MUST NOT
 * CONFLATE THEM.
 *
 * On 2026-09-18 a merchant signed two disclosures and every surface in the app
 * said "Nothing sent yet" while the owner had him on the phone. The read had
 * asked GHL about the wrong one of his three contacts, correctly got nothing
 * back, and printed that nothing as a statement about what the MERCHANT had done.
 *
 * So: route every ghl-docs-status response through this. `unreadable` must be
 * rendered as "we couldn't check", never as "they haven't signed". The
 * distinction is the whole point — see the hard rule in
 * supabase/functions/_shared/merchantIdentity.ts.
 */
export type DocsReadState =
  | {
      kind: "ok";
      docs: GhlDoc[];
      contactCount: number;
      /** Set when only one contact could be searched — show it, but never let an
       *  empty `docs` under it become a claim about the merchant. */
      caveat: string | null;
      status: GhlDocsStatus;
    }
  | { kind: "unreadable"; why: string };

export function readDocsStatus(
  data: GhlDocsStatus | null | undefined,
  invokeError?: { message: string } | null,
): DocsReadState {
  if (invokeError) return { kind: "unreadable", why: invokeError.message };
  if (!data) return { kind: "unreadable", why: "VibeReach returned nothing" };
  if (data.error) return { kind: "unreadable", why: data.error };
  // The document crawl failed or was truncated — the list we hold is a floor,
  // not the whole truth, so absence from it proves nothing.
  if (data.documents_error) return { kind: "unreadable", why: data.documents_error };
  // We never established which contacts belong to this merchant.
  if (data.identity_readable === false) {
    return { kind: "unreadable", why: data.identity_error ?? "couldn't identify this merchant in VibeReach" };
  }
  return {
    kind: "ok",
    docs: data.documents ?? [],
    contactCount: data.merchant_contact_count ?? (data.merchant_contacts?.length ?? 1),
    caveat: data.identity_partial ? (data.identity_note ?? "only one VibeReach contact could be searched") : null,
    status: data,
  };
}

/** One line a human can act on when a merchant maps to several GHL contacts.
 *  Null when there is nothing unusual to say. */
export function duplicateContactNote(contactCount: number): string | null {
  if (contactCount <= 1) return null;
  return `⚠ ${contactCount} VibeReach contacts for this merchant — their documents can be filed against any of them. All ${contactCount} were searched.`;
}

/** Copies of the SAME document collapsed into one group: the newest copy as
 *  `latest`, any superseded copies in `older`, and how many total. */
export type DocGroup = {
  key: string;
  latest: GhlDoc;
  older: GhlDoc[];
  count: number;
};

const normalizeDocName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const docTs = (d: GhlDoc) => (d.updatedAt ? new Date(d.updatedAt).getTime() : 0);

/**
 * GHL re-sends the same document when a closer edits/re-issues it (e.g. fields
 * were filled in late), so the raw list can carry several copies of the same
 * doc — some stale, some signed. Collapse copies of the SAME document into one
 * group so the reader sees a single, unambiguous "latest" status instead of a
 * flat pile with no hierarchy.
 */
/**
 * Open an UPLOADED VibeReach file (a `documents/download/<id>` URL). Those URLs
 * require the API bearer token, so a raw <a href> shows staff a login/403 page —
 * the file must be opened through the `ghl-docs-status` download proxy, which
 * validates the file belongs to the contact and returns GHL's time-limited
 * SIGNED storage URL (public, no auth needed).
 *
 * ⚠ Call this synchronously from the click handler: it opens the tab BEFORE
 * awaiting (popup blockers silently kill window.open after an await).
 * Throws with a readable message on failure so callers can surface it.
 */
export async function openGhlUploadViaProxy(
  supabase: { functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message: string } | null }> } },
  ghlContactId: string,
  url: string,
): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { data, error } = await supabase.functions.invoke("ghl-docs-status", {
      body: { action: "download", ghl_contact_id: ghlContactId, url },
    });
    if (error) throw new Error(error.message);
    const signed = (data as { url?: string; error?: string } | null)?.url;
    if (!signed) throw new Error((data as { error?: string } | null)?.error || "VibeReach didn't return a viewable link for that file.");
    if (tab) tab.location.href = signed;
    else window.location.assign(signed); // popup blocked → same-tab fallback
  } catch (e) {
    if (tab) tab.close();
    throw e;
  }
}

export function groupDocs(docs: GhlDoc[]): DocGroup[] {
  const map = new Map<string, GhlDoc[]>(); // insertion order = first-appearance order (stable)
  for (const d of docs) {
    const key = normalizeDocName(d.name);
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return [...map.entries()].map(([key, arr]) => {
    const sorted = [...arr].sort((a, b) => docTs(b) - docTs(a)); // newest first
    return { key, latest: sorted[0], older: sorted.slice(1), count: sorted.length };
  });
}
