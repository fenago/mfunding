// Shared GHL inbound-email → Supabase document bridge.
//
// Merchants don't only upload docs through the GHL secure-upload form — plenty of
// them just REPLY to our email with their bank statements/ID/application attached
// (verified live: Kanthaka Group forwarded 25 statement PDFs straight to
// sales@send.mfunding.net). Those attachments live ONLY on the GHL email RECORD,
// never on a FILE_UPLOAD custom field, so ingestGhlDocuments (which reads the
// contact's upload fields) never saw them and the underwriter rated the deal off
// nothing.
//
// `scrapeInboundEmailDocsForDeal` is the bridge: for a merchant's GHL contact it
// walks the conversation's INBOUND email records, and for every email actually
// FROM that merchant (sender matched to customers.email / additional_emails,
// case-insensitive) it downloads the attachments into the SAME private
// `customer-documents` bucket, inserts matching `customer_documents` rows, content-
// classifies them, and writes ONE activity_log note per email on the open deal.
//
// Dedupe is two-layer, mirroring the call sweep + the form-upload bridge:
//   • ghl_email_doc_log (PK = GHL email-record id) — record-once ledger, claimed
//     BEFORE processing so overlapping sweeps / a future webhook can never double-
//     log or double-note the same email.
//   • customer_documents unique (customer_id, external_ref) — external_ref = the
//     attachment's stable id (the UUID in its URL), so the same attachment is never
//     stored twice even if the ledger were bypassed.
//
// Read-only against GHL. Never logs document contents — only counts, refs and types.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGhlConfig, ghlFetch, type GhlConfig } from "./ghl.ts";
import { DOC_BUCKET, contentTypeFor, docTypeFor } from "./ghlDocs.ts";
import { reconcileDocumentType } from "./docClassify.ts";

// Sender domains that are never a merchant emailing their own docs: our own
// sending domains and the lead-delivery / system providers. A robot lead-delivery
// mailbox (Synergy's Double-Verified sender, etc.) is a LEAD email, not merchant
// paperwork — and even if one slipped through, the sender would never match a
// merchant's on-file address. This is belt-and-suspenders on top of that match.
const EXCLUDED_SENDER_DOMAIN =
  /(^|\.)(mfunding\.net|send\.mfunding\.net|mfunding\.com|leadconnector(hq)?\.com|msgsndr\.com|usercontent\.site|vibereach\.io|synergydirect)/i;

// Inline images below this are almost always an email-signature logo, not a doc.
const MIN_INLINE_IMAGE_BYTES = 20 * 1024;
// Don't pull anything absurdly large into storage.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// Cap attachments processed per email (a forwarded statement bundle can be 25+).
const MAX_ATTACHMENTS_PER_EMAIL = 40;
// How many conversation messages back to scan per contact.
const MESSAGES_PER_CONV = 100;
// Content-classification concurrency. A merchant can forward 25+ statement PDFs in
// one email; firing 25 Haiku calls at once rate-limits (429) and — because
// classifyDocument swallows the throw as type=null — silently leaves every doc
// "other" and invisible to the underwriter. A small pool keeps us under the limit.
const CLASSIFY_CONCURRENCY = 3;
// A ledger row stuck in 'processing' this long is a crashed/timed-out run — allow
// the next sweep to re-claim and finish it rather than skipping the email forever.
const STALE_PROCESSING_MS = 15 * 60 * 1000;
// The marker every email-scraped customer_documents row carries.
const SCRAPE_DESCRIPTION = "Auto-scraped from the merchant's emailed attachment.";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with bounded concurrency (order-independent). */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Reconcile a doc's type by content, retrying ONCE on a transient classify miss
 * (a rate-limit / fetch / model hiccup surfaces as ran=false with an error). */
async function reconcileWithRetry(db: DB, documentId: string) {
  let oc = await reconcileDocumentType(db, { documentId, authority: "machine" });
  // Retry ONLY a genuinely transient miss (rate-limit / 5xx / network). A 400/401
  // (bad request, or "credit balance too low") and unsupported/oversize won't get
  // better on a retry, so don't waste the call.
  const err = oc.result?.error ?? "";
  const transient = !oc.ran && /(429|HTTP 5\d\d|timeout|fetch failed|network|ECONNRESET)/i.test(err);
  if (transient) {
    await delay(1200);
    oc = await reconcileDocumentType(db, { documentId, authority: "machine" });
  }
  return oc;
}

export interface EmailDocDeal {
  id: string;
  customerId: string;
  ghlContactId: string;
  /** Primary + additional merchant emails, already lower-cased by the caller. */
  emails: string[];
}

export interface EmailScrapeResult {
  /** Inbound merchant emails that yielded ≥1 newly-stored attachment. */
  emailsScraped: number;
  /** customer_documents rows created across all emails this run. */
  docsSynced: number;
  /** New bank statements (drives the underwrite re-run). */
  bankStatementsAdded: number;
  /** Attachments we tried but could not download/store. */
  failed: number;
  /** Email records looked at for the first time (claimed into the ledger). */
  emailsExamined: number;
  error: string | null;
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

/** Pull the bare email address out of a `From` header ("Name <a@b.com>", "<a@b.com>", "a@b.com"). */
function parseFromEmail(from: string): string | null {
  const m = String(from ?? "").match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return m ? m[0].trim().toLowerCase() : null;
}

/** The stable per-attachment ref (dedupe key): the last path segment sans extension. */
function attachmentRef(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const base = clean.substring(clean.lastIndexOf("/") + 1) || clean;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, 120);
}

function extOf(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const base = clean.substring(clean.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

type DB = SupabaseClient;

interface EmailRecord {
  id: string;
  direction?: string;
  from?: string;
  to?: string[];
  subject?: string;
  dateAdded?: string;
  attachments?: string[];
}

/** Collect the GHL email-RECORD ids in a contact's conversations (newest first). */
async function inboundEmailRecordIds(cfg: GhlConfig, contactId: string): Promise<string[]> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${encodeURIComponent(contactId)}&limit=20`,
  );
  if (!conv.ok) throw new Error(`conversations search failed (${conv.status})`);
  const convIds = (conv.data?.conversations ?? []).map((c) => c.id).filter(Boolean);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const cid of convIds) {
    const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
      cfg, "GET", `/conversations/${cid}/messages?limit=${MESSAGES_PER_CONV}`,
    );
    if (!msgs.ok) continue; // one bad thread must not blank the sweep
    for (const m of msgs.data?.messages?.messages ?? []) {
      if (!/email/i.test(String(m.messageType ?? ""))) continue;
      const recIds = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
      for (const rid of recIds) {
        const s = String(rid);
        if (s && !seen.has(s)) { seen.add(s); ids.push(s); }
      }
    }
  }
  return ids;
}

/**
 * Scrape every unseen INBOUND email from this merchant for attachments.
 * Never throws — returns a summary with `error` set on a top-level failure so the
 * sweep keeps going for the other deals. Caller fires the underwrite hook when
 * `bankStatementsAdded > 0`.
 */
export async function scrapeInboundEmailDocsForDeal(
  db: DB,
  deal: EmailDocDeal,
  cfg: GhlConfig,
): Promise<EmailScrapeResult> {
  const out: EmailScrapeResult = {
    emailsScraped: 0, docsSynced: 0, bankStatementsAdded: 0, failed: 0, emailsExamined: 0, error: null,
  };
  try {
    const rids = await inboundEmailRecordIds(cfg, deal.ghlContactId);
    if (!rids.length) return out;

    // Which of these have we already recorded? Skip re-fetching those records —
    // EXCEPT a row stuck in 'processing' past the stale window (a crashed run),
    // which we let through so it gets finished instead of being lost.
    const { data: seenRows } = await db.from("ghl_email_doc_log")
      .select("ghl_email_message_id, outcome, created_at").in("ghl_email_message_id", rids);
    const staleBefore = Date.now() - STALE_PROCESSING_MS;
    const seen = new Set(
      (seenRows ?? [])
        .filter((r: { outcome: string; created_at: string }) =>
          !(r.outcome === "processing" && new Date(r.created_at).getTime() < staleBefore))
        .map((r: { ghl_email_message_id: string }) => r.ghl_email_message_id),
    );
    const unseen = rids.filter((r) => !seen.has(r));
    if (!unseen.length) return out;

    // Pre-load this customer's existing attachment refs for cheap doc-level dedupe.
    const { data: existingDocs } = await db.from("customer_documents")
      .select("external_ref").eq("customer_id", deal.customerId).not("external_ref", "is", null);
    const have = new Set((existingDocs ?? []).map((r: { external_ref: string }) => r.external_ref));

    for (const rid of unseen) {
      // CLAIM-FIRST: insert the ledger row before doing any work. If another worker
      // (overlapping sweep / future webhook) already claimed it, ignoreDuplicates
      // returns no row and we skip — guaranteeing exactly one note per email.
      const { data: claim } = await db.from("ghl_email_doc_log").upsert({
        ghl_email_message_id: rid,
        deal_id: deal.id,
        customer_id: deal.customerId,
        ghl_contact_id: deal.ghlContactId,
        outcome: "processing",
      }, { onConflict: "ghl_email_message_id", ignoreDuplicates: true }).select("ghl_email_message_id");
      if (!claim || claim.length === 0) {
        // Row already exists. Re-claim ONLY a stale 'processing' row (crashed run):
        // the conditional UPDATE is atomic, so two overlapping sweeps can't both win.
        const { data: reclaim } = await db.from("ghl_email_doc_log")
          .update({ created_at: new Date().toISOString(), deal_id: deal.id, customer_id: deal.customerId, ghl_contact_id: deal.ghlContactId })
          .eq("ghl_email_message_id", rid).eq("outcome", "processing")
          .lt("created_at", new Date(staleBefore).toISOString())
          .select("ghl_email_message_id");
        if (!reclaim || reclaim.length === 0) continue; // genuinely done / freshly claimed elsewhere
      }
      out.emailsExamined++;

      const finalize = async (patch: Record<string, unknown>) => {
        await db.from("ghl_email_doc_log").update(patch).eq("ghl_email_message_id", rid);
      };

      let rec: EmailRecord | null = null;
      try {
        const r = await ghlFetch<{ emailMessage: EmailRecord }>(cfg, "GET", `/conversations/messages/email/${rid}`);
        rec = r.data?.emailMessage ?? null;
      } catch { /* handled below */ }
      if (!rec) { await finalize({ outcome: "error", detail: "could not fetch email record" }); continue; }

      const direction = String(rec.direction ?? "").toLowerCase();
      const fromEmail = parseFromEmail(rec.from ?? "");
      const basePatch = {
        direction, from_email: fromEmail,
        subject: (rec.subject ?? null)?.toString().slice(0, 300) ?? null,
        email_at: rec.dateAdded ?? null,
      };

      if (direction !== "inbound") { await finalize({ ...basePatch, outcome: "skipped_outbound" }); continue; }
      if (!fromEmail || !deal.emails.includes(fromEmail)) {
        await finalize({ ...basePatch, outcome: "skipped_not_merchant" }); continue;
      }
      const domain = fromEmail.split("@")[1] ?? "";
      if (EXCLUDED_SENDER_DOMAIN.test(domain)) {
        await finalize({ ...basePatch, outcome: "skipped_robot_domain" }); continue;
      }

      const attachments = Array.isArray(rec.attachments) ? rec.attachments.filter((u) => typeof u === "string" && u.startsWith("http")) : [];
      if (!attachments.length) { await finalize({ ...basePatch, outcome: "skipped_no_attachments", attachments_found: 0 }); continue; }

      // ── Download + store + insert each attachment ────────────────────────────
      let synced = 0, failed = 0, bankAdded = 0;
      const otherDocIds: string[] = [];
      const perDocType = new Map<string, string>(); // docId -> current type (updated after reconcile)
      const storedFilenames: string[] = [];

      for (const url of attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
        const ref = attachmentRef(url);
        if (!ref || have.has(ref)) continue; // already stored for this customer
        try {
          const bin = await fetch(url, { headers: { "User-Agent": "curl/8.4.0" } });
          if (!bin.ok) { failed++; console.warn(`[emailDocs] download ${bin.status} for ${ref}`); continue; }
          const bytes = new Uint8Array(await bin.arrayBuffer());
          if (!bytes.length) { failed++; continue; }
          if (bytes.length > MAX_ATTACHMENT_BYTES) { console.warn(`[emailDocs] ${ref} over size cap`); continue; }

          const headerCt = bin.headers.get("content-type")?.split(";")[0]?.trim();
          const ext = extOf(url);
          const isImage = (headerCt?.startsWith("image/") ?? false) || IMG_EXT.test(ext);
          // Drop tiny inline images (signature logos), never PDFs.
          if (isImage && bytes.length < MIN_INLINE_IMAGE_BYTES) continue;

          const filename = `email-${ref}${ext || ".pdf"}`;
          const ct = headerCt || contentTypeFor(filename);
          // Filename is an opaque UUID → docTypeFor almost always returns "other",
          // so CONTENT classification (below) is the authority — exactly the SIS
          // lesson. We deliberately do NOT type off the email subject: it describes
          // the whole email, not each file.
          const docType = docTypeFor(filename);
          const path = `customer/${deal.customerId}/email-${ref}`;
          const up = await db.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: ct, upsert: true });
          if (up.error) { failed++; console.warn(`[emailDocs] storage upload failed: ${up.error.message}`); continue; }

          const { data: insRow, error: insErr } = await db.from("customer_documents").insert({
            customer_id: deal.customerId,
            document_type: docType,
            filename,
            storage_path: path,
            file_size: bytes.length,
            mime_type: ct,
            status: "pending",
            external_ref: ref,
            description: "Auto-scraped from the merchant's emailed attachment.",
          }).select("id").maybeSingle();
          if (insErr) {
            if ((insErr as { code?: string }).code === "23505") { have.add(ref); continue; } // dedupe race — fine
            failed++; console.warn(`[emailDocs] customer_documents insert failed: ${insErr.message}`); continue;
          }
          have.add(ref);
          synced++;
          storedFilenames.push(filename);
          if (insRow?.id) { perDocType.set(insRow.id as string, docType); if (docType === "other") otherDocIds.push(insRow.id as string); }
          if (docType === "bank_statement") bankAdded++;
        } catch (e) {
          failed++;
          console.warn(`[emailDocs] attachment error for ${ref}: ${e instanceof Error ? e.message : e}`);
        }
      }

      // Content-classify the "other"-typed docs so a bank statement named after a
      // UUID never lands invisible to the underwriter. Bounded concurrency +
      // retry so a 25-attachment forward doesn't rate-limit itself into all-other.
      if (otherDocIds.length) {
        try {
          const outcomes = await mapPool(otherDocIds, CLASSIFY_CONCURRENCY, (id) => reconcileWithRetry(db, id));
          for (const oc of outcomes) {
            if (oc.changed && oc.to) {
              perDocType.set(oc.documentId, oc.to);
              if (oc.to === "bank_statement") bankAdded++;
            }
          }
        } catch (e) {
          console.warn(`[emailDocs] content reclassify failed: ${e instanceof Error ? e.message : e}`);
        }
      }

      out.failed += failed;
      if (synced === 0) {
        await finalize({ ...basePatch, outcome: "skipped_no_new_docs", attachments_found: attachments.length, docs_synced: 0 });
        continue;
      }

      // ── ONE activity_log note per email on the deal ──────────────────────────
      const typeCounts = new Map<string, number>();
      for (const t of perDocType.values()) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      const typeSummary = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
        .join(", ");
      const subject = `📎 ${synced} document(s) scraped from their email — ${typeSummary}`;
      try {
        await db.from("activity_log").insert({
          entity_type: "deal",
          entity_id: deal.id,
          interaction_type: "note",
          subject,
          content: JSON.stringify({
            source: "ghl-email-doc-sweep",
            email_record_id: rid,
            from: fromEmail,
            email_subject: rec.subject ?? null,
            attachments_found: attachments.length,
            docs_synced: synced,
            failed,
            bank_statements_added: bankAdded,
            filenames: storedFilenames,
            types: Object.fromEntries(typeCounts),
          }),
        });
      } catch (e) {
        console.warn(`[emailDocs] activity_log note failed: ${e instanceof Error ? e.message : e}`);
      }

      await finalize({
        ...basePatch, outcome: "scraped",
        attachments_found: attachments.length, docs_synced: synced, bank_statements_added: bankAdded,
      });
      out.emailsScraped++;
      out.docsSynced += synced;
      out.bankStatementsAdded += bankAdded;
    }
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}

export interface HealResult {
  checked: number;
  promoted: number;
  bankStatementsAdded: number;
  /** customer_ids whose docs gained a bank statement (caller re-underwrites these). */
  customersWithNewBank: string[];
  error: string | null;
  /** Diagnostic: the first doc's classify outcome (type/confidence/error). */
  sample?: unknown;
}

/**
 * Heal email-scraped docs still typed "other" — content-classify them so a
 * statement that a burst rate-limit (or any transient miss) left "other" becomes
 * visible to the underwriter. Idempotent and cheap once everything is verdicted
 * (an "other" that content also calls "other" simply stays put). Bounded
 * concurrency + retry, newest first. Secret-gated caller only.
 */
export async function healOtherEmailScrapedDocs(db: DB, limit = 200): Promise<HealResult> {
  const out: HealResult = { checked: 0, promoted: 0, bankStatementsAdded: 0, customersWithNewBank: [], error: null };
  try {
    const { data: docs, error } = await db.from("customer_documents")
      .select("id, customer_id")
      .eq("document_type", "other")
      .eq("description", SCRAPE_DESCRIPTION)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) { out.error = error.message; return out; }
    if (!docs?.length) return out;
    out.checked = docs.length;

    const bankCustomers = new Set<string>();
    const outcomes = await mapPool(
      docs as Array<{ id: string; customer_id: string }>,
      CLASSIFY_CONCURRENCY,
      async (d) => {
        const oc = await reconcileWithRetry(db, d.id);
        if (oc.changed && oc.to) {
          if (oc.to === "bank_statement") { out.bankStatementsAdded++; bankCustomers.add(d.customer_id); }
        }
        return oc;
      },
    );
    out.promoted = outcomes.filter((o) => o.changed).length;
    out.customersWithNewBank = [...bankCustomers];
    out.sample = { from: outcomes[0]?.from, to: outcomes[0]?.to, ran: outcomes[0]?.ran, result: outcomes[0]?.result };
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}

export { getGhlConfig };
