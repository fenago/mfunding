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

/**
 * Canonicalize the phone line type.
 *
 * The real files ship case variants of the SAME value — "VoIP" (9,152 rows) and
 * "Voip" (2,282), "Toll-Free" (1,139) and "Toll-free" (9). Those are one value
 * spelled two ways, so a user filtering line_type='VoIP' silently missed 2,282
 * rows. Known values are folded to one spelling.
 *
 * UNLIKE state, an unrecognized value is KEPT rather than nulled. A bad state
 * ("TEXAS") collides with a real one ("TX") and produces a wrong answer to a
 * state filter; an unknown line type ("Satellite") collides with nothing, so
 * keeping it is informative and safe.
 */
const LINE_TYPES: Record<string, string> = {
  "MOBILE": "Mobile", "CELL": "Mobile", "CELLULAR": "Mobile", "WIRELESS": "Mobile",
  "LANDLINE": "Landline", "LAND LINE": "Landline", "FIXED": "Landline",
  "VOIP": "VoIP", "VOICE OVER IP": "VoIP",
  "TOLL FREE": "Toll-Free", "TOLLFREE": "Toll-Free",
};
export function normalizeLineType(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = trimmed.toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
  return LINE_TYPES[key] ?? trimmed;
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

/** USPS 2-letter codes: 50 states + DC + the territories that appear in lead files. */
const USPS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV",
  "WI","WY","DC","PR","VI","GU","AS","MP",
]);

const STATE_NAMES: Record<string, string> = {
  "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA",
  "COLORADO":"CO","CONNECTICUT":"CT","DELAWARE":"DE","FLORIDA":"FL","GEORGIA":"GA",
  "HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL","INDIANA":"IN","IOWA":"IA","KANSAS":"KS",
  "KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD","MASSACHUSETTS":"MA",
  "MICHIGAN":"MI","MINNESOTA":"MN","MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT",
  "NEBRASKA":"NE","NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM",
  "NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK",
  "OREGON":"OR","PENNSYLVANIA":"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC",
  "SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT",
  "VIRGINIA":"VA","WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY",
  "DISTRICT OF COLUMBIA":"DC","WASHINGTON DC":"DC","WASHINGTON D C":"DC",
  "PUERTO RICO":"PR","US VIRGIN ISLANDS":"VI","VIRGIN ISLANDS":"VI","GUAM":"GU",
  "AMERICAN SAMOA":"AS","NORTHERN MARIANA ISLANDS":"MP",
};

/**
 * Normalize to a USPS 2-letter code, or NULL.
 *
 * Purchased files are dirty in this column: full names ("TEXAS"), trailing commas
 * ("TX,"), the literal string "NULL", city names, bare numbers, and non-US values
 * ("CANADA"). Storing those verbatim is worse than storing nothing, because a user
 * filtering state=TX then silently MISSES the rows spelled "TEXAS" — a wrong answer
 * that looks like a right one.
 *
 * So: recognized name or code → the code; anything else → NULL. Nothing is lost by
 * nulling, because lead_records.raw keeps the original row verbatim.
 */
export function upperState(raw: string | null): string | null {
  if (!raw) return null;
  // strip punctuation/whitespace noise, collapse inner runs ("N. CAROLINA" etc.)
  const s = raw.toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s === "NULL" || s === "NA" || s === "N A") return null;
  if (s.length === 2) return USPS.has(s) ? s : null;
  return STATE_NAMES[s] ?? null;
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

// ── Additional phones / emails ────────────────────────────────────────────────
//
// Vendor files ship Phone 1 / Phone 2 / Cell, and the setter's first question
// captures a cell + email that are almost always different from the list data.
// Keeping only the first number throws away data the owner paid for.
//
// The PRIMARY is unchanged: the first phone-bearing column that yields a valid
// NANP number is still the primary, exactly as before, so the batch dedupe key
// and every existing row behave identically. Everything after it is an extra.
//
// Extra columns are found by HEADER, so a file with a single phone column
// produces zero extras and is byte-for-byte the same ingest it was before.
const EXTRA_PHONE_HEADERS = [
  "PHONE 2", "PHONE2", "PHONE NUMBER 2", "SECONDARY PHONE", "ALT PHONE",
  "ALTERNATE PHONE", "OTHER PHONE", "PHONE 3", "PHONE3",
  "CELL", "CELL PHONE", "MOBILE", "MOBILE PHONE", "HOME PHONE", "WORK PHONE",
  "BUSINESS PHONE", "DIRECT PHONE", "CONTACT PHONE",
];
const EXTRA_EMAIL_HEADERS = [
  "EMAIL 2", "EMAIL2", "SECONDARY EMAIL", "ALT EMAIL", "ALTERNATE EMAIL",
  "OTHER EMAIL", "EMAIL 3", "EMAIL3", "PERSONAL EMAIL", "WORK EMAIL",
  "BUSINESS EMAIL", "CONTACT EMAIL",
];

export interface ExtraPhone { phone: string; line_type?: string; label?: string }

/** Column indexes for every extra phone/email header present in this file.
 * Resolved ONCE per file, not per row. Excludes whatever the primary uses. */
export function resolveExtraColumns(
  hdr: Record<string, number>, cols: Record<string, number>,
): { phones: { idx: number; label: string }[]; emails: { idx: number; label: string }[] } {
  const used = new Set<number>([cols.phone, cols.email].filter((i) => i != null) as number[]);
  const phones: { idx: number; label: string }[] = [];
  const emails: { idx: number; label: string }[] = [];
  for (const h of EXTRA_PHONE_HEADERS) {
    const idx = hdr[h];
    if (idx != null && !used.has(idx)) { used.add(idx); phones.push({ idx, label: h }); }
  }
  for (const h of EXTRA_EMAIL_HEADERS) {
    const idx = hdr[h];
    if (idx != null && !used.has(idx)) { used.add(idx); emails.push({ idx, label: h }); }
  }
  return { phones, emails };
}

/** Extra phones for one row: normalized, de-duped against the primary and each
 * other, order preserved. Returns [] when the file has no extra phone columns. */
export function extraPhonesFor(
  fields: string[], extras: { idx: number; label: string }[],
  primary: string | null, lineTypeCol?: number,
): ExtraPhone[] {
  if (!extras.length) return [];
  const seen = new Set<string>(primary ? [primary] : []);
  const out: ExtraPhone[] = [];
  for (const { idx, label } of extras) {
    const raw = idx < fields.length ? fields[idx] : null;
    const p = normalizePhone(raw ?? null);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const row: ExtraPhone = { phone: p, label };
    // A column literally named CELL/MOBILE tells us the line type for free.
    const fromHeader = label.includes("CELL") || label.includes("MOBILE") ? "Mobile" : null;
    const lt = fromHeader
      ?? (lineTypeCol != null && lineTypeCol < fields.length ? normalizeLineType(fields[lineTypeCol]) : null);
    if (lt) row.line_type = lt;
    out.push(row);
  }
  return out;
}

/** Extra emails for one row: validated, lowercased, de-duped against the primary. */
export function extraEmailsFor(
  fields: string[], extras: { idx: number; label: string }[], primary: string | null,
): string[] {
  if (!extras.length) return [];
  const seen = new Set<string>(primary ? [primary] : []);
  const out: string[] = [];
  for (const { idx } of extras) {
    const e = validEmail(idx < fields.length ? fields[idx] : null);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * Split a combined name into { first, last }.
 *
 * The vendor CSVs cram the whole name into FIRST NAME and leave LAST NAME empty
 * — verified in the raw UCC file (row 2487705771: "COREY JENKINS" in FIRST NAME,
 * nothing in LAST NAME). Ingest copied that faithfully, so 4,413 merchants had
 * no surname and a setter's screen greeted "COREY JENKINS" as a first name.
 *
 * Two shapes appear in the same files and they need OPPOSITE handling:
 *   "COREY JENKINS"              → first COREY, last JENKINS
 *   "MARTIN, DONALD RICHARD III" → first DONALD, last MARTIN   (comma inverts!)
 * A comma is the reliable signal that the surname comes FIRST. Getting that
 * backwards is worse than not splitting at all: it addresses the merchant by
 * their surname on a cold call.
 *
 * A job title is not a name, so a trailing ", PRESIDENT" / ", OWNER" / ", MGR"
 * is dropped. Generational suffixes (JR/SR/II/III) are KEPT — those belong to
 * the person. Single-token names are returned untouched: there is nothing to
 * split and inventing a surname would be worse than leaving the field empty.
 */
const NAME_TITLE_RE =
  /,\s*(PRESIDENT|OWNER|MGR|MANAGER|CEO|CFO|COO|MEMBER|PARTNER|DIRECTOR|VP|PRES|PRINCIPAL|ADMIN|OFFICER)\s*\.?\s*$/i;

export function splitCombinedName(
  first: string | null,
  last: string | null,
): { first: string | null; last: string | null } {
  // Only ever act when the surname slot is EMPTY. A file that ships both fields
  // populated is already correct and must not be second-guessed.
  if (last && last.trim()) return { first, last };
  const raw = (first ?? "").replace(NAME_TITLE_RE, "").replace(/\s+/g, " ").trim();
  if (!raw) return { first, last };

  if (raw.includes(",")) {
    const surname = raw.split(",")[0].trim();
    const given = (raw.split(",")[1] ?? "").trim().split(" ")[0] ?? "";
    if (surname && given) return { first: given, last: surname };
    return { first: raw.replace(/,/g, "").trim() || first, last: null };
  }

  const i = raw.indexOf(" ");
  if (i < 0) return { first: raw, last: null };   // single token — nothing to split
  return { first: raw.slice(0, i), last: raw.slice(i + 1).trim() || null };
}
