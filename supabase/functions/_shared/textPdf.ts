// textPdf — render markdown-ish text into a simple, multi-page PDF.
//
// Used by sign-merchant-document to produce the funder-ready signed-application
// artifact (the customer-documents bucket only accepts PDF/image/Word, and
// submit-to-funders attaches this to funder emails). The AUTHORITATIVE signed
// record is still the frozen merged_content + SHA-256 in the signature ledger;
// this PDF is the human/funder-facing rendition of exactly that text plus the
// signature block.
//
// Renders basic markdown structure so the signed artifact reads as a real
// document, not raw markup: # / ## / ### headings (sized + bold), **bold**
// inline, "-"/"*" bullet lists, "---" rules, "> " blockquotes (marker stripped),
// and paragraph spacing. Wrapping is width-measured (not fixed-char) so bold and
// larger heading glyphs pack correctly. Dependency-light — the only import is the
// pdf-lib already used here.
//
// Font is StandardFonts.Helvetica (WinAnsi). To guarantee drawText never throws
// on an unencodable glyph, we sanitize the text to ASCII first — common Unicode
// punctuation is mapped to ASCII, anything else above 0x7E is dropped.

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

function toAscii(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●·]/g, "*")
    .replace(/§/g, "Sec.")
    .replace(/[→⇒]/g, "->")
    .replace(/×/g, "x")
    .replace(/ /g, " ")
    // deno-lint-ignore no-control-regex
    .replace(/[^\x09\x0A\x20-\x7E]/g, "");
}

interface Run { text: string; bold: boolean }

/** Split a line into bold/normal runs on `**` toggles. */
function parseInline(s: string): Run[] {
  const parts = s.split("**");
  const runs: Run[] = [];
  let bold = false;
  for (const p of parts) {
    if (p) runs.push({ text: p, bold });
    bold = !bold;
  }
  return runs.length ? runs : [{ text: "", bold: false }];
}

export async function renderTextPdf(opts: {
  title: string;
  body: string;
  footerLines?: string[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612, pageH = 792;       // US Letter
  const margin = 54;                    // 0.75"
  const contentW = pageW - margin * 2;
  const usableTop = pageH - margin;
  const color = rgb(0.05, 0.06, 0.09);
  const ruleColor = rgb(0.75, 0.77, 0.8);

  let page = pdf.addPage([pageW, pageH]);
  let y = usableTop;

  const ensureSpace = (lead: number) => {
    if (y < margin + lead) {
      page = pdf.addPage([pageW, pageH]);
      y = usableTop;
    }
  };

  // Width-measured word wrap over a run list, at a given font size. Returns lines,
  // each a run list with single-space separators embedded so draw can measure them.
  const wrapRuns = (runs: Run[], size: number, maxWidth: number): Run[][] => {
    const spaceW = font.widthOfTextAtSize(" ", size);
    type W = { text: string; bold: boolean; w: number };
    const words: W[] = [];
    for (const run of runs) {
      const f = run.bold ? bold : font;
      for (const word of run.text.split(/\s+/)) {
        if (word === "") continue;
        const w = f.widthOfTextAtSize(word, size);
        if (w <= maxWidth) {
          words.push({ text: word, bold: run.bold, w });
          continue;
        }
        // Hard-break a single over-long token to fit.
        let chunk = "";
        for (const ch of word) {
          if (f.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
            words.push({ text: chunk, bold: run.bold, w: f.widthOfTextAtSize(chunk, size) });
            chunk = ch;
          } else chunk += ch;
        }
        if (chunk) words.push({ text: chunk, bold: run.bold, w: f.widthOfTextAtSize(chunk, size) });
      }
    }
    const lines: Run[][] = [];
    let cur: Run[] = [];
    let curW = 0;
    for (const wd of words) {
      const add = (cur.length ? spaceW : 0) + wd.w;
      if (cur.length && curW + add > maxWidth) {
        lines.push(cur);
        cur = [];
        curW = 0;
      }
      if (cur.length) { cur.push({ text: " ", bold: false }); curW += spaceW; }
      cur.push({ text: wd.text, bold: wd.bold });
      curW += wd.w;
    }
    if (cur.length) lines.push(cur);
    return lines.length ? lines : [[{ text: "", bold: false }]];
  };

  const drawRuns = (runs: Run[], size: number, lead: number, indent = 0) => {
    ensureSpace(lead);
    let x = margin + indent;
    for (const r of runs) {
      const f = r.bold ? bold : font;
      page.drawText(r.text, { x, y, size, font: f, color });
      x += f.widthOfTextAtSize(r.text, size);
    }
    y -= lead;
  };

  const drawBlock = (text: string, size: number, lead: number, indent = 0) => {
    for (const ln of wrapRuns(parseInline(text), size, contentW - indent)) {
      drawRuns(ln, size, lead, indent);
    }
  };

  // Title. Skip the standalone title when the body already opens with a matching
  // "# " H1 (every merchant template does) — otherwise it prints twice.
  const bodyLines = toAscii(opts.body).split("\n");
  const firstNonEmpty = (bodyLines.find((l) => l.trim() !== "") ?? "").trim();
  const openingH1 = /^#\s+(.*)$/.exec(firstNonEmpty);
  const titleText = toAscii(opts.title).trim();
  if (!(openingH1 && openingH1[1].trim() === titleText)) {
    for (const ln of wrapRuns([{ text: titleText, bold: true }], 16, contentW)) {
      drawRuns(ln, 16, 22);
    }
    y -= 6;
  }

  for (const raw of bodyLines) {
    let line = raw.replace(/\t/g, "    ");
    const trimmed = line.trim();

    if (trimmed === "") { y -= 8; continue; }

    // Horizontal rule.
    if (/^-{3,}$/.test(trimmed) || /^(\*\s*){3,}$/.test(trimmed)) {
      ensureSpace(16);
      y -= 4;
      page.drawLine({
        start: { x: margin, y: y + 4 },
        end: { x: pageW - margin, y: y + 4 },
        thickness: 0.6,
        color: ruleColor,
      });
      y -= 12;
      continue;
    }

    // Blockquote: strip the leading "> " marker, render as a normal paragraph.
    line = line.replace(/^\s*>\s?/, "");

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const size = level <= 1 ? 15 : level === 2 ? 13 : 11;
      const lead = level <= 1 ? 21 : level === 2 ? 18 : 16;
      y -= 5;
      drawBlock(h[2], size, lead);
      continue;
    }

    // Bullet list item.
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      const lines = wrapRuns(parseInline(li[1]), 10, contentW - 16);
      lines.forEach((ln, i) => {
        ensureSpace(14);
        if (i === 0) page.drawText("-", { x: margin + 2, y, size: 10, font, color });
        let x = margin + 16;
        for (const r of ln) {
          const f = r.bold ? bold : font;
          page.drawText(r.text, { x, y, size: 10, font: f, color });
          x += f.widthOfTextAtSize(r.text, 10);
        }
        y -= 14;
      });
      continue;
    }

    // Normal paragraph.
    drawBlock(line, 10, 14);
  }

  if (opts.footerLines?.length) {
    y -= 10;
    for (const f of opts.footerLines) {
      drawBlock(toAscii(f), 10, 14);
    }
  }

  return await pdf.save();
}
