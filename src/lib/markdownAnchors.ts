// Heading → anchor id, with de-duplication across a single document.
//
// Lives here, not in MarkdownDoc.tsx, so that BOTH the renderer (which stamps the
// ids onto h2/h3) and any table of contents built from the same markdown call the
// SAME function. One implementation means the TOC links and the heading ids
// cannot drift apart — a TOC that scrolls nowhere is the classic bug here.
//
// Call the factory once per document and reuse the returned function in source
// order: the dedup counter is what makes two identically-named headings resolve
// to distinct anchors.

export function headingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base =
      text
        .replace(/[*`]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}
