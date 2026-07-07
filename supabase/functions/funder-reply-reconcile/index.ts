// funder-reply-reconcile — associate stray funder replies with the right lender.
//
// PROBLEM: funders reply to our submissions from whatever address they like
// (tonyc@rok.biz, support@…, a rep's personal-but-corporate address). Those
// replies land in GHL Conversations as fresh contacts with NO link to the
// lender they belong to, so nothing downstream (reply detection, the Step-7
// board, the funder's contact card) ever sees them.
//
// FIX: match each inbound funder email to a lender by the SENDER EMAIL DOMAIN
// (built from lenders.website + submission_email + primary_contact_email),
// AI-extract the point-of-contact from the signature, let an admin review, and
// on approve (a) save the contact into lenders.contacts, (b) fill primary_* if
// empty, and (c) set lenders.ghl_contact_id — which closes the loop: the
// existing ghl-webhook auto-associates every FUTURE reply once that id is set.
//
// Actions:
//   "scan"  — read-only. Returns proposals for the review UI. Writes NOTHING.
//   "apply" — write approved proposals into lenders + activity_log.
//
// Auth (two callers):
//   • Admin UI     → user JWT (verify_jwt=true) with admin/super_admin role.
//   • Periodic cron → same fn with ?secret=<GHL webhook secret>; trusted, may
//                     auto-apply HIGH-CONFIDENCE proposals (domain match + a
//                     non-empty extracted name) so the map self-maintains.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, getContact, type GhlConfig,
} from "../_shared/ghl.ts";
import { callLLM } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Noise: senders that are never a funder point-of-contact ──────────────────
// Our own sending identities (a CC copy of our submission can loop back).
const OWN_SUBSTR = ["mfunding.net", "send.mfunding.net", "mfunding.com", "socrates73@gmail.com"];
// Our own phone numbers (10 digits) — a calendar invite / booking email prints
// these in its body; they must never be captured as a funder's phone.
const OWN_PHONE_DIGITS = new Set(["9547375692"]);
// Toll-free area codes — a shared/marketing line, never a funder's direct POC.
const TOLLFREE_NPA = new Set(["800", "888", "877", "866", "855", "844", "833"]);
// E-sign / system / calendar senders — automated, no human POC to save.
const SYSTEM_SUBSTR = [
  "boldsign", "pandadoc", "signnow", "docusign", "hellosign", "dropboxsign",
  "calendar-server.bounces.google.com", "calendar.google.com",
  "google.com", "leadconnector", "gmail.com", "yahoo.com", "outlook.com",
  "hotmail.com", "aol.com", "icloud.com",
];

const hostOf = (raw?: string | null): string | null => {
  if (!raw) return null;
  if (raw.includes("@")) return raw.split("@")[1]?.trim().toLowerCase() || null;
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase() || null;
};

const isOwnOrSystem = (email: string): boolean => {
  const e = email.toLowerCase();
  if (OWN_SUBSTR.some((s) => e.includes(s))) return true;
  const domain = e.split("@")[1] ?? "";
  return SYSTEM_SUBSTR.some((s) => domain.includes(s) || e.includes(s));
};

interface LenderRow {
  id: string;
  company_name: string;
  website: string | null;
  submission_email: string | null;
  primary_contact_email: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  ghl_contact_id: string | null;
  contacts: unknown;
}

interface Extracted { name: string | null; title: string | null; phone: string | null; email: string | null }
interface Proposal {
  conversationId: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
  lenderId: string;
  lenderName: string;
  domain: string;
  extracted: Extracted;
  alreadyLinked: boolean; // lender.contacts already has this email/phone
  lenderLinked: boolean;  // lender.ghl_contact_id already set (to anyone)
}

// Build domain → lender. First lender wins on a shared domain (rare); the
// conflict is reported so it can be cleaned up.
function buildDomainMap(lenders: LenderRow[]): { map: Map<string, LenderRow>; conflicts: string[] } {
  const map = new Map<string, LenderRow>();
  const conflicts: string[] = [];
  for (const l of lenders) {
    const domains = new Set<string>();
    for (const src of [l.submission_email, l.primary_contact_email, l.website]) {
      const h = hostOf(src);
      // Skip generic mailbox providers so a funder that used gmail can't hijack
      // every gmail sender in the inbox.
      if (h && h.includes(".") && !SYSTEM_SUBSTR.some((s) => h.includes(s))) domains.add(h);
    }
    for (const d of domains) {
      const existing = map.get(d);
      if (existing && existing.id !== l.id) {
        conflicts.push(`${d}: ${existing.company_name} vs ${l.company_name}`);
        continue;
      }
      map.set(d, l);
    }
  }
  return { map, conflicts };
}

function contactsArray(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

// Does the lender already carry a contact with this email or phone?
function hasContact(lender: LenderRow, email: string, phone: string | null): boolean {
  const arr = contactsArray(lender.contacts);
  const e = email.toLowerCase();
  const p = (phone ?? "").replace(/\D/g, "");
  return arr.some((c) => {
    const ce = String(c.email ?? "").toLowerCase();
    const cp = String(c.phone ?? "").replace(/\D/g, "");
    return (e && ce === e) || (p && p.length >= 7 && cp === p);
  });
}

// The freshest inbound email body from a funder contact's conversation — the
// richest source of their signature. The message-level `body` is GHL's quoted
// original, so (as in poll-funder-replies) the real text lives on the linked
// email record (meta.email.messageIds). Returns "" if nothing resolvable.
async function latestInboundBody(cfg: GhlConfig, conversationId: string): Promise<string> {
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${conversationId}/messages?limit=15`,
  );
  const list = msgs.data?.messages?.messages ?? [];
  const inbound = list
    .filter((m) => String(m.direction ?? "") === "inbound" && /email/i.test(String(m.messageType ?? "")))
    .sort((a, b) => Date.parse(String(b.dateAdded ?? "")) - Date.parse(String(a.dateAdded ?? "")));
  for (const m of inbound) {
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    for (const eid of ids) {
      const emailRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
        cfg, "GET", `/conversations/messages/email/${eid}`,
      );
      const e = (emailRes.data?.emailMessage ?? emailRes.data ?? {}) as Record<string, unknown>;
      if (String(e.direction ?? "") !== "inbound") continue;
      const body = String(e.body ?? "");
      if (body.trim()) return body;
    }
  }
  return "";
}

// Strip HTML → plain text, keep line breaks (signatures are line-oriented).
function toText(raw: string): string {
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// AI-extract the POC from an email signature. Best-effort — any failure returns
// all-null (the reviewer can still fill it in). Task-agnostic via callLLM.
async function extractSignature(db: SupabaseClient, body: string): Promise<Extracted> {
  const empty: Extracted = { name: null, title: null, phone: null, email: null };
  const text = toText(body);
  if (!text) return empty;
  // The signature is near the end; also drop the quoted original so we don't
  // read the merchant's / our own text.
  let sig = text;
  const q = sig.search(/\bOn\s.{4,80}\swrote:/);
  if (q > 0) sig = sig.slice(0, q).trim();
  sig = sig.slice(-1200);

  const system =
    "You extract the sender's contact details from the SIGNATURE of a business email that a " +
    "commercial-funding company representative sent to a broker. Return ONLY a strict JSON object, " +
    "no prose or markdown, of the EXACT shape: " +
    '{"name":string|null,"title":string|null,"phone":string|null,"email":string|null}. ' +
    "Use the sign-off / signature block (the person's own name, job title, phone, email) — NOT the " +
    "greeting, NOT quoted text, NOT the recipient. If a field is absent, use null. Never invent a value. " +
    "Phone: keep it as written (digits and separators). Do not return a company-generic mailbox " +
    "(info@, support@, submissions@) as the person's email unless that is genuinely all that is present.";
  try {
    let out = (await callLLM(db, {
      system,
      prompt: `Email:\n"""\n${sig}\n"""\n\nReturn the JSON now.`,
      maxTokens: 400, temperature: 0, jsonMode: true, task: "extract_signature",
    })).trim();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(out); } catch {
      const s = out.indexOf("{"), e = out.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(out.slice(s, e + 1)); } catch { /* give up */ } }
    }
    if (!parsed || typeof parsed !== "object") return empty;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
    return { name: str(parsed.name), title: str(parsed.title), phone: str(parsed.phone), email: str(parsed.email) };
  } catch {
    return empty;
  }
}

// ── PHONE BACKFILL ───────────────────────────────────────────────────────────
// The AI signature extractor under-performed on phones — most saved contacts got
// name+email but no phone. A signature phone is far more reliable via a plain
// US-phone REGEX, so backfill runs that over the freshest inbound email body and
// writes the number back into the contact (LLM is only a last-ditch fallback).

// Normalize any written form → "(305) 851-0900". Returns null if not a plausible
// 10-digit US number (drops a leading country-code 1).
function normalizePhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (d[0] === "0" || d[0] === "1") return null; // invalid US area code
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Matches (305) 851-0900 · 305-851-0900 · 305.851.0900 · +1 305 851 0900 ·
// 3058510900 · 305 851 0900. Digit look-arounds keep it from biting into a
// longer number (EIN, account #, a fax printed as one run of digits).
const PHONE_RE =
  /(?<!\d)(?:\+?1[\s.\-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.\-]?)\d{3}[\s.\-]?\d{4}(?!\d)/g;
// A phone we want (as opposed to a fax) is often on a labeled line.
const LABEL_RE = /\b(phone|direct|office|cell|mobile|telephone|tel|call|ph|mob)\b|(?:^|\s)[pomct]\s*[:.\-]/i;
const FAX_RE = /\bfax\b|(?:^|\s)f\s*[:.\-]/i;

// Regex-extract the sender's phone from the SIGNATURE of an email body. Prefers
// a labeled (phone/direct/cell) non-fax number, and the one nearest the person's
// name when several appear. Returns a normalized string or null.
function extractSignaturePhone(rawBody: string, personName?: string | null): string | null {
  const text = toText(rawBody);
  if (!text) return null;
  // Drop the quoted original — the signature we want is our correspondent's.
  let sig = text;
  const q = sig.search(/\bOn\s.{4,80}\swrote:/);
  if (q > 0) sig = sig.slice(0, q).trim();
  const lines = sig.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-18); // the signature block lives at the end

  const firstName = personName ? personName.toLowerCase().split(/\s+/)[0] : "";
  const nameIdx = firstName
    ? tail.findIndex((l) => firstName.length > 1 && l.toLowerCase().includes(firstName))
    : -1;

  interface Cand { phone: string; labeled: boolean; fax: boolean; idx: number }
  const cands: Cand[] = [];
  tail.forEach((line, idx) => {
    // A line that carries our own identity (e.g. a booking line "…
    // sales@send.mfunding.net 9547375692") holds OUR number, not the funder's.
    if (OWN_SUBSTR.some((s) => line.toLowerCase().includes(s))) return;
    const matches = line.match(PHONE_RE);
    if (!matches) return;
    const labeled = LABEL_RE.test(line);
    const fax = FAX_RE.test(line);
    for (const m of matches) {
      const norm = normalizePhone(m);
      if (!norm) continue;
      if (OWN_PHONE_DIGITS.has(norm.replace(/\D/g, ""))) continue; // never our own line
      cands.push({ phone: norm, labeled, fax, idx });
    }
  });
  // Never return a fax when a real phone is present; if only fax exists, decline.
  const pool = cands.filter((c) => !c.fax);
  if (!pool.length) return null;

  const score = (c: Cand) => {
    let s = c.labeled ? 10 : 0;
    s += nameIdx >= 0 ? Math.max(0, 8 - Math.abs(c.idx - nameIdx)) : c.idx; // near name, else deeper
    return s;
  };
  pool.sort((a, b) => score(b) - score(a));
  return pool[0].phone;
}

// Inbound email bodies for a GHL contact, best candidate first. Unlike the
// shared latestInboundBody (used by scan), this does NOT trust the CONVERSATION
// message-level `direction` — on these funder threads it is often null and the
// real direction lives on the resolved email record. We therefore resolve every
// email record, keep the inbound ones, drop calendar/automated senders, and rank
// funder-domain senders (then most-recent) first so a signature phone surfaces.
async function inboundFunderBodies(cfg: GhlConfig, contactId: string, contactEmail: string): Promise<string[]> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  const cid = conv.data?.conversations?.[0]?.id;
  if (!cid) return [];

  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=25`,
  );
  const list = msgs.data?.messages?.messages ?? [];
  const emailIds: string[] = [];
  for (const m of list) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    emailIds.push(...ids);
  }

  const domain = contactEmail.includes("@") ? contactEmail.split("@")[1].toLowerCase() : "";
  const found: Array<{ body: string; sameDomain: boolean; date: number }> = [];
  for (const eid of [...new Set(emailIds)]) {
    const res = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
      cfg, "GET", `/conversations/messages/email/${eid}`,
    );
    const e = (res.data?.emailMessage ?? res.data ?? {}) as Record<string, unknown>;
    if (String(e.direction ?? "") !== "inbound") continue;
    const from = String(e.from ?? "").toLowerCase();
    if (/calendar\.google|no-?reply|unsubscribe|leadconnector/.test(from)) continue; // automated, no POC
    const body = String(e.body ?? "");
    if (!body.trim()) continue;
    // A calendar/booking invite prints OUR number, not the funder's — skip it by
    // content (its sender is often the funder, so the sender filter misses it).
    if (/Powered by Google Calendar|Book another appointment|calendar\.google\.com\/calendar\/appointments|guest list for this booked appointment/i.test(body)) continue;
    found.push({
      body,
      sameDomain: !!domain && from.includes(domain),
      date: Date.parse(String(e.dateAdded ?? e.date ?? "")) || 0,
    });
  }
  found.sort((a, b) => (a.sameDomain === b.sameDomain ? b.date - a.date : a.sameDomain ? -1 : 1));
  return found.map((f) => f.body);
}

interface BackfillResult {
  scanned_lenders: number;
  contacts_checked: number;
  phones_found: number;
  phones_written: number;
  sample: Array<{ lender: string; email: string | null; phone: string }>;
}

async function backfillPhones(db: SupabaseClient, cfg: GhlConfig): Promise<BackfillResult> {
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, primary_contact_email, primary_contact_phone, contacts");
  const rows = ((lenders ?? []) as LenderRow[]).filter((l) => contactsArray(l.contacts).length > 0);

  let contactsChecked = 0, phonesFound = 0, phonesWritten = 0;
  const sample: Array<{ lender: string; email: string | null; phone: string }> = [];

  for (const l of rows) {
    const arr = contactsArray(l.contacts);
    let lenderFound = 0;
    let primaryPhoneToSet: string | null = null;
    const primaryEmail = String(l.primary_contact_email ?? "").toLowerCase();
    const primaryHasPhone = !!String(l.primary_contact_phone ?? "").trim();

    for (const c of arr) {
      const ghlId = String(c.ghl_contact_id ?? "").trim();
      const existingPhone = String(c.phone ?? "").trim();
      if (!ghlId) continue;
      if (existingPhone) continue; // idempotent — never overwrite an existing phone
      contactsChecked++;

      const bodies = await inboundFunderBodies(cfg, ghlId, String(c.email ?? ""));
      if (!bodies.length) continue;
      const name = String(c.name ?? "") || null;

      // Regex over each candidate body (funder-domain first); first hit wins.
      let phone: string | null = null;
      for (const body of bodies) {
        phone = extractSignaturePhone(body, name);
        if (phone) break;
      }
      // Last-ditch: the LLM extractor (same task as the reconciler) on the best body.
      if (!phone) {
        const ex = await extractSignature(db, bodies[0]);
        phone = normalizePhone(ex.phone);
      }
      if (!phone) continue;
      if (OWN_PHONE_DIGITS.has(phone.replace(/\D/g, ""))) continue; // never our own number

      c.phone = phone; // mutate this contact only
      phonesFound++;
      lenderFound++;

      const cEmail = String(c.email ?? "").toLowerCase();
      if (!primaryHasPhone && primaryEmail && cEmail === primaryEmail) primaryPhoneToSet = phone;
      sample.push({ lender: l.company_name, email: cEmail || null, phone });
    }

    if (lenderFound > 0) {
      const patch: Record<string, unknown> = { contacts: arr };
      if (primaryPhoneToSet) patch.primary_contact_phone = primaryPhoneToSet;
      const { error } = await db.from("lenders").update(patch).eq("id", l.id);
      if (!error) phonesWritten += lenderFound;
    }
  }

  return {
    scanned_lenders: rows.length,
    contacts_checked: contactsChecked,
    phones_found: phonesFound,
    phones_written: phonesWritten,
    sample,
  };
}

// ── PHONE → FUNDER MATCH ─────────────────────────────────────────────────────
// The email path ties funder REPLIES to a lender by sender DOMAIN. This path does
// the same for inbound CALLS + TEXTS, but by PHONE NUMBER: funder-contact phones
// are already on file (lenders.primary_contact_phone + contacts[].phone/text_phone),
// so an inbound call/SMS whose caller number matches one of them is FROM that funder.

// A phone as its bare 10 US digits (drops a leading country-code 1). Null if it's
// not a plausible US number — same rule as normalizePhone but returns the key.
function phoneDigits(raw: string | null | undefined): string | null {
  const p = normalizePhone(raw);
  return p ? p.replace(/\D/g, "") : null;
}
const isTollFree = (digits: string): boolean => TOLLFREE_NPA.has(digits.slice(0, 3));

// Build phone(10 digits) → lender. First lender wins on a shared DIRECT line
// (reported as a conflict). A shared TOLL-FREE line is tied to NOBODY — it is
// removed and poisoned so no later lender can claim it either; a toll-free unique
// to a single lender is kept. Every collision is reported.
function buildPhoneMap(lenders: LenderRow[]): { map: Map<string, LenderRow>; conflicts: string[] } {
  const map = new Map<string, LenderRow>();
  const poisoned = new Set<string>(); // shared toll-free — never map to anyone
  const conflicts: string[] = [];
  for (const l of lenders) {
    const digits = new Set<string>();
    const add = (raw: unknown) => { const d = phoneDigits(raw as string); if (d) digits.add(d); };
    add(l.primary_contact_phone);
    for (const c of contactsArray(l.contacts)) { add(c.phone); add(c.text_phone); }
    for (const d of digits) {
      if (poisoned.has(d)) continue;
      const existing = map.get(d);
      if (existing && existing.id !== l.id) {
        conflicts.push(`${d}: ${existing.company_name} vs ${l.company_name}`);
        // A shared toll-free is ambiguous marketing — tie it to no one.
        if (isTollFree(d)) { map.delete(d); poisoned.add(d); }
        continue; // first-wins for a shared direct line
      }
      if (!existing) map.set(d, l);
    }
  }
  return { map, conflicts };
}

interface PhoneMatchResult {
  scanned: number;
  phone_matches: number;
  linked: number;
  conflicts: string[];
  samples: Array<{ lender: string; phone: string; contactName: string }>;
}

async function matchPhones(db: SupabaseClient, cfg: GhlConfig): Promise<PhoneMatchResult> {
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, website, submission_email, primary_contact_email, primary_contact_name, primary_contact_phone, ghl_contact_id, contacts");
  const rows = (lenders ?? []) as LenderRow[];
  const { map, conflicts } = buildPhoneMap(rows);

  // GHL contacts already tied to a funder (lender.ghl_contact_id or a saved
  // contacts[].ghl_contact_id) — never re-touch, so re-runs are idempotent.
  const linkedContactIds = new Set<string>();
  for (const l of rows) {
    if (l.ghl_contact_id) linkedContactIds.add(l.ghl_contact_id);
    for (const c of contactsArray(l.contacts)) {
      const id = String(c.ghl_contact_id ?? "").trim();
      if (id) linkedContactIds.add(id);
    }
  }

  // Merchant phones — a call/text from a merchant is never a funder POC.
  const merchantDigits = new Set<string>();
  const { data: custs } = await db.from("customers").select("phone");
  for (const c of (custs ?? []) as Array<{ phone: string | null }>) {
    const d = phoneDigits(c.phone);
    if (d) merchantDigits.add(d);
  }

  // Our own numbers (never a funder): the static blocklist + the location's own
  // line (an outbound call we placed can surface as its own conversation).
  const ownDigits = new Set(OWN_PHONE_DIGITS);
  try {
    const loc = await ghlFetch<{ location?: Record<string, unknown> } & Record<string, unknown>>(
      cfg, "GET", `/locations/${cfg.locationId}`,
    );
    const lp = ((loc.data?.location as Record<string, unknown> | undefined)?.phone ?? loc.data?.phone) as string | undefined;
    const d = phoneDigits(lp);
    if (d) ownDigits.add(d);
  } catch { /* best-effort */ }

  const convRes = await ghlFetch<{ conversations?: Array<Record<string, unknown>> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&limit=100&sortBy=last_message_date`,
  );
  const conversations = convRes.data?.conversations ?? [];

  let phoneMatches = 0, linked = 0;
  const samples: Array<{ lender: string; phone: string; contactName: string }> = [];
  const seen = new Set<string>(); // one pass per contact per run

  for (const c of conversations) {
    const contactId = String(c.contactId ?? "");
    if (!contactId || seen.has(contactId)) continue;

    // The caller phone — prefer the conversation's, else the contact record.
    let phoneRaw = String(c.phone ?? "").trim();
    if (!phoneRaw) {
      const cr = await getContact(cfg, contactId);
      phoneRaw = String((cr.data?.contact as Record<string, unknown> | undefined)?.phone ?? "").trim();
    }
    const digits = phoneDigits(phoneRaw);
    if (!digits) continue;
    if (ownDigits.has(digits) || merchantDigits.has(digits)) continue;

    const lender = map.get(digits);
    if (!lender) continue; // not a known funder phone — the primary noise filter

    seen.add(contactId);
    if (linkedContactIds.has(contactId)) continue; // already tied to a funder
    phoneMatches++;

    const contactName = String(c.fullName ?? c.contactName ?? "").trim();
    const contactEmail = String(c.email ?? "").trim().toLowerCase();
    const formatted = normalizePhone(digits)!; // digits already validated → non-null
    const arr = contactsArray(lender.contacts);

    // Append a funder contact (dedupe by phone/email).
    let appended = false;
    if (!hasContact(lender, contactEmail, formatted)) {
      arr.push({
        name: contactName || lender.company_name,
        email: contactEmail || null,
        phone: formatted,
        source: "phone_match",
        ghl_contact_id: contactId,
        added_at: new Date().toISOString(),
      });
      lender.contacts = arr; // keep in-memory row fresh for a later match on the same lender
      appended = true;
    }

    // Link the lender to this GHL contact if not linked yet — closes the loop so
    // ghl-webhook auto-associates every future reply/text from this contact.
    let linkedNow = false;
    const patch: Record<string, unknown> = {};
    if (appended) patch.contacts = lender.contacts;
    if (!lender.ghl_contact_id) { patch.ghl_contact_id = contactId; lender.ghl_contact_id = contactId; linkedNow = true; }

    if (!appended && !linkedNow) continue; // nothing new to persist

    const { error } = await db.from("lenders").update(patch).eq("id", lender.id);
    if (error) continue;
    linkedContactIds.add(contactId);
    linked++;
    if (samples.length < 12) samples.push({ lender: lender.company_name, phone: formatted, contactName: contactName || lender.company_name });

    try {
      await db.from("activity_log").insert({
        entity_type: "lender", entity_id: lender.id, interaction_type: "note",
        subject: "funder-reply-reconcile",
        content: `Tied inbound call/text from ${formatted}` +
          (contactName ? ` (${contactName})` : "") +
          `${appended ? " · contact saved" : ""}${linkedNow ? " · GHL contact linked" : ""} [ghl:${contactId}]`,
      });
    } catch { /* audit is best-effort */ }
  }

  return { scanned: conversations.length, phone_matches: phoneMatches, linked, conflicts, samples };
}

// ── SCAN ─────────────────────────────────────────────────────────────────────
async function scan(db: SupabaseClient, cfg: GhlConfig): Promise<{ proposals: Proposal[]; conflicts: string[]; scanned: number }> {
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, website, submission_email, primary_contact_email, primary_contact_name, primary_contact_phone, ghl_contact_id, contacts");
  const rows = (lenders ?? []) as LenderRow[];
  const { map, conflicts } = buildDomainMap(rows);

  const convRes = await ghlFetch<{ conversations?: Array<Record<string, unknown>> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&limit=100&sortBy=last_message_date`,
  );
  const conversations = convRes.data?.conversations ?? [];

  const proposals: Proposal[] = [];
  const seenContact = new Set<string>(); // one proposal per funder contact per scan

  for (const c of conversations) {
    const email = String(c.email ?? "").trim().toLowerCase();
    const contactId = String(c.contactId ?? "");
    if (!email || !contactId || !email.includes("@")) continue;
    if (isOwnOrSystem(email)) continue;

    const domain = email.split("@")[1];
    const lender = map.get(domain);
    if (!lender) continue; // not a known funder domain — the primary noise filter
    if (seenContact.has(contactId)) continue;

    // Merchant guard: a contact that is a merchant in `customers` is never a funder POC.
    const { data: cust } = await db.from("customers").select("id").eq("email", email).maybeSingle();
    if (cust) continue;

    seenContact.add(contactId);

    const body = await latestInboundBody(cfg, String(c.id ?? ""));
    const extracted = await extractSignature(db, body);
    // If the signature had no email, fall back to the sender address itself.
    if (!extracted.email) extracted.email = email;

    proposals.push({
      conversationId: String(c.id ?? ""),
      contactId,
      contactEmail: email,
      contactName: String(c.fullName ?? c.contactName ?? "").trim(),
      lenderId: lender.id,
      lenderName: lender.company_name,
      domain,
      extracted,
      alreadyLinked: hasContact(lender, email, extracted.phone),
      lenderLinked: !!lender.ghl_contact_id,
    });
  }
  return { proposals, conflicts, scanned: conversations.length };
}

// ── APPLY ────────────────────────────────────────────────────────────────────
interface ApproveItem { lenderId: string; contactId: string; contactEmail: string; extracted?: Extracted }
interface ApplyResult { lenderId: string; ok: boolean; lenderName?: string; contactAdded?: boolean; primarySet?: boolean; linked?: boolean; error?: string }

async function applyOne(db: SupabaseClient, item: ApproveItem): Promise<ApplyResult> {
  const { data: lender } = await db.from("lenders")
    .select("id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, ghl_contact_id, contacts")
    .eq("id", item.lenderId).maybeSingle();
  if (!lender) return { lenderId: item.lenderId, ok: false, error: "lender not found" };

  const l = lender as unknown as LenderRow;
  const ex = item.extracted ?? { name: null, title: null, phone: null, email: null };
  const email = (ex.email || item.contactEmail || "").toLowerCase();
  const phone = ex.phone;
  const name = ex.name;

  const patch: Record<string, unknown> = {};

  // 1) Append to contacts (dedupe by email/phone).
  const arr = contactsArray(l.contacts);
  let contactAdded = false;
  if (!hasContact(l, email, phone)) {
    arr.push({
      name: name ?? item.contactEmail ?? null,
      title: ex.title ?? null,
      email: email || null,
      phone: phone ?? null,
      source: "email_reply",
      ghl_contact_id: item.contactId || null,
      added_at: new Date().toISOString(),
    });
    patch.contacts = arr;
    contactAdded = true;
  }

  // 2) Fill primary_* only when empty (freshest wins ONLY if empty).
  let primarySet = false;
  if (!l.primary_contact_name && name) { patch.primary_contact_name = name; primarySet = true; }
  if (!l.primary_contact_email && email) { patch.primary_contact_email = email; primarySet = true; }
  if (!l.primary_contact_phone && phone) { patch.primary_contact_phone = phone; primarySet = true; }

  // 3) Link the lender to this GHL contact if not linked yet — closes the loop
  //    so ghl-webbook auto-associates every future reply.
  let linked = false;
  if (!l.ghl_contact_id && item.contactId) { patch.ghl_contact_id = item.contactId; linked = true; }

  if (Object.keys(patch).length) {
    const { error } = await db.from("lenders").update(patch).eq("id", l.id);
    if (error) return { lenderId: l.id, ok: false, lenderName: l.company_name, error: error.message };
  }

  // 4) Audit (interaction_type must be a valid enum — 'note').
  try {
    await db.from("activity_log").insert({
      entity_type: "lender", entity_id: l.id, interaction_type: "note",
      subject: "funder-reply-reconcile",
      content: `Associated funder reply from ${item.contactEmail}` +
        (name ? ` (${name}${ex.title ? `, ${ex.title}` : ""})` : "") +
        `${contactAdded ? " · contact saved" : ""}${primarySet ? " · primary set" : ""}${linked ? " · GHL contact linked" : ""}` +
        ` [ghl:${item.contactId}]`,
    });
  } catch { /* audit is best-effort */ }

  return { lenderId: l.id, ok: true, lenderName: l.company_name, contactAdded, primarySet, linked };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const cfg = await getGhlConfig(db);

  // --- Auth: trusted cron (shared secret) OR signed-in admin/super_admin. ---
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  let cronMode = false;
  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
    cronMode = true;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["admin", "super_admin"].includes(role)) return json({ error: "Forbidden — admin only" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* cron may POST no body */ }
  // Cron with no explicit action defaults to a self-maintaining scan+auto-apply.
  const action = String(payload.action ?? (cronMode ? "cron" : "scan"));

  try {
    if (action === "scan") {
      const r = await scan(db, cfg);
      return json({ ok: true, action: "scan", ...r });
    }

    if (action === "backfill-phones") {
      const r = await backfillPhones(db, cfg);
      return json({ ok: true, action: "backfill-phones", ...r });
    }

    if (action === "match-phones") {
      const r = await matchPhones(db, cfg);
      return json({ ok: true, action: "match-phones", ...r });
    }

    if (action === "apply") {
      const approved = Array.isArray(payload.approved) ? (payload.approved as ApproveItem[]) : [];
      const results: ApplyResult[] = [];
      for (const item of approved) {
        if (!item?.lenderId || !item?.contactId) { results.push({ lenderId: String(item?.lenderId ?? ""), ok: false, error: "missing lenderId/contactId" }); continue; }
        results.push(await applyOne(db, item));
      }
      return json({ ok: true, action: "apply", applied: results.filter((r) => r.ok).length, results });
    }

    if (action === "cron") {
      // Self-maintenance: scan, then auto-apply only HIGH-CONFIDENCE proposals
      // (domain match + a non-empty extracted name) that aren't already linked.
      // Ambiguous ones (no name) are left for the review screen.
      const r = await scan(db, cfg);
      const auto = r.proposals.filter((p) => !!p.extracted.name && !p.alreadyLinked);
      const results: ApplyResult[] = [];
      for (const p of auto) {
        results.push(await applyOne(db, {
          lenderId: p.lenderId, contactId: p.contactId, contactEmail: p.contactEmail, extracted: p.extracted,
        }));
      }
      const pendingReview = r.proposals.filter((p) => !p.extracted.name && !p.alreadyLinked).length;
      // Also tie inbound calls/texts to funders by phone number (see matchPhones).
      const ph = await matchPhones(db, cfg);
      return json({
        ok: true, action: "cron", scanned: r.scanned, proposals: r.proposals.length,
        auto_applied: results.filter((x) => x.ok).length,
        pending_review: pendingReview, conflicts: r.conflicts, results,
        phone_match: {
          scanned: ph.scanned, phone_matches: ph.phone_matches, linked: ph.linked,
          conflicts: ph.conflicts, samples: ph.samples,
        },
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
