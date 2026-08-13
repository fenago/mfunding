// leadCsv — the parsing half of the LEAD MACHINE.
//
// Purchased lead files (UCC / AGED / TRIGGER, ~85k rows each) are streamed out of
// the lead-uploads bucket byte-accurately so an 85k-row file never gets buffered
// into an edge function's 256MB. Same proven shape as _shared/uccFile.ts, with two
// deliberate differences:
//   • UTF-8 decoding (purchased consumer lists carry accented names; the state UCC
//     master files are latin-1, which is why uccFile.ts decodes latin1).
//   • QUOTE-AWARE RECORD ASSEMBLY — a CSV field may legally contain a newline
//     inside quotes (company names in the trigger file are quoted). A naive
//     line-splitter would shred those rows, so lines are joined until the quotes
//     balance.
//
// COLUMN MAPPING is by HEADER NAME, not position, and is a single UNIFIED map
// across all three types: vendors reorder and rename columns between drops, and a
// header-driven map absorbs that. lead_type only decides which row shape we expect
// to find, never which column index to read.

import { splitDelimited } from "./uccFile.ts";

export type LeadType = "ucc" | "aged" | "trigger";
export const LEAD_TYPES: LeadType[] = ["ucc", "aged", "trigger"];

// ── Header normalization ──────────────────────────────────────────────────────
// Uppercase, strip the BOM, fold underscores/whitespace to a single space, drop
// punctuation. "NUMBER_OF_EMPLOYEES", "Number of Employees" and "number  of
// employees" all become "NUMBER OF EMPLOYEES".
export function normHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .replace(/["']/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function headerIndexNorm(headerLine: string, delim = ","): Record<string, number> {
  const cols = splitDelimited(headerLine.replace(/^﻿/, ""), delim);
  const map: Record<string, number> = {};
  cols.forEach((c, i) => {
    const k = normHeader(c);
    if (k && !(k in map)) map[k] = i;
  });
  return map;
}

/** The original header strings, in file order — used to build `raw`. */
export function headerNames(headerLine: string, delim = ","): string[] {
  return splitDelimited(headerLine.replace(/^﻿/, ""), delim).map((c) => c.trim());
}

// ── Unified logical-field → candidate-header map ──────────────────────────────
// Order matters: the first candidate present in the file wins.
export const COLUMNS: Record<string, string[]> = {
  phone: ["PHONE NUMBER", "PHONE", "PHONE 1", "MOBILE", "CELL"],
  line_type: ["NUMBERTYPE", "NUMBER TYPE", "LINE TYPE", "PHONE TYPE"],
  first_name: ["FIRST NAME", "FIRSTNAME", "FIRST"],
  last_name: ["LAST NAME", "LASTNAME", "LAST"],
  email: ["EMAIL", "EMAIL ADDRESS", "E MAIL"],
  company: ["COMPANY NAME", "COMPANY", "BUSINESS NAME", "DBA"],
  title: ["TITLE", "JOB TITLE"],
  address: ["ADDRESS", "ADDRESS 1", "STREET", "STREET ADDRESS"],
  city: ["CITY"],
  state: ["STATE", "ST"],
  zip: ["ZIP", "ZIPCODE", "ZIP CODE", "POSTAL CODE"],
  employees: ["NUMBER OF EMPLOYEES", "EMPLOYEES", "EMPLOYEE COUNT"],
  // trigger files ship MONTHLY REVENUE; UCC files ship REVENUE. Both land in
  // lead_records.revenue — the column comment records that it is monthly.
  revenue: ["MONTHLY REVENUE", "REVENUE", "ANNUAL REVENUE", "SALES"],
  sic_code: ["SIC CODE", "SIC"],
  sic_description: ["SIC DESCRIPTION", "SIC DESC", "INDUSTRY"],
  filing_day: ["FILING DAY"],
  filing_month: ["FILING MONTH"],
  filing_year: ["FILING YEAR"],
  filing_date: ["FILING DATE", "FILED DATE"],
  secured_party: ["SEC PARTYNAME", "SEC PARTY NAME", "SECURED PARTY", "SECURED PARTY NAME"],
};

/** Which logical fields a type is REQUIRED to resolve for the file to be usable. */
export const REQUIRED_BY_TYPE: Record<LeadType, string[]> = {
  aged: ["phone"],
  trigger: ["phone"],
  ucc: ["phone"],
};

export function resolveColumns(hdr: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, cands] of Object.entries(COLUMNS)) {
    for (const c of cands) {
      const idx = hdr[c];
      if (idx != null) { out[field] = idx; break; }
    }
  }
  return out;
}

// ── Value helpers ─────────────────────────────────────────────────────────────
export function cell(fields: string[], cols: Record<string, number>, field: string): string | null {
  const i = cols[field];
  if (i == null || i >= fields.length) return null;
  const v = (fields[i] ?? "").trim().replace(/^"+|"+$/g, "").trim();
  return v.length ? v : null;
}

/**
 * Normalize to the NANP last-10. Returns null when the row has no dialable
 * number — the caller keeps the row anyway (status 'skipped'), because purchased
 * data is paid for and an unusable phone is not a reason to lose the record.
 */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  if (d.length !== 10) return null;
  // NANP: area code and exchange may not start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return d;
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;
export function validEmail(raw: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function toInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function toNum(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** UCC files ship the filing date split across FILING_DAY / MONTH / YEAR. */
export function filingDate(
  day: string | null, month: string | null, year: string | null, whole: string | null,
): string | null {
  const d = toInt(day), m = toInt(month), y = toInt(year);
  if (y && m && d && y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (whole) {
    const t = Date.parse(whole);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

export function upperState(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : s.slice(0, 32) || null;
}

// ── Byte-accurate, quote-aware, UTF-8 record streamer ─────────────────────────
export interface CsvRecord {
  /** the assembled logical record (quoted newlines already joined) */
  line: string;
  /** absolute byte offset just PAST this record — the exact resume point */
  byteEnd: number;
}

/** Count of quote chars in a string (used to detect an unterminated quoted field). */
function quoteCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 34) n++;
  return n;
}

const MAX_JOIN_LINES = 50; // guard: a stray quote must not swallow the file

export async function* streamCsvRecords(
  objectUrl: string,
  startByte: number,
): AsyncGenerator<CsvRecord> {
  const res = await fetch(objectUrl, { headers: { Range: `bytes=${startByte}-` } });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`storage read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  if (!res.body) throw new Error("storage read: empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buf = new Uint8Array(0);
  let pos = startByte;
  // pending logical record (an unterminated quoted field spans physical lines)
  let pending = "";
  let pendingOpen = false;
  let joined = 0;

  const emit = function* (line: string, byteEnd: number): Generator<CsvRecord> {
    const clean = line.replace(/\r$/, "");
    if (pendingOpen) {
      pending += "\n" + clean;
      joined++;
      if (quoteCount(pending) % 2 === 0 || joined >= MAX_JOIN_LINES) {
        const out = pending;
        pending = ""; pendingOpen = false; joined = 0;
        yield { line: out, byteEnd };
      }
      return;
    }
    if (quoteCount(clean) % 2 === 1) {
      pending = clean; pendingOpen = true; joined = 0;
      return;
    }
    yield { line: clean, byteEnd };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.length) yield* emit(decoder.decode(buf), pos + buf.length);
        if (pendingOpen && pending) yield { line: pending, byteEnd: pos + buf.length };
        return;
      }
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length);
      buf = merged;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
          yield* emit(decoder.decode(buf.subarray(start, i)), pos + i + 1);
          start = i + 1;
        }
      }
      buf = buf.subarray(start);
      pos += start;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

export { splitDelimited };
