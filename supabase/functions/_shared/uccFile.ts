// _shared/uccFile.ts — the REUSABLE core of the bulk-FILE UCC ingest.
//
// This is the shared module the CA / FL (and future file-state) loaders' logic is
// factored into, so ph-ucc-file-ingest and any auto-fetch cron run the SAME parse
// + funder-match + freshness/termination filter — never a one-off script again.
//
// DESIGN FOR GB-SCALE (honest): a Supabase edge function has ~256MB of memory and
// a wall-clock limit, so we NEVER buffer a 470MB CA zip or a multi-GB CSV. Instead:
//   1. Files are uploaded UNZIPPED to the ph-ucc-uploads bucket (CA: SecuredParties
//      / Filings / Debtors; FL: secureds / filings / debtors / events).
//   2. We STREAM each file from storage over HTTP Range requests, byte-accurately,
//      so a run resumes at an exact line boundary on self-reinvoke.
//   3. MATCHED-SET-FIRST (mirrors CO's targeted pull): pass 1 streams the secured-
//      party file and stages ONLY rows whose normalized party token-matches an
//      active funder alias — a tiny fraction of the file, so the working set fits
//      in memory no matter how big the input. Passes 2/3 enrich those staged rows
//      by join key. Finalize emits them into ph_ucc_filings with the freshness +
//      termination filter, then clears staging.
//
// The funder-alias match + normalization here MIRROR the SQL (ph_ucc_norm +
// ph_ucc_rebuild_leads token-boundary match). KEEP IN SYNC with
// 20260802_ph_ucc_machine.sql / _02_matcher_perf / _03_matcher_boundary.

// ── Normalization — EXACT mirror of public.ph_ucc_norm(text) ──────────────────
// SQL: upper → strip suffix/noise words on word boundaries → non-alnum to spaces
// → trim. Postgres \y (word boundary) maps to JS \b for [A-Z0-9_] runs.
const NOISE_WORDS =
  /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT|FUNDING|FUND|CAPITAL|FINANCIAL|FINANCE|GROUP|SERVICING)\b/g;
export function phUccNorm(s: string | null | undefined): string {
  if (s == null) return "";
  let u = String(s).toUpperCase();
  u = u.replace(NOISE_WORDS, " ");
  u = u.replace(/[^A-Z0-9]+/g, " ").trim();
  return u;
}

// ── Token-boundary alias match — mirror of the matcher's join predicate ────────
// SQL: length(alias_norm) >= 3 AND (' '||sp_norm||' ') LIKE ('%'||' '||alias_norm||' '||'%')
// (the trgm LIKE is just an index prefilter; the boundary test is the truth).
export function aliasMatches(spNorm: string, aliasNorm: string): boolean {
  if (aliasNorm.length < 3) return false;
  return (" " + spNorm + " ").includes(" " + aliasNorm + " ");
}

// Precompute active alias norms once per run. Returns the DISTINCT normalized
// aliases with length >= 3 (the matcher's own floor).
export function buildAliasNorms(aliases: { alias: string; active?: boolean }[]): string[] {
  const set = new Set<string>();
  for (const a of aliases) {
    if (a.active === false) continue;
    const n = phUccNorm(a.alias);
    if (n.length >= 3) set.add(n);
  }
  return Array.from(set);
}

// Does this secured-party name match ANY active funder alias? (matched-set filter)
export function securedPartyIsFunder(securedPartyRaw: string, aliasNorms: string[]): boolean {
  const sp = phUccNorm(securedPartyRaw);
  if (sp.length < 3) return false;
  const padded = " " + sp + " ";
  for (const a of aliasNorms) if (padded.includes(" " + a + " ")) return true;
  return false;
}

// ── Date + text helpers ───────────────────────────────────────────────────────
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO / yyyy-mm-dd
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // US m/d/yyyy
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/); // compact yyyymmdd (common in bulk files)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
export const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

// ── Delimited-line splitter (handles optional double-quote quoting) ────────────
export function splitDelimited(line: string, delim: string): string[] {
  // Fast path: no quotes at all → plain split.
  if (line.indexOf('"') === -1) return line.split(delim);
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Build a case-insensitive header→index map from a header line.
export function headerIndex(headerLine: string, delim: string): Record<string, number> {
  const cols = splitDelimited(headerLine, delim);
  const map: Record<string, number> = {};
  cols.forEach((c, i) => { map[c.trim().toUpperCase()] = i; });
  return map;
}

// Resolve a logical field: try each candidate header name (case-insensitive), then
// a literal "#N" 0-based index fallback (for headerless files).
export function pick(
  fields: string[], hdr: Record<string, number>, candidates: string[],
): string | null {
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

// ── Byte-accurate streaming line reader over a storage object (Range) ──────────
// Yields complete lines plus the ABSOLUTE byte offset just past each line's
// newline, so the caller can persist an exact resume point. `startByte` MUST be a
// line boundary (0, or a previously-yielded byteEnd). Cancels the network read
// when the caller stops iterating (break/return).
export interface LineChunk { line: string; byteEnd: number; }
export async function* streamLines(
  objectUrl: string, authHeader: string, startByte: number,
): AsyncGenerator<LineChunk> {
  const headers: Record<string, string> = { Range: `bytes=${startByte}-` };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(objectUrl, { headers });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`storage read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  if (!res.body) throw new Error("storage read: empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = new Uint8Array(0);
  let pos = startByte; // absolute byte offset of buf[0]
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
        if (buf[i] === 0x0a) { // '\n'
          const lineBytes = buf.subarray(start, i);
          yield { line: decoder.decode(lineBytes).replace(/\r$/, ""), byteEnd: pos + i + 1 };
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

// Probe the object's total size (for a progress %) via a 1-byte ranged GET, which
// works on signed URLs (HEAD often isn't authorized on them). Best-effort → null.
export async function objectSize(objectUrl: string, authHeader: string): Promise<number | null> {
  try {
    const headers: Record<string, string> = { Range: "bytes=0-0" };
    if (authHeader) headers.Authorization = authHeader;
    const res = await fetch(objectUrl, { headers });
    const cr = res.headers.get("content-range"); // "bytes 0-0/12345"
    const m = cr?.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch { return null; }
}

// ── Per-state file profiles ────────────────────────────────────────────────────
// A profile declares, per logical role (secured / filings / debtors), how to find
// the uploaded file (filename hints), its delimiter + header presence, and the
// column candidates for each logical field. The join key ties the three together.
//
// COLUMN CANDIDATES are lists so a header rename in a future master unload still
// resolves; "#N" gives a 0-based index fallback for headerless files. These are
// seeded from the CA/FL loaders' observed headers and are the ONE place to update
// when a state's file format shifts.
export type RoleKind = "secured" | "filings" | "debtors";
export interface RoleSpec {
  hints: string[];          // lowercase filename substrings that identify this file
  delimiter: string;
  hasHeader: boolean;
  columns: Record<string, string[]>;
}
export interface StateFileProfile {
  state: string;
  joinKey: Record<RoleKind, string>; // logical field name of the join key per role
  windowDays: number;       // keep non-terminated filings filed within this window
  secured: RoleSpec;
  filings: RoleSpec;
  debtors: RoleSpec;
}

// CALIFORNIA — bizfile master unload: 4 pipe-delimited CSVs joined on UCC1_NUM.
// (FilingAmendments is not needed for a live-position list — terminations show via
// the Filings status/lapse columns.) Header candidates confirmed with ca-ucc-loader.
export const CA_PROFILE: StateFileProfile = {
  state: "CA",
  windowDays: 540,
  joinKey: { secured: "filing_no", filings: "filing_no", debtors: "filing_no" },
  secured: {
    hints: ["secured", "securedparties", "secured_parties", "sp"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["UCC1_NUM", "FILING_NUMBER", "FILE_NUMBER", "#0"],
      secured_party_raw: ["SECURED_PARTY_NAME", "ORGANIZATION_NAME", "NAME", "ENTITY_NAME"],
    },
  },
  filings: {
    hints: ["filing", "filings"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["UCC1_NUM", "FILING_NUMBER", "FILE_NUMBER", "#0"],
      filed_date: ["FILING_DATE", "LAPSE_DATE", "FILE_DATE", "DATE_FILED"],
      lapse_date: ["LAPSE_DATE", "EXPIRATION_DATE"],
      status: ["STATUS", "FILING_STATUS", "FILING_TYPE"],
    },
  },
  debtors: {
    hints: ["debtor", "debtors"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["UCC1_NUM", "FILING_NUMBER", "FILE_NUMBER", "#0"],
      debtor_name: ["DEBTOR_NAME", "ORGANIZATION_NAME", "BUSINESS_NAME", "NAME"],
      debtor_address: ["ADDRESS", "ADDRESS1", "MAIL_ADDRESS", "STREET"],
      debtor_city: ["CITY"],
      debtor_state: ["STATE", "ST"],
      debtor_zip: ["ZIP", "ZIPCODE", "ZIP_CODE", "POSTAL_CODE"],
    },
  },
};

// FLORIDA — floridaucc.com free bulk download (secureds / filings / debtors / events).
// Header candidates confirmed with fl-ucc-loader.
export const FL_PROFILE: StateFileProfile = {
  state: "FL",
  windowDays: 540,
  joinKey: { secured: "filing_no", filings: "filing_no", debtors: "filing_no" },
  secured: {
    hints: ["secured", "secureds", "securedparty", "sp"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["FILING_NUMBER", "DOCUMENT_NUMBER", "FILE_NUMBER", "#0"],
      secured_party_raw: ["SECURED_PARTY_NAME", "NAME", "ORGANIZATION_NAME"],
    },
  },
  filings: {
    hints: ["filing", "filings"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["FILING_NUMBER", "DOCUMENT_NUMBER", "FILE_NUMBER", "#0"],
      filed_date: ["FILING_DATE", "FILE_DATE", "DATE_FILED"],
      lapse_date: ["LAPSE_DATE", "EXPIRATION_DATE"],
      status: ["STATUS", "FILING_STATUS", "FILING_TYPE"],
    },
  },
  debtors: {
    hints: ["debtor", "debtors"],
    delimiter: "|",
    hasHeader: true,
    columns: {
      filing_no: ["FILING_NUMBER", "DOCUMENT_NUMBER", "FILE_NUMBER", "#0"],
      debtor_name: ["DEBTOR_NAME", "NAME", "ORGANIZATION_NAME", "BUSINESS_NAME"],
      debtor_address: ["ADDRESS", "ADDRESS1", "STREET", "MAIL_ADDRESS"],
      debtor_city: ["CITY"],
      debtor_state: ["STATE", "ST"],
      debtor_zip: ["ZIP", "ZIPCODE", "ZIP_CODE", "POSTAL_CODE"],
    },
  },
};

export const PROFILES: Record<string, StateFileProfile> = { CA: CA_PROFILE, FL: FL_PROFILE };

// A published filing is "terminated"/dead if its status text says so. Kept in one
// place so both states share the definition; the freshness window is applied on
// filed_date at finalize (in SQL).
export function isTerminatedStatus(status: string | null): boolean {
  if (!status) return false;
  // Leading word-boundary + stem (no trailing boundary) so "Terminated"/"Lapsed"/
  // "Expired" all match. SQL twin: ph_ucc_finalize_file_job's status filter.
  return /\b(TERMINAT|LAPSE|EXPIR|RELEAS|CLOSED|DEAD)/i.test(status);
}

// Match an uploaded object path to a role by filename hint.
export function roleForPath(path: string, profile: StateFileProfile): RoleKind | null {
  const base = path.toLowerCase().split("/").pop() ?? path.toLowerCase();
  // Order matters: check secured/debtors before filings, since "filing" is a
  // substring hint that could appear in other names.
  for (const role of ["secured", "debtors", "filings"] as RoleKind[]) {
    if (profile[role].hints.some((h) => base.includes(h))) return role;
  }
  return null;
}
