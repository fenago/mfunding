// ───────────────────── GHL e-sign document grouping ─────────────────────
// Shared types + grouping helper for the live e-sign/upload status that the
// `ghl-docs-status` edge function returns for a merchant. Extracted verbatim from
// PlaybooksPage's DocsBack section so multiple surfaces (the Revenue Playbook and
// the Setter Operations console) render the SAME grouped view without duplicating
// the collapse-copies logic. Read-only shaping — no fetching, no side effects.

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
