// ghlProposalDocs — ONE definition of how to read GHL's /proposals/document.
//
// There were three open-coded copies of this paging loop (ghl-doc-sweep,
// ghl-docs-status, and crawlCompletedDocs in ghlDocCompletions.ts), each with its
// own page cap, its own completeness test and its own error string. They agreed
// today by coincidence, which is the same footing the ordering assumption below
// was on.
//
// ── WHAT THIS ENDPOINT ACTUALLY SUPPORTS (probed live 2026-09-18) ────────────
//   limit                 caps at 21 — 422 above it
//   skip=N                works; the set is fully walkable
//   status=completed      works, and `total` drops to just the completed ones
//   query=<text>          WORKS. The ONLY targeted filter there is. It matches the
//                         document NAME and the recipient's NAME — NOT their email
//                         (query=badialimonetwork@icloud.com returns 0).
//                         Selectivity: query=Derian → 2, query=Badia → 8, against
//                         284 location-wide.
//   contactId / recipientId / documentId / offset / page / search
//                         all REJECTED, "property should not exist"
//   sortBy / sort         ⚠ ALSO REJECTED — 422 "property sortBy should not exist"
//
// THAT LAST LINE IS THE IMPORTANT ONE. Every unpaged reader in this repo assumed
// documents come back newest-first. That is not a default we opted into; it is one
// we CANNOT REQUEST and are not promised. A reader that takes `limit=20` and hopes
// the thing it wants is near the front is resting on undocumented behaviour, and
// if it ever flipped to oldest-first those readers would fail silently and totally.
//
// So the rule this module exists to enforce: DO NOT DEPEND ON ORDER. Either crawl
// to `total` and hold the complete set (then order is irrelevant), or narrow with
// `query` so the whole answer fits in one page (then order is irrelevant). Never
// take the first N of an unknown ordering and treat absence as proof.
//
// ── COMPLETE MEANS FETCHED REACHED THE REPORTED TOTAL ───────────────────────
// `complete` is the single most load-bearing field here: it is what licenses any
// caller to treat absence as evidence. A merchant was reported as having no
// documents off a 273-of-282 read, and had in fact signed. Returning complete:true
// for a partial read is the whole class of bug this repo keeps paying for.
//
// Note also what `complete` does NOT mean: it says the crawl read everything that
// existed WHEN IT RAN, not that the answer is current. Freshness is the caller's
// problem — see ghl_document_crawls.ran_at and the unknown_stale verdicts.

import { ghlFetch, type GhlConfig } from "./ghl.ts";

/** GHL caps the proposals list at 21 per page (422 above it). */
export const DOC_PAGE = 21;

/** The subset of a proposal document these crawlers care about. Deliberately
 *  loose — callers narrow it themselves. */
export interface ProposalDocument {
  _id?: string;
  documentId?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  recipients?: Array<{
    id?: string; entityName?: string; email?: string;
    hasCompleted?: boolean; signedDate?: string;
  }>;
  links?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface DocumentCrawl<T = ProposalDocument> {
  docs: T[];
  /** GHL's own count for this filter, or null if it never said. */
  reportedTotal: number | null;
  ghlCalls: number;
  /**
   * TRUE only when the fetch count reached the reported total. A caller may treat
   * absence as proof ONLY when this is true and `error` is null. Anything else is
   * "we could not see", which is a different sentence from "there is nothing".
   */
  complete: boolean;
  /** Non-null means a page was UNREADABLE — neither empty nor complete. */
  error: string | null;
  /** Remaining daily GHL quota off the last response's headers; null = unreadable,
   *  which is neither "plenty" nor "none". */
  dailyRemaining: number | null;
}

export interface CrawlOptions {
  /** Hard page cap. Raise it deliberately as the account grows — never silently. */
  maxPages: number;
  /** e.g. "completed" to read only signed documents. Omit for every document. */
  status?: string;
  /**
   * Narrow to a recipient or document NAME. When this makes the result fit in one
   * page, ordering stops mattering — which is the point. Not an email.
   */
  query?: string;
}

/**
 * Walk /proposals/document to `total`, or to `maxPages`, whichever comes first.
 *
 * The ONLY reader of this endpoint anything in this repo should use. If you find
 * yourself writing `limit=20` with no `skip`, you are writing the bug described in
 * the header.
 */
export async function crawlDocuments<T = ProposalDocument>(
  cfg: GhlConfig,
  opts: CrawlOptions,
): Promise<DocumentCrawl<T>> {
  const out: DocumentCrawl<T> = {
    docs: [], reportedTotal: null, ghlCalls: 0, complete: false, error: null, dailyRemaining: null,
  };
  const statusQs = opts.status ? `&status=${encodeURIComponent(opts.status)}` : "";
  const queryQs = opts.query?.trim() ? `&query=${encodeURIComponent(opts.query.trim())}` : "";

  for (let page = 0; page < opts.maxPages; page++) {
    const res = await ghlFetch<{ documents?: T[]; total?: number }>(
      cfg,
      "GET",
      `/proposals/document?locationId=${cfg.locationId}&limit=${DOC_PAGE}&skip=${page * DOC_PAGE}${statusQs}${queryQs}`,
    );
    out.ghlCalls++;
    if (res.rate?.dailyRemaining != null) out.dailyRemaining = res.rate.dailyRemaining;
    if (!res.ok) {
      // UNREADABLE. Keep what we already have — a document we can see is still
      // worth having — but the crawl is not complete, so absence proves nothing.
      out.error = `documents page ${page} failed (${res.status}): ${res.error ?? ""}`;
      return out;
    }
    const got = res.data?.documents ?? [];
    if (typeof res.data?.total === "number") out.reportedTotal = res.data.total;
    out.docs.push(...got);
    if (got.length === 0) { out.complete = true; return out; }
    if (out.reportedTotal !== null && out.docs.length >= out.reportedTotal) {
      out.complete = true;
      return out;
    }
  }

  // Ran out of pages before reaching `total`. Deliberate for a shallow reader, a
  // fault for a reconcile — either way it is NOT complete and says so.
  out.error = `document crawl stopped at ${out.docs.length} of ${out.reportedTotal ?? "?"} after ${opts.maxPages} pages`;
  return out;
}
