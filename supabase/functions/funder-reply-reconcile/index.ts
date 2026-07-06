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
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, type GhlConfig,
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
      return json({
        ok: true, action: "cron", scanned: r.scanned, proposals: r.proposals.length,
        auto_applied: results.filter((x) => x.ok).length,
        pending_review: pendingReview, conflicts: r.conflicts, results,
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
