// textPdf — render plain/markdown-ish text into a simple, multi-page PDF.
//
// Used by sign-merchant-document to produce the funder-ready signed-application
// artifact (the customer-documents bucket only accepts PDF/image/Word, and
// submit-to-funders attaches this to funder emails). The AUTHORITATIVE signed
// record is still the frozen merged_content + SHA-256 in the signature ledger;
// this PDF is the human/funder-facing rendition of exactly that text plus the
// signature block.
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
    .replace(/ /g, " ")
    // deno-lint-ignore no-control-regex
    .replace(/[^\x09\x0A\x20-\x7E]/g, "");
}

/** Wrap a single logical line to a max character width. */
function wrap(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > max) {
      if (cur) out.push(cur);
      // hard-break a single over-long token
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max));
        cur = "";
      } else cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
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
  const size = 10, lead = 14;
  const maxChars = 95;
  const usableTop = pageH - margin;

  let page = pdf.addPage([pageW, pageH]);
  let y = usableTop;

  const draw = (text: string, useBold = false) => {
    if (y < margin + lead) {
      page = pdf.addPage([pageW, pageH]);
      y = usableTop;
    }
    page.drawText(text, { x: margin, y, size, font: useBold ? bold : font, color: rgb(0.05, 0.06, 0.09) });
    y -= lead;
  };

  // Title.
  page.drawText(toAscii(opts.title).slice(0, maxChars), {
    x: margin, y, size: 15, font: bold, color: rgb(0.05, 0.06, 0.09),
  });
  y -= lead * 1.8;

  for (const raw of toAscii(opts.body).split("\n")) {
    const line = raw.replace(/\t/g, "    ");
    if (line.trim() === "") { y -= lead * 0.6; continue; }
    const isHeading = /^#{1,6}\s/.test(line);
    const clean = line.replace(/^#{1,6}\s/, "");
    for (const seg of wrap(clean, maxChars)) draw(seg, isHeading);
  }

  if (opts.footerLines?.length) {
    y -= lead;
    for (const f of opts.footerLines) for (const seg of wrap(toAscii(f), maxChars)) draw(seg, true);
  }

  return await pdf.save();
}
