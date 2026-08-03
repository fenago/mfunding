// _shared/uccFile.ts — the REUSABLE core of the bulk-FILE UCC ingest.
//
// This is the shared module the CA / FL (and future file-state) loaders' logic is
// factored into, so ph-ucc-file-ingest runs the SAME parse + funder-match +
// freshness/termination filter the manual loaders wrote — never a one-off script
// again. It is a faithful port of scripts/ph_ucc_ca_loader.py (DuckDB) and
// scripts/ph_ucc_fl_loader.py (csv), including their per-state PRECISION fixes.
//
// DESIGN FOR GB-SCALE (honest): a Supabase edge function has ~256MB of memory and
// a wall clock, so we NEVER buffer a 470MB CA zip / multi-GB FL file. Instead we
// STREAM each unzipped CSV from storage over HTTP Range (byte-accurately, so a run
// resumes at an exact line boundary on self-reinvoke) and use MATCHED-SET-FIRST
// staging: pass 1 stages ONLY funder-alias-matched (filing × party) rows — a tiny
// fraction — so the working set fits in memory regardless of file size.
//
// TWO MATCHING MODES (the loaders differ, on purpose):
//   • CA uses norm2 — strip ONLY corporate-FORM suffixes (LLC/INC/…) but KEEP the
//     descriptor words (FUNDING/CAPITAL/…). Plain ph_ucc_norm over-strips
//     "National Funding" → "NATIONAL", which then matches every "… NATIONAL
//     ASSOCIATION" bank. Aliases whose norm2 form has < 5 alnum chars are dropped.
//   • FL uses ph_ucc_norm (the DB matcher's own norm) + a generic-word BLOCKLIST
//     (NATIONAL, EXPRESS, PEARL, …) whose FL matches are demonstrably banks/CUs.
// Both keep banks OUT of ph_ucc_filings, because ph_ucc_rebuild_leads() only
// re-matches rows we insert — junk kept out here can never become a dialer lead.

// ── Normalization ──────────────────────────────────────────────────────────────
// ph_ucc_norm: EXACT mirror of public.ph_ucc_norm(text) — strips corporate forms
// AND descriptor words. Used by FL (matches the DB matcher) + everywhere the DB
// matcher runs. Postgres \y (word boundary) maps to JS \b for [A-Z0-9_] runs.
const NORM_STRIP =
  /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT|FUNDING|FUND|CAPITAL|FINANCIAL|FINANCE|GROUP|SERVICING)\b/g;
export function phUccNorm(s: string | null | undefined): string {
  if (s == null) return "";
  return s.toUpperCase().replace(NORM_STRIP, " ").replace(/[^A-Z0-9]+/g, " ").trim();
}
// norm2: descriptor-preserving — mirror of the CA loader's DuckDB norm2 macro.
const NORM2_STRIP = /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE)\b/g;
export function phUccNorm2(s: string | null | undefined): string {
  if (s == null) return "";
  return s.toUpperCase().replace(NORM2_STRIP, " ").replace(/[^A-Z0-9]+/g, " ").trim();
}
export type NormMode = "norm" | "norm2";
export function normalize(mode: NormMode, s: string | null | undefined): string {
  return mode === "norm2" ? phUccNorm2(s) : phUccNorm(s);
}

// ── Alias set + secured-party matching (per-state mode/floor/blocklist) ─────────
export interface MatchConfig { mode: NormMode; minAlnum: number; blocklist: string[]; }

// Build the DISTINCT normalized alias set for a state: normalize each alias in the
// state's mode, keep those with >= minAlnum alnum chars, drop blocklisted tokens.
export function buildAliasNorms(aliases: { alias: string; active?: boolean }[], cfg: MatchConfig): string[] {
  const block = new Set(cfg.blocklist);
  const set = new Set<string>();
  for (const a of aliases) {
    if (a.active === false) continue;
    const n = normalize(cfg.mode, a.alias);
    if (n.replace(/[^A-Z0-9]/g, "").length < cfg.minAlnum) continue;
    if (block.has(n)) continue;
    set.add(n);
  }
  return Array.from(set);
}

// Token-boundary phrase match — mirror of the matcher / loaders:
// (' '||spNorm||' ') LIKE ('%'||' '||aliasNorm||' '||'%').
export function securedPartyIsFunder(securedPartyRaw: string, aliasNorms: string[], mode: NormMode): boolean {
  const sp = normalize(mode, securedPartyRaw);
  if (!sp) return false;
  const padded = " " + sp + " ";
  for (const a of aliasNorms) if (padded.includes(" " + a + " ")) return true;
  return false;
}

// ── Date + text helpers ───────────────────────────────────────────────────────
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);           // ISO
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);              // US m/d/yyyy (CA/FL)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);                     // compact yyyymmdd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
export const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

// ── Delimited-line splitter (handles optional double-quote quoting) ────────────
export function splitDelimited(line: string, delim: string): string[] {
  if (line.indexOf('"') === -1) return line.split(delim);
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function headerIndex(headerLine: string, delim: string): Record<string, number> {
  const cols = splitDelimited(headerLine, delim);
  const map: Record<string, number> = {};
  cols.forEach((c, i) => { map[c.trim().toUpperCase()] = i; });
  return map;
}

// Resolve a logical field: try each candidate header name (case-insensitive), then
// a literal "#N" 0-based index fallback (headerless files).
export function pick(fields: string[], hdr: Record<string, number>, candidates: string[] | undefined): string | null {
  if (!candidates) return null;
  for (const cand of candidates) {
    if (cand.startsWith("#")) {
      const idx = Number(cand.slice(1));
      if (!Number.isNaN(idx) && idx < fields.length) return clean(fields[idx]);
    } else {
      const idx = hdr[cand.toUpperCase()];
      if (idx != null && idx < fields.length) return clean(fields[idx]);
    }
  }
  return null;
}
// Raw (non-cleaned) field value by candidate names (for equality gates like ACTION_TYPE).
export function rawVal(fields: string[], hdr: Record<string, number>, candidates: string[] | undefined): string {
  if (!candidates) return "";
  for (const cand of candidates) {
    const idx = cand.startsWith("#") ? Number(cand.slice(1)) : hdr[cand.toUpperCase()];
    if (idx != null && !Number.isNaN(idx) && idx < fields.length) return (fields[idx] ?? "").trim();
  }
  return "";
}

// ── Byte-accurate streaming line reader over a storage object (Range) ──────────
export interface LineChunk { line: string; byteEnd: number; }
export async function* streamLines(objectUrl: string, authHeader: string, startByte: number): AsyncGenerator<LineChunk> {
  const headers: Record<string, string> = { Range: `bytes=${startByte}-` };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(objectUrl, { headers });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`storage read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  if (!res.body) throw new Error("storage read: empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("latin1"); // FL files are latin-1; CA is ASCII — latin1 is a safe superset for both
  let buf = new Uint8Array(0);
  let pos = startByte;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.length) yield { line: decoder.decode(buf).replace(/\r$/, ""), byteEnd: pos + buf.length };
        return;
      }
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length);
      buf = merged;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
          yield { line: decoder.decode(buf.subarray(start, i)).replace(/\r$/, ""), byteEnd: pos + i + 1 };
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

export async function objectSize(objectUrl: string, authHeader: string): Promise<number | null> {
  try {
    const headers: Record<string, string> = { Range: "bytes=0-0" };
    if (authHeader) headers.Authorization = authHeader;
    const res = await fetch(objectUrl, { headers });
    const m = res.headers.get("content-range")?.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch { return null; }
}

// ── Per-state file profiles ────────────────────────────────────────────────────
// One profile per file-state. `passes` is the ordered pass plan (finalize is
// implicit as the last phase). Each role spec declares the file's filename hints,
// delimiter, and the column candidates for each logical field. COLUMN CANDIDATES
// are the real headers observed by the loaders (first) plus resilient fallbacks;
// this is the ONE place to update when a state's master-file format shifts.
export type PassKind = "secured" | "filings" | "debtors" | "amendments";
export interface RoleSpec {
  hints: string[];
  delimiter: string;
  columns: Record<string, string[]>;
}
export interface FilingsSpec extends RoleSpec {
  // filed_date is only taken from rows where filedGate.col == filedGate.value
  // (CA: ACTION_TYPE='Lien Financing Stmt'; FL: FilingStatus='Filed').
  filedGate?: { col: string[]; value: string };
  // FL: a filing whose status != keepValue is Lapsed/Cancelled → drop the UCC1.
  dropUnless?: { col: string[]; keepValue: string };
}
export interface DebtorsSpec extends RoleSpec {
  // person-name fallback when the org name is blank (CA LAST_NAME/FIRST_NAME).
  personCols?: { last: string[]; first: string[] };
  // best-debtor ranking (lower = better): prefer company format, original party,
  // longest name — a faithful port of the loaders' debtor pick.
  rank?: { companyCol?: string[]; companyValue?: string; origCol?: string[]; origValue?: string };
}
export interface AmendmentsSpec extends RoleSpec {
  actionCol: string[];
  terminationValues: string[];
  reversalValues: string[]; // e.g. "Erroneous Termination" un-terminates
}
export interface StateFileProfile {
  state: string;
  windowDays: number;
  match: MatchConfig;
  dropLapsed: boolean;   // CA: drop if effective lapse date is in the past
  passes: PassKind[];
  secured: RoleSpec;
  filings: FilingsSpec;
  debtors: DebtorsSpec;
  amendments?: AmendmentsSpec;
}

// CALIFORNIA — bizfile master unload: pipe-delimited, double-quoted, joined on
// UCC1_NUM. Faithful to scripts/ph_ucc_ca_loader.py.
export const CA_PROFILE: StateFileProfile = {
  state: "CA",
  windowDays: 540,
  match: { mode: "norm2", minAlnum: 5, blocklist: [] },
  dropLapsed: true,
  passes: ["secured", "filings", "debtors", "amendments"],
  secured: {
    hints: ["securedparties", "secured"],
    delimiter: "|",
    columns: { filing_no: ["UCC1_NUM"], secured_party_raw: ["ORG_NAME", "ORGANIZATION_NAME", "NAME"] },
  },
  filings: {
    // roleForPath checks "amendments" (hint "filingamendments") BEFORE "filings",
    // so FilingAmendments.csv never falls through to here.
    hints: ["filings", "filing"],
    delimiter: "|",
    columns: {
      filing_no: ["UCC1_NUM"],
      filed_date: ["FILING_DATE"],
      lapse_date: ["LAPSE_DATE"],
      status: ["FILING_TYPE_ID"],
    },
    filedGate: { col: ["ACTION_TYPE"], value: "Lien Financing Stmt" },
  },
  debtors: {
    hints: ["debtors", "debtor"],
    delimiter: "|",
    columns: {
      filing_no: ["UCC1_NUM"],
      debtor_name: ["ORG_NAME", "ORGANIZATION_NAME"],
      debtor_address: ["ADDR1", "ADDRESS1", "ADDR"],
      debtor_city: ["CITY"],
      debtor_state: ["STATE"],
      debtor_zip: ["POSTAL_CODE", "ZIP", "ZIPCODE"],
    },
    personCols: { last: ["LAST_NAME"], first: ["FIRST_NAME"] },
    rank: {}, // CA: prefer a non-null org name, then longest (handled in code)
  },
  amendments: {
    hints: ["filingamendments"],
    delimiter: "|",
    columns: { filing_no: ["UCC1_NUM"] },
    actionCol: ["ACTION_TYPE"],
    terminationValues: ["Termination"],
    reversalValues: ["Erroneous Termination"],
  },
};

// FLORIDA — floridaucc.com full download: pipe-delimited, latin-1, joined on
// Ucc1FilingNumber. Faithful to scripts/ph_ucc_fl_loader.py (incl. the blocklist).
export const FL_PROFILE: StateFileProfile = {
  state: "FL",
  windowDays: 540,
  match: {
    mode: "norm",
    minAlnum: 3,
    blocklist: [
      "NATIONAL", "EXPRESS", "VALUE", "VELOCITY", "ROK", "RETAIL", "NETWORK",
      "STRATEGIC", "GRP", "RELIANCE", "INTREPID", "MULLIGAN", "CIRCLE",
      "FINANCING SOLUTIONS", "TANGO", "DIESEL", "FOX", "HEADWAY", "DAVID ALLEN",
      "PEARL",
    ],
  },
  dropLapsed: false, // FL freshness is via FilingStatus='Filed' (see dropUnless)
  passes: ["secured", "filings", "debtors"],
  secured: {
    hints: ["secureds", "secured"],
    delimiter: "|",
    columns: { filing_no: ["UCC1FILINGNUMBER"], secured_party_raw: ["SECNAME", "SEC_NAME"] },
  },
  filings: {
    hints: ["filings", "filing"],
    delimiter: "|",
    columns: {
      filing_no: ["UCC1FILINGNUMBER"],
      filed_date: ["FILINGDATE"],
      lapse_date: ["FILINGEXPDATE"],
      status: ["FILINGSTATUS"],
    },
    dropUnless: { col: ["FILINGSTATUS"], keepValue: "Filed" },
  },
  debtors: {
    hints: ["debtors", "debtor"],
    delimiter: "|",
    columns: {
      filing_no: ["UCC1FILINGNUMBER"],
      debtor_name: ["DEBNAME"],
      debtor_address: ["DEBADDRESSLINE1"],
      debtor_address2: ["DEBADDRESSLINE2"],
      debtor_city: ["DEBCITY"],
      debtor_state: ["DEBSTATE"],
      debtor_zip: ["DEBZIPCODE"],
    },
    rank: { companyCol: ["DEBNAMEFORMAT"], companyValue: "C", origCol: ["DEBORIGPARTY"], origValue: "O" },
  },
};

export const PROFILES: Record<string, StateFileProfile> = { CA: CA_PROFILE, FL: FL_PROFILE };

// Match an uploaded object path to a pass by filename hint. Order matters:
// "filingamendments" must beat "filing"; "secureds" before "filing"; check the
// most specific kinds first.
export function roleForPath(path: string, profile: StateFileProfile): PassKind | null {
  const base = (path.toLowerCase().split("/").pop() ?? path.toLowerCase());
  const order: PassKind[] = ["amendments", "secured", "debtors", "filings"];
  for (const kind of order) {
    const spec = kind === "amendments" ? profile.amendments : profile[kind];
    if (spec && spec.hints.some((h) => base.includes(h))) return kind;
  }
  return null;
}

// Compute a debtor rank (lower = better) faithful to the loaders' pick:
// company/original format first, then longest name. `isOrgName` is used as the
// company bit when the profile has no explicit format column (CA: prefer a row
// that has an ORG_NAME over a person-name fallback).
export function debtorRank(
  spec: DebtorsSpec, fields: string[], hdr: Record<string, number>, nameLen: number, isOrgName: boolean,
): number {
  let r = 0;
  if (spec.rank?.companyCol) {
    const fmt = rawVal(fields, hdr, spec.rank.companyCol);
    r += (fmt === spec.rank.companyValue ? 0 : 1) * 1_000_000;
  } else {
    r += (isOrgName ? 0 : 1) * 1_000_000;
  }
  if (spec.rank?.origCol) {
    const orig = rawVal(fields, hdr, spec.rank.origCol);
    r += (orig === spec.rank.origValue ? 0 : 1) * 100_000;
  }
  r += Math.max(0, 99_999 - Math.min(nameLen, 99_999)); // longer name → lower rank
  return r;
}
