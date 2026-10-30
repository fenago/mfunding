// ─────────────────────────────────────────────────────────────────────────────
// Build the customer-facing one-pagers: HTML → PDF, one Letter page each.
//
//   node scripts/one-pagers/build.mjs
//
// No new dependency: it drives the Chrome already on the machine with
// --headless --print-to-pdf, so the PDF is real vector output with selectable
// text, not a screenshot.
//
// Output:
//   public/programs/<slug>.html + .pdf   — the five public sheets
//   docs/one-pagers/restricted/<slug>.*  — anything flagged `restricted`
//
// A restricted sheet is deliberately NOT written into public/. Debt relief is
// a prohibited content category for A2P 10DLC, our public pages for it were
// pulled for that reason, and a file sitting in public/ is published whether
// or not anything links to it. It is built so it can be handed to a merchant
// who already came to us, which is a different thing from marketing it.
//
// The script FAILS if a sheet renders to more than one page. A one-pager that
// quietly became a two-pager is the whole job undone.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHEETS } from "./content.mjs";
import { render, renderIndex } from "./template.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = resolve(ROOT, "public/programs");
const RESTRICTED_DIR = resolve(ROOT, "docs/one-pagers/restricted");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("No Chrome or Chromium found. Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(1);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
mkdirSync(RESTRICTED_DIR, { recursive: true });

/** Page count straight out of the PDF, so "it fits" is measured, not assumed. */
function pageCount(path) {
  const buf = readFileSync(path);
  const text = buf.toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Page[^s]/g)].length;
  return counts || 1;
}

let failures = 0;

for (const sheet of SHEETS) {
  const dir = sheet.restricted ? RESTRICTED_DIR : PUBLIC_DIR;
  const htmlPath = resolve(dir, `${sheet.slug}.html`);
  const pdfPath = resolve(dir, `${sheet.slug}.pdf`);

  writeFileSync(htmlPath, render(sheet), "utf8");

  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      "--virtual-time-budget=6000",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const pages = pageCount(pdfPath);
  const tag = sheet.restricted ? "RESTRICTED" : "public";
  if (pages !== 1) {
    failures++;
    console.error(`  ✗ ${sheet.slug} — ${pages} pages. It must be ONE. (${tag})`);
  } else {
    console.log(`  ✓ ${sheet.slug} — 1 page (${tag})`);
  }
}

// The index lists ONLY what is published. A restricted sheet is absent from
// it for the same reason it is absent from public/.
const listed = SHEETS.filter((s) => !s.restricted);
writeFileSync(resolve(PUBLIC_DIR, "index.html"), renderIndex(listed), "utf8");
console.log(`  \u2713 index.html \u2014 ${listed.length} sheets listed, ${SHEETS.length - listed.length} withheld`);

if (failures) {
  console.error(`\n${failures} sheet(s) overflowed a page. Trim the copy or the type scale.`);
  process.exit(1);
}
console.log(`\n${SHEETS.length} sheets built.`);
