// documentIndex — the EVIDENCE side of "was an application actually sent?",
// kept current rather than merely complete.
//
// ── THE BUG THIS FILE EXISTS TO FIX ─────────────────────────────────────────
// The first version of this index was refreshed by a nightly crawl that recorded
// `complete = true` when its fetch count reached GHL's reported total. That flag
// answers the wrong question. It proves the crawl read everything THAT EXISTED
// WHEN IT RAN. It says nothing about whether the index is CURRENT — and
// "never sent" is a claim about NOW.
//
// Measured, on the merchant the check was built for: the crawl finished at
// 20:46:37Z having read 282 of 282, complete and honest. Joyce Derian's 04B MCA
// PREFILL was created at 20:46:57Z and her disclosure at 20:46:59Z — twenty
// seconds later. The location held 284. A surface reading the check in that
// window would have printed "never sent" about a merchant whose application had
// just gone out, which is the same sentence, about the same merchant, that the
// check was written to prevent.
//
// A nightly index cannot support a present-tense negative. Every send is
// invisible until the next crawl, and that window is exactly when a setter or the
// owner looks at a freshly-sent deal.
//
// ── THE FIX IS TO STOP RELYING ON THE NIGHTLY ───────────────────────────────
// ghl-docs-status ALREADY crawls the entire location document list on every
// staff or portal read — it has to, because /proposals/document has no
// per-contact filter. That crawl is already paid for. So it writes what it saw
// into this index, and the index becomes as fresh as the last time anybody looked
// at anything (minutes, in practice) instead of as fresh as 07:35 this morning.
// The nightly ?full=1 crawl stays as the proof-of-completeness pass.
//
// Both callers go through THIS function so the two can never drift — the
// _shared/ghlCallSync.ts "change one, change both" warning is a bug waiting on a
// calendar, and the signature path already learned that lesson once today.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The GHL document shape both callers already hold. */
export interface IndexableDoc {
  _id?: string;
  documentId?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  recipients?: Array<{ id?: string; entityName?: string; email?: string }>;
}

export interface IndexOutcome {
  /** Recipient rows written (documents x their contact recipients). */
  rows: number;
  /** True when a completeness receipt was recorded for this crawl. */
  receipted: boolean;
  error: string | null;
}

/**
 * Record ONE document we just caused to exist, the moment we send it.
 *
 * A crawl-fed index is only ever as fresh as the last crawl, and the case that
 * matters most for a stacking guard is the merchant who clicks twice: the second
 * click must see the document the first click created, whatever the index's age.
 * So a send writes its own row rather than waiting to be discovered.
 *
 * NO CRAWL RECEIPT is written here, deliberately. This is one document, not a
 * read of the set — recording it as a crawl would tell the checks that the whole
 * index had just been refreshed, which is exactly the false completeness they
 * exist to refuse.
 */
export async function recordSentDocument(
  db: SupabaseClient,
  doc: {
    documentId: string;
    contactId: string;
    docName: string;
    docStatus?: string | null;
    recipientEmail?: string | null;
    docCreatedAt?: string | null;
  },
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await db.from("ghl_document_recipients").upsert({
    document_id: doc.documentId,
    contact_id: doc.contactId,
    recipient_email: (doc.recipientEmail ?? "").trim().toLowerCase() || null,
    doc_name: doc.docName,
    doc_status: doc.docStatus ?? "sent",
    doc_created_at: doc.docCreatedAt ?? new Date().toISOString(),
    seen_at: new Date().toISOString(),
  }, { onConflict: "document_id,contact_id" });
  return { ok: !error, error: error?.message ?? null };
}

/**
 * Write what a crawl saw into ghl_document_recipients, and — ONLY for a crawl
 * that provably read the whole set — record the receipt that lets
 * application_claims_vs_evidence() speak about absence at all.
 *
 * `complete` must mean "fetched reached the reported total". Passing true for a
 * partial read is the failure this whole subsystem is about: it converts our own
 * short read into a confident claim that a merchant was never sent anything.
 */
export async function indexDocumentRecipients(
  db: SupabaseClient,
  docs: IndexableDoc[],
  meta: {
    complete: boolean;
    reportedTotal: number | null;
    error: string | null;
    /** Who crawled — for the receipt trail. */
    via: string;
  },
): Promise<IndexOutcome> {
  const out: IndexOutcome = { rows: 0, receipted: false, error: null };

  const seenAt = new Date().toISOString();
  const rows = docs.flatMap((d) => {
    const documentId = d._id ?? d.documentId;
    if (!documentId) return [];
    return (d.recipients ?? [])
      // A staff countersigner (entityName "users") is not a merchant recipient
      // and must never become a contact id that can only ever fail to resolve.
      .filter((r) => !!r.id && (r.entityName ?? "contacts") === "contacts")
      .map((r) => ({
        document_id: documentId,
        contact_id: r.id as string,
        recipient_email: (r.email ?? "").trim().toLowerCase() || null,
        doc_name: d.name ?? "Document",
        doc_status: d.status ?? null,
        doc_created_at: d.createdAt ?? null,
        seen_at: seenAt,
      }));
  });

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db
      .from("ghl_document_recipients")
      .upsert(chunk, { onConflict: "document_id,contact_id" });
    if (error) {
      out.error = `document index upsert failed: ${error.message}`;
      return out;
    }
    out.rows += chunk.length;
  }

  // THE RECEIPT IS WHAT LICENSES A NEGATIVE. An index with no receipt, or with a
  // short one, means the check reports 'unknown_unreadable' rather than
  // 'never_sent' — so writing a receipt for an incomplete crawl would be handing
  // the check permission it has not earned.
  const { error: recErr } = await db.from("ghl_document_crawls").insert({
    complete: meta.complete,
    fetched: docs.length,
    reported_total: meta.reportedTotal,
    error: meta.error ?? (meta.complete ? null : `partial crawl via ${meta.via}`),
  });
  if (recErr) {
    out.error = `crawl receipt failed: ${recErr.message}`;
    return out;
  }
  out.receipted = true;
  return out;
}
