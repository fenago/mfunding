// ghlDocCompletions — ONE definition of "a merchant signed a document", shared by
// the hourly sweep (ghl-doc-sweep) and the push hook (ghl-event-hook?type=document).
//
// ── WHY THIS IS A SHARED MODULE AND NOT A SECOND COPY ────────────────────────
// _shared/ghlCallSync.ts is a hand-copy of ghl-call-history's internals, and its
// own header carries a standing warning: change one, change both. That warning
// is a bug waiting on a calendar. The signature path gets the other treatment —
// the sweep and the hook call the SAME functions, so a row written by the push
// and a row written by the poll are the same row by construction, not by
// vigilance.
//
// ── WHAT THE GHL PROPOSALS API SUPPORTS (probed live 2026-09-18) ─────────────
//   GET /proposals/document?locationId=…&status=completed&limit=21[&skip=N]
//   limit                     caps at 21 (422 above)
//   skip=N                    works — the completed set is fully walkable
//   status=completed          works — 268 documents total, 41 completed
//   query=<text>              WORKS, and is the ONLY targeted filter there is:
//                             it matches the document name AND the recipient's
//                             NAME (query=Badia -> his 2 signatures). It does
//                             NOT match the recipient's email (0 results).
//   contactId= / recipientId= / documentId= / _id= / offset= / page= / search=
//                             all REJECTED, "property should not exist".
//   GET /proposals/document/<id>  401 — not in this token's scope.
//
// So there is no way to fetch ONE document by its id. Both callers therefore read
// the same bounded, newest-first list; the hook just reads fewer pages of it.
//
// ── THE IDENTITY HALF, WHICH IS WHERE THE SIGNATURES WERE ACTUALLY GOING ─────
// Resolving a signature by `customers.ghl_contact_id` alone loses every document
// filed against a merchant's OTHER GHL contact. Measured live 2026-09-18: GHL
// held 41 completed documents, our table held 35, and all 6 missing rows were
// signatures by a contact id no customer row pointed at — including a merchant
// who signed an APPLICATION on 2026-07-08 that the app never saw, and Miami
// Concierge Network's two signatures from this morning, the ones the owner was
// on the phone about. So we resolve through public.customer_ids_for_ghl(), which
// takes contact ids AND recipient emails; the email half costs nothing extra
// because the document crawl already prints each recipient's address.
//
// ⚠ THE RECIPIENT'S CONTACT ID IS `recipients[].id`, WITH `entityName ==
//   "contacts"`. There is no `recipients[].contactId` — reading that gets you
//   undefined and a document that matches nobody.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type GhlConfig, ghlFetch } from "./ghl.ts";
import { recordMerchantContacts } from "./merchantIdentity.ts";

/** GHL caps the proposals list at 21 per page (422 above it). */
export const DOC_PAGE = 21;

/**
 * A completion we only just learned about may be months old. Announcing those on
 * a deal timeline would be noise about history, so the side effects fire only for
 * a genuinely fresh signature. Shared so the hook and the sweep agree on "fresh".
 */
export const SIDE_EFFECT_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface DocRecipient {
  id?: string;
  entityName?: string;
  email?: string;
  hasCompleted?: boolean;
  signedDate?: string;
}

export interface ProposalDoc {
  _id?: string;
  documentId?: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  recipients?: DocRecipient[];
}

export interface Completion {
  documentId: string;
  docName: string;
  /** recipients[].id — a GHL CONTACT id, not a user id (entityName is checked). */
  contactId: string;
  /** The signer's address as GHL recorded it. Free — it came with the crawl. */
  recipientEmail: string | null;
  /** The merchant's REAL signature time, not when we noticed. */
  signedAt: string | null;
}

export interface CrawlResult {
  docs: ProposalDoc[];
  /** GHL's own count of completed documents, or null if it never said. */
  reportedTotal: number | null;
  ghlCalls: number;
  /**
   * TRUE only when we read the WHOLE completed set. A partial read (page cap hit,
   * or a deliberately shallow hook crawl) is false, and a caller must not turn a
   * false into "this merchant has not signed" — that is the failure-reads-as-
   * success trap this codebase has paid for repeatedly.
   */
  complete: boolean;
  /** Non-null means a page was UNREADABLE, which is neither empty nor complete. */
  error: string | null;
  /**
   * The location's remaining daily GHL quota, off the LAST response's headers.
   * NULL means the header was UNREADABLE — which is not the same as plenty and
   * not the same as none; a caller that gates on budget must say which it got.
   */
  dailyRemaining: number | null;
}

/**
 * Read completed documents newest-first.
 *
 * `maxPages` is the whole difference between the two callers: the sweep passes a
 * number large enough to reach `total` (a complete read, which is what earns the
 * right to stamp "checked"), the hook passes a small one (a fast, bounded read of
 * the newest signatures, which is all a just-fired event can be about).
 */
export async function crawlCompletedDocs(
  cfg: GhlConfig,
  opts: { maxPages: number },
): Promise<CrawlResult> {
  const out: CrawlResult = { docs: [], reportedTotal: null, ghlCalls: 0, complete: false, error: null, dailyRemaining: null };

  for (let page = 0; page < opts.maxPages; page++) {
    const res = await ghlFetch<{ documents?: ProposalDoc[]; total?: number }>(
      cfg,
      "GET",
      `/proposals/document?locationId=${cfg.locationId}&limit=${DOC_PAGE}&skip=${page * DOC_PAGE}&status=completed`,
    );
    out.ghlCalls++;
    if (res.rate?.dailyRemaining != null) out.dailyRemaining = res.rate.dailyRemaining;
    if (!res.ok) {
      // UNREADABLE. Keep what we already have — a signature we can see is still
      // worth recording — but the crawl is not complete, so absence proves nothing.
      out.error = `documents page ${page} failed (${res.status}): ${res.error ?? ""}`;
      return out;
    }
    const got = res.data?.documents ?? [];
    if (typeof res.data?.total === "number") out.reportedTotal = res.data.total;
    out.docs.push(...got);
    if (got.length === 0) { out.complete = true; return out; }
    if (out.reportedTotal !== null && out.docs.length >= out.reportedTotal) { out.complete = true; return out; }
  }

  // Ran out of pages before reaching `total`. Deliberate for the hook, a fault
  // for the sweep — either way it is NOT a complete read and says so.
  return out;
}

/** One row per COMPLETED CONTACT RECIPIENT. A staff countersigner (entityName
 *  "users") is not a merchant signature and is dropped here rather than
 *  surviving as an id that can never map to a customer. */
export function flattenCompletions(docs: ProposalDoc[]): Completion[] {
  return docs.flatMap((d) => {
    const documentId = d._id ?? d.documentId ?? null;
    if (!documentId) return [];
    return (d.recipients ?? [])
      .filter((r) => r.hasCompleted === true && !!r.id && (r.entityName ?? "contacts") === "contacts")
      .map((r) => ({
        documentId,
        docName: d.name ?? "Document",
        contactId: r.id as string,
        recipientEmail: (r.email ?? "").trim().toLowerCase() || null,
        // Falls back to the document's updatedAt only if GHL omits signedDate
        // (all 41 live rows carry it).
        signedAt: r.signedDate ?? d.updatedAt ?? null,
      }));
  });
}

export interface UnresolvedCompletion {
  documentId: string;
  docName: string;
  contactId: string;
  recipientEmail: string | null;
  reason: string;
}

export interface FreshSignature {
  customerId: string;
  businessName: string;
  docName: string;
  signedAt: string | null;
  documentId: string;
  isApplication: boolean;
}

export interface RecordOutcome {
  /** Rows this call inserted. Only these produce side effects. */
  recorded: number;
  /** Pre-existing rows whose signed_at was missing and is now filled in. */
  backfilled: number;
  /** Rows another writer (the sweep, or a concurrent hook) inserted first. */
  alreadyPresent: number;
  /** Signatures we could not attach to a merchant — NEVER silently dropped. */
  unresolved: UnresolvedCompletion[];
  /** Contact ids appended to a merchant's identity set as a result of a signature. */
  aliasesAdded: string[];
  fresh: FreshSignature[];
  timelineNotes: number;
  checklistTicks: number;
  /** Non-null means the resolve step itself failed: nothing below it is trustworthy. */
  error: string | null;
}

const EMPTY_OUTCOME = (): RecordOutcome => ({
  recorded: 0, backfilled: 0, alreadyPresent: 0, unresolved: [], aliasesAdded: [],
  fresh: [], timelineNotes: 0, checklistTicks: 0, error: null,
});

/**
 * Resolve each completion to a merchant and upsert it into ghl_doc_completions.
 *
 * IDEMPOTENT BY CONSTRUCTION. document_id is the table's primary key, so the
 * sweep and the hook cannot produce two rows for one signature no matter who
 * arrives first or whether they arrive at the same instant: the loser of the race
 * gets a 23505 and counts it as `alreadyPresent`, not as an error and not as a
 * fresh signature. Side effects therefore fire exactly once per signature, by
 * whichever path saw it first — which is the entire point of running both.
 */
export async function recordCompletions(
  db: SupabaseClient,
  completions: Completion[],
  opts: { via: string; sideEffectWindowMs?: number },
): Promise<RecordOutcome> {
  const out = EMPTY_OUTCOME();
  if (completions.length === 0) return out;
  const windowMs = opts.sideEffectWindowMs ?? SIDE_EFFECT_WINDOW_MS;

  // ── Resolve merchants in ONE query, by contact id AND by recipient email.
  // The email half is what finds a signature filed against a contact our tables
  // have never stored; it costs nothing, since the crawl already fetched it.
  const contactIds = [...new Set(completions.map((c) => c.contactId))];
  const emails = [...new Set(completions.map((c) => c.recipientEmail).filter((e): e is string => !!e))];

  const byContact = new Map<string, { id: string; businessName: string | null }>();
  const byEmail = new Map<string, { id: string; businessName: string | null }>();
  const ambiguous = new Set<string>();

  const { data: hits, error: resolveErr } = await db.rpc("customer_ids_for_ghl", {
    p_contact_ids: contactIds,
    p_emails: emails,
  });
  if (resolveErr) {
    // The resolve step is load-bearing: without it every signature would look
    // unattributable, which is exactly the lie we are here to stop telling.
    out.error = `customer_ids_for_ghl failed: ${resolveErr.message}`;
    return out;
  }
  for (const h of (hits ?? []) as Array<{ key: string; kind: string; customer_id: string; business_name: string | null }>) {
    const target = h.kind === "contact" ? byContact : byEmail;
    const prior = target.get(h.key);
    if (prior && prior.id !== h.customer_id) {
      // One identifier, two merchants (one owner, several businesses). Refusing
      // to guess is the point — filing a signature under the wrong merchant is
      // worse than leaving it unfiled, and `unresolved` makes it visible.
      ambiguous.add(`${h.kind}:${h.key}`);
      continue;
    }
    target.set(h.key, { id: h.customer_id, businessName: h.business_name });
  }
  for (const k of ambiguous) {
    const [kind, key] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    (kind === "contact" ? byContact : byEmail).delete(key);
  }

  // Contact ids we only learned about because a document was signed against them.
  const aliasByCustomer = new Map<string, Set<string>>();

  for (const c of completions) {
    const cust = byContact.get(c.contactId)
      ?? (c.recipientEmail ? byEmail.get(c.recipientEmail) : undefined);

    if (!cust) {
      out.unresolved.push({
        documentId: c.documentId,
        docName: c.docName,
        contactId: c.contactId,
        recipientEmail: c.recipientEmail,
        reason: ambiguous.has(`contact:${c.contactId}`) || (c.recipientEmail && ambiguous.has(`email:${c.recipientEmail}`))
          ? "identifier maps to more than one merchant — refused to guess"
          : "no merchant on file for this signer",
      });
      continue;
    }

    // The signature itself is evidence that this contact belongs to this
    // merchant. Append it (never clobber the primary pointer) so the NEXT read
    // of this merchant already knows where their documents live.
    if (!byContact.has(c.contactId)) {
      if (!aliasByCustomer.has(cust.id)) aliasByCustomer.set(cust.id, new Set());
      aliasByCustomer.get(cust.id)!.add(c.contactId);
    }

    const { error: insErr } = await db.from("ghl_doc_completions").insert({
      document_id: c.documentId,
      customer_id: cust.id,
      doc_name: c.docName,
      signed_at: c.signedAt,
    });

    if (insErr) {
      if (insErr.code !== "23505") {
        console.warn(`[${opts.via}] completion insert failed for ${c.documentId}:`, insErr.message);
        continue;
      }
      // Someone else recorded this signature. Fill in signed_at if the older row
      // predates that column, and do NOT re-fire side effects.
      out.alreadyPresent++;
      if (c.signedAt) {
        const { data: existing } = await db
          .from("ghl_doc_completions").select("signed_at").eq("document_id", c.documentId).maybeSingle();
        if (existing && !existing.signed_at) {
          const { error: upErr } = await db
            .from("ghl_doc_completions").update({ signed_at: c.signedAt }).eq("document_id", c.documentId);
          if (upErr) console.warn(`[${opts.via}] signed_at backfill failed:`, upErr.message);
          else out.backfilled++;
        }
      }
      continue;
    }

    out.recorded++;

    const signedMs = c.signedAt ? Date.parse(c.signedAt) : NaN;
    if (Number.isFinite(signedMs) && Date.now() - signedMs <= windowMs) {
      out.fresh.push({
        customerId: cust.id,
        businessName: cust.businessName ?? "The merchant",
        docName: c.docName,
        signedAt: c.signedAt,
        documentId: c.documentId,
        isApplication: false, // decided by the DB below — never by a guess here
      });
    }
  }

  // ── Persist newly-learned contact ids (best-effort; never breaks a recording).
  for (const [customerId, ids] of aliasByCustomer) {
    const { added, error } = await recordMerchantContacts(db, customerId, [...ids]);
    if (error) console.warn(`[${opts.via}] alias record failed for ${customerId}:`, error);
    else out.aliasesAdded.push(...added);
  }

  // ── Side effects for genuinely fresh signatures. Each is isolated: none of
  //    them may break the recording that already succeeded.
  for (const s of out.fresh) {
    // Ask the DATABASE whether this is the APPLICATION. One definition, shared
    // with every reader. "MCA — Broker Compensation Disclosure" is a separate
    // document and must never tick the application box.
    const { data: isApp, error: isAppErr } = await db.rpc("is_application_doc_name", { p_name: s.docName });
    if (isAppErr) console.warn(`[${opts.via}] doc-name classify failed:`, isAppErr.message);
    else s.isApplication = isApp === true;

    const { data: deal } = await db
      .from("deals").select("id").eq("customer_id", s.customerId)
      .neq("status", "declined").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const dealId = deal?.id as string | undefined;
    if (!dealId) continue;

    // 'note' is the only interaction_type the activity_log check constraint
    // allows for a system event; anything else is silently rejected.
    const { error: logErr } = await db.from("activity_log").insert({
      entity_type: "deal",
      entity_id: dealId,
      interaction_type: "note",
      subject: `merchant:signed — ${s.docName}`,
      content: `${s.businessName} signed "${s.docName}" (${opts.via}).`,
    });
    if (logErr) console.warn(`[${opts.via}] activity_log skipped:`, logErr.message);
    else out.timelineNotes++;

    if (s.isApplication) {
      const { error: tickErr } = await db.rpc("ghl_mark_checklist_key", { p_deal_id: dealId, p_key: "application" });
      if (tickErr) console.warn(`[${opts.via}] checklist tick skipped:`, tickErr.message);
      else out.checklistTicks++;
    }
  }

  return out;
}
