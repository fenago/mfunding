// ─────────────────────────────────────────────────────────────────────────────
// Funder disclosure — the guards and loaders behind "who to call", "where the
// deal goes" and "the recorded box".
//
// This file exists so there is exactly ONE credential guard and ONE
// unknown-vs-absent discriminator. Both are safety properties, not conveniences:
//   • `lenders.notes` / `submission_notes` hold live plaintext credentials on
//     four funders (Guidant's is a working uid:/pw: pair). Anything that renders
//     those columns must go through safeQuote().
//   • funder_submission_profiles, lender_documents and lender_programs are all
//     readable by Ops and NOT by a setter, and RLS returns zero rows with no
//     error. "None recorded" and "you may not see this" are different sentences
//     to a processor, and only canRead() can tell them apart.
// A second copy of either would re-ship a leak or a lie on another page.
// ─────────────────────────────────────────────────────────────────────────────
import supabase from "@/supabase";

// Money/number formatting shared by the disclosure blocks and the cheat sheet.
export const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const fmtMoney = (n: number | null) =>
  n == null
    ? null
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
      : n >= 1000
        ? `$${Math.round(n / 1000)}K`
        : `$${n}`;

// Reach-someone fields. Every one of them is sparsely populated across the 125
// funders (95 have a phone, 58 an email, 42 a name, 42 a `contacts` array), so
// the contact block is built for the SPARSE row and states the gaps in words.
export type ContactFields = {
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contacts: ContactPerson[] | null;
  submission_email: string | null;
  // The broker/ISO portal — where you LOG IN (rate sheets, marketing material,
  // sometimes submission). Not the same thing as a submission address.
  submission_portal_url: string | null;
  submission_notes: string | null;
  website: string | null;
  notes: string | null;
};
export type ContactPerson = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
};


// A US phone number inside free text. Used ONLY to make the digits tappable:
// the original string is rendered verbatim around the links, labels and all
// ("929-531-9989 (direct) · 646-491-1130 (cell)"), so a bad match can mislink
// but can never rewrite or hide what was recorded.
export const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
export const telHref = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `tel:+${d}` : d.length === 10 ? `tel:+1${d}` : `tel:${d}`;
};


export const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

// ── Never print a credential ─────────────────────────────────────────────────
// The free-text columns this page quotes are NOT a safe place to read from
// blind. `lenders.submission_notes` carries the live password for our own
// mailbox on three funders (IOU Financial, Lendini, Uplyft: the literal string
// "sales@send.mfunding.net / Descartes2!"), and this page is open to every
// setter. A note that looks like it contains a credential is withheld WHOLE —
// not partially redacted, because a partial redaction that misses is worse than
// no redaction at all, and a withheld note is recoverable by asking Ops.
//
// Two shapes catch it:
//   1. the word — password / pwd / un/pw / credentials / login:
//   2. an email followed by a separator and a token that is NOT a phone number,
//      an email or a URL — which is what "x@y.com / Descartes2!" is, and what
//      "team@mcashadvance.com / 855-433-8641" is not.
// `pw:` and `uid:` are here because of a real row: Guidant's `lenders.notes`
// holds a pasted partner-portal dump with "uid: <email>" and "pw: <secret>" on
// consecutive lines — a complete working pair that the first version of this
// guard sailed straight past, because it only knew the word "password".
const SECRET_WORD_RX =
  /\b(pass(word|wd)?|pwd|credentials?)\b|\b(un\s*\/\s*pw|u\s*\/\s*p)\b|\b(pw|uid|un|user(name)?|login)\s*[:=]/i;
const EMAIL_PAIR_RX = /[\w.+-]+@[\w.-]+\.[a-z]{2,}\s*[/:]\s*(\S+)/gi;
const TOKEN_IS_HARMLESS = (t: string) =>
  /^[\d()+.\-\s]{7,}$/.test(t) || t.includes("@") || /^https?:/i.test(t) || /^www\./i.test(t);

export function looksLikeSecret(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t === "") return false;
  if (SECRET_WORD_RX.test(t)) return true;
  EMAIL_PAIR_RX.lastIndex = 0;
  for (let m = EMAIL_PAIR_RX.exec(t); m !== null; m = EMAIL_PAIR_RX.exec(t)) {
    if (!TOKEN_IS_HARMLESS(m[1])) return true;
  }
  return false;
}

// Every free-text quote on this page goes through here. Returns the text, or
// null plus the reason it is being withheld.
export function safeQuote(text: string | null | undefined): { text: string | null; withheld: boolean } {
  const t = clean(text);
  if (!t) return { text: null, withheld: false };
  return looksLikeSecret(t) ? { text: null, withheld: true } : { text: t, withheld: false };
}


// ── What a link actually is ──────────────────────────────────────────────────
// A URL on a page headed "the fastest submission you can make today" reads as
// safe to send a merchant. For most of these URLs that is FALSE, and the risk
// is invisible — no identifier in the link means the merchant is a walk-in and
// the commission is gone. So every rendered URL is classified and labelled.
// Prose in `lenders.notes` / the submission profile's `internal_notes` carries
// real contact detail ("Francine Grimaldi (Account Manager) - Direct
// 929-531-9989, Cell 646-491-1130"). It is QUOTED, never parsed into fields: a
// wrong phone number is worse than a sentence someone has to read.
export const mentionsContact = (s: string | null) => !!s && (s.includes("@") || /\d{3}[).\-\s]?\d{3}[.\-\s]?\d{4}/.test(s));

export type LinkClass = "attributed" | "internal" | "unattributed";
const ATTRIBUTION_PARAM_RX = /[?&](iso|plid|ref|referral|partner|partnerid|aff|affiliate|agent|promo|pid|lid)=[^&]+/i;
// Our own account, not a merchant route: a portal/app/broker host, a broker
// path carrying our account id (Uplyft's daydreamos.com/broker/<uuid>), or an
// e-signature link, which is a document WE sign and never a merchant apply page.
const INTERNAL_HOST_RX =
  /\b(portal|app|broker|brokers|iso|dashboard|login|my|go)\.|mypartner\.io|\/dashboard|\/login|\/partner\/center|\/brokers?\/[0-9a-f-]{8,}|signnow\.com|docusign\.|boldsign\.|hellosign\.|adobesign\./i;

export function classifyLink(url: string): LinkClass {
  if (ATTRIBUTION_PARAM_RX.test(url)) return "attributed";
  if (INTERNAL_HOST_RX.test(url)) return "internal";
  return "unattributed";
}

export const LINK_CHIP: Record<LinkClass, { cls: string; label: string; title: string }> = {
  attributed: {
    cls: "bchip open",
    label: "carries our ID ✓",
    title: "This link identifies Momentum Funding. Safe to send a merchant.",
  },
  internal: {
    cls: "bchip",
    label: "we log in — never send",
    title: "Our own portal. Sending it to a merchant does nothing useful.",
  },
  unattributed: {
    cls: "bchip warn",
    label: "⚠ no ID — we are not credited",
    title:
      "This URL carries nothing that identifies Momentum Funding. If a merchant applies through it they are a walk-in and the commission is gone. Check how attribution actually works for this funder before sending it to anyone.",
  },
};


export type ProgramRow = {
  id: string;
  lender_id: string;
  product_type: string | null;
  points_min: number | string | null;
  points_max: number | string | null;
  important_details: string[] | null;
  required_documents: string[] | null;
  approval_min: number | string | null;
  approval_max: number | string | null;
  term_text: string | null;
  min_credit_score: number | null;
  monthly_revenue_required: number | string | null;
  annual_revenue_required: number | string | null;
  time_in_business_months: number | null;
  cost_of_capital: string | null;
  time_to_approve: string | null;
  payment_frequency: string | null;
  doc_bank_statement_months: number | null;
  doc_tax_returns: { business_years?: number | null; personal_years?: number | null } | null;
  doc_financials_threshold: number | string | null;
  doc_extras: string[] | null;
  doc_conditions: string | null;
  doc_other: string | null;
  industries_note: string | null;
  notes: string | null;
};
export type ProgramState = { byKey: Record<string, ProgramRow>; readable: boolean };

export const progKey = (lenderId: string, product: string) => `${lenderId}::${product}`;

export const fmtMonths = (m: number | null) => {
  if (m == null) return null;
  if (m % 12 === 0 && m >= 12) return `${m / 12} yr${m === 12 ? "" : "s"}`;
  return `${m} mo`;
};
export const fmtPts = (lo: number | string | null, hi: number | string | null) => {
  const a = num(lo);
  const b = num(hi);
  if (a != null && b != null) return a === b ? `${b}%` : `${a}–${b}%`;
  if (b != null) return `up to ${b}%`;
  if (a != null) return `${a}%+`;
  return null;
};
export const prettyExtra = (x: string) => x.replace(/_/g, " ");


export type LenderDoc = {
  id: string;
  lender_id: string;
  document_type: string | null;
  filename: string | null;
  storage_path: string | null;
  description: string | null;
};
export type DocState = {
  byLender: Record<string, LenderDoc[]>;
  // FALSE means UNREADABLE — `lender_documents` is admin/super-admin only, so a
  // setter reads zero rows with NO error. Same trap as the submission profiles.
  readable: boolean;
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  rate_sheet: "rate sheet",
  agreement: "agreement",
  terms: "guidelines",
  other: "material",
};

// A credential hint is meant to say WHERE the credentials live, not to be one.
// Anything that doesn't look like a labelled hint is withheld rather than
// printed on a page setters can open — a bare two-word string is as likely to
// be a passphrase as a note, and there is no upside to guessing right.
export const CREDENTIAL_LOOKS_LABELLED = /@|https?:|\b(login|user|username|reset|sso|portal|ask|set via|not stored|invite)\b/i;

export type ProfileRow = {
  lender_id: string;
  method: string | null;
  to_email: string | null;
  cc_emails: string[] | null;
  portal_url: string | null;
  portal_credentials_hint: string | null;
  required_stips: string[] | null;
  active: boolean | null;
  special_instructions: string | null;
  internal_notes: string | null;
};
export type ProfileState = {
  map: Record<string, ProfileRow>;
  // FALSE means UNREADABLE — never "no profile exists".
  readable: boolean;
  error: string | null;
  // A query that failed is a fault and shouts in red. A setter who is simply
  // not on the RLS policy is NOT a fault — it's a standing limit of their
  // account, and painting it red on every page load just teaches everyone to
  // ignore red. Both still mean UNKNOWN in every row that depends on them.
  severity: "error" | "limited";
};

const PROFILE_COLS =
  "lender_id, method, to_email, cc_emails, portal_url, portal_credentials_hint, required_stips, active, special_instructions, internal_notes";

// One read of the submission recipes, shared by every tab. Both failure modes
// collapse to `readable: false`, because a setter (role `closer`) is not on the
// RLS policy for funder_submission_profiles and gets zero rows with NO error —
// "none recorded" and "you may not read these" are indistinguishable from here.
// Merging keeps the pessimistic side: once any read came back unreadable, the
// page keeps saying so rather than letting a later partial read imply coverage.
export function mergeProfiles(prev: ProfileState, next: ProfileState): ProfileState {
  const error = prev.error ?? next.error;
  return {
    map: { ...prev.map, ...next.map },
    readable: prev.readable && next.readable,
    error,
    severity: prev.severity === "error" || next.severity === "error" ? "error" : "limited",
  };
}

// "I got zero rows" and "I am not allowed to see this table" are the same
// response under RLS. They are NOT the same sentence to a processor, and this
// page has spent four commits keeping such pairs apart, so it is worth one
// extra query to tell them apart: ask the table for ANY single row, unfiltered.
//   error or zero rows back  → this account cannot see the table → UNKNOWN
//   a row back               → the table is readable → an empty filtered read
//                              genuinely means "none for these funders"
// Without this, a credit tab whose visible funders happen to have no recorded
// box reports "can't read" when the truth is "we haven't recorded it".
// `.in()` goes in the query STRING, so 121 UUIDs is a ~4.7KB URL — long enough
// for a proxy or CDN to answer 414 instead of the funder list, and a read that
// fails for a reason nobody can see is the thing this page keeps being wrong
// about. Ask in chunks.
const ID_CHUNK = 40;
const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function canRead(table: "lender_documents" | "lender_programs" | "funder_submission_profiles"): Promise<boolean> {
  const { data, error } = await supabase.from(table).select("lender_id").limit(1);
  return !error && (data ?? []).length > 0;
}

// `lender_documents` is admin/super-admin only. A setter reads zero rows with
// no error, so an empty result is UNKNOWN, never "nothing on file".
export async function loadDocs(ids: string[]): Promise<DocState> {
  if (ids.length === 0) return { byLender: {}, readable: true };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) =>
      supabase
        .from("lender_documents")
        .select("id, lender_id, document_type, filename, storage_path, description")
        .in("lender_id", c),
    ),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) return { byLender: {}, readable: false };
  if ((data ?? []).length === 0) return { byLender: {}, readable: await canRead("lender_documents") };
  const byLender: Record<string, LenderDoc[]> = {};
  for (const d of (data ?? []) as LenderDoc[]) (byLender[d.lender_id] ??= []).push(d);
  return { byLender, readable: true };
}

export function mergeDocs(prev: DocState, next: DocState): DocState {
  return { byLender: { ...prev.byLender, ...next.byLender }, readable: prev.readable && next.readable };
}

// Recorded credit boxes. `lender_programs` is ops-staff/processor only, so a
// setter's empty read is UNKNOWN, never "no box recorded". Selected with * on
// purpose: columns are still being added to this table and a column list would
// 400 the whole page the day one lands.
export async function loadPrograms(ids: string[]): Promise<ProgramState> {
  if (ids.length === 0) return { byKey: {}, readable: true };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) => supabase.from("lender_programs").select("*").in("lender_id", c)),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) return { byKey: {}, readable: false };
  if ((data ?? []).length === 0) return { byKey: {}, readable: await canRead("lender_programs") };
  const byKey: Record<string, ProgramRow> = {};
  for (const r of (data ?? []) as ProgramRow[]) {
    if (r.product_type) byKey[progKey(r.lender_id, r.product_type)] = r;
  }
  return { byKey, readable: true };
}

export function mergePrograms(prev: ProgramState, next: ProgramState): ProgramState {
  return { byKey: { ...prev.byKey, ...next.byKey }, readable: prev.readable && next.readable };
}

export async function loadProfiles(ids: string[]): Promise<ProfileState> {
  if (ids.length === 0) return { map: {}, readable: true, error: null, severity: "limited" };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) => supabase.from("funder_submission_profiles").select(PROFILE_COLS).in("lender_id", c)),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) {
    return {
      map: {},
      readable: false,
      error: `Submission addresses and recipes could not be read — ${error.message}. This is a READ FAILURE: every submission contact below is UNKNOWN, not absent.`,
      severity: "error",
    };
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length === 0 && !(await canRead("funder_submission_profiles"))) {
    return {
      map: {},
      readable: false,
      error:
        "Submission addresses are UNKNOWN on this page — your account cannot read the submission profiles (Ops can; a setter account cannot). Treat every submission address as unknown, not as absent: there IS somewhere to send a deal, ask Ops where.",
      severity: "limited",
    };
  }
  const map: Record<string, ProfileRow> = {};
  for (const r of rows) map[r.lender_id] = r;
  return { map, readable: true, error: null, severity: "limited" };
}
