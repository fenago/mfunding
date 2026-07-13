// Shared GHL → Supabase document bridge.
//
// Merchants upload their paperwork through the GHL secure-upload form, so the
// files live on the GHL CONTACT (as FILE_UPLOAD custom-field values), not in our
// storage. Anything in the app that reads `customer_documents` (most importantly
// the AI underwriter, which needs the bank-statement PDFs) therefore saw NOTHING
// for a real merchant, even though the playbook's doc checklist (which reads GHL
// directly) showed the files as received.
//
// `ingestGhlDocuments` is the bridge: it pulls the contact's uploaded files from
// GHL, stores the bytes in the SAME private `customer-documents` bucket the portal
// upload writes to, and inserts matching `customer_documents` rows.
//
// Idempotent: every row carries `external_ref` = the GHL file's uuid, and the DB
// has a unique index on (customer_id, external_ref) — re-running never duplicates
// a document (a duplicate-key insert is counted as "skipped", not an error).
//
// Read-only against GHL. Never logs document contents — only counts, filenames
// and types.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGhlConfig, ghlFetch } from "./ghl.ts";

export const DOC_BUCKET = "customer-documents";

/** MIME type from the filename (GHL's meta.mimetype is preferred when present). */
export function contentTypeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Map the GHL upload field name + filename → our `customer_document_type` enum.
// The enum (verified in the DB) is: bank_statement | application | tax_return |
// id | business_license | voided_check | credit_authorization | personal_guarantee
// | other. Do NOT invent values — a bad value fails the insert.
export function docTypeFor(s: string): string {
  const n = s.toLowerCase();
  if (/statement/.test(n)) return "bank_statement";
  if (/applica/.test(n)) return "application";
  if (/void|cheque|\bcheck\b/.test(n)) return "voided_check";
  if (/tax\s*return|1120|1040|schedule\s*c/.test(n)) return "tax_return";
  if (/business licen|articles|incorporat|ein letter/.test(n)) return "business_license";
  if (/driver|licen|passport|photo id|\bid\b/.test(n)) return "id";
  return "other";
}

export interface IngestedDoc {
  filename: string;
  document_type: string;
  external_ref: string;
}

export interface IngestResult {
  /** Files found on the GHL contact's upload fields. */
  found: number;
  /** New customer_documents rows created by this run. */
  synced: number;
  /** Files already on file (same external_ref) — the idempotency path. */
  skipped: number;
  /** New bank statements specifically (drives the underwriter re-run). */
  bankStatementsAdded: number;
  /** Files we found but could not download/store (transient GHL/storage errors). */
  failed: number;
  documents: IngestedDoc[];
}

/**
 * Pull every file the merchant uploaded to their GHL contact into Supabase
 * storage + `customer_documents`. Safe to call repeatedly.
 */
export async function ingestGhlDocuments(
  db: SupabaseClient,
  customerId: string,
  ghlContactId: string,
  opts: { limit?: number } = {},
): Promise<IngestResult> {
  const limit = opts.limit ?? 25;
  const out: IngestResult = {
    found: 0, synced: 0, skipped: 0, bankStatementsAdded: 0, failed: 0, documents: [],
  };

  const cfg = await getGhlConfig(db);

  const res = await ghlFetch<{ contact?: { customFields?: Array<{ id: string; value: unknown }> } }>(
    cfg, "GET", `/contacts/${ghlContactId}`,
  );
  if (!res.ok) throw new Error(`GHL contact fetch failed (${res.status}): ${res.error ?? ""}`);
  const fields = res.data?.contact?.customFields ?? [];

  // Field id → field name ("MCA Bank Statements", "MCA Stips Documents", …) so a
  // generically-named file (image.jpg) still gets typed by the field it came from.
  const defs = await ghlFetch<{ customFields?: Array<{ id: string; name: string }> }>(
    cfg, "GET", `/locations/${cfg.locationId}/customFields`,
  );
  const fieldName: Record<string, string> = {};
  for (const fd of (defs.data?.customFields ?? [])) fieldName[fd.id] = fd.name;

  // GHL shape: value = { <uuid>: { meta: { originalname, mimetype, size }, url } }
  const files: Array<{ ref: string; name: string; url: string; hint: string; mime?: string }> = [];
  for (const f of fields) {
    const v = f.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const hint = fieldName[f.id] ?? "";
    for (const [ref, entry] of Object.entries(v as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const meta = (e.meta ?? {}) as Record<string, unknown>;
      const url = String(e.url ?? "");
      const name = String(meta.originalname ?? meta.name ?? e.name ?? `${ref}.pdf`).trim();
      const mime = typeof meta.mimetype === "string" ? (meta.mimetype as string) : undefined;
      if (url.startsWith("http")) files.push({ ref, name, url, hint, mime });
    }
  }
  out.found = files.length;
  if (!files.length) return out;

  const { data: existingDocs, error: exErr } = await db
    .from("customer_documents")
    .select("external_ref")
    .eq("customer_id", customerId)
    .not("external_ref", "is", null);
  if (exErr) throw new Error(`could not read existing documents: ${exErr.message}`);
  const have = new Set((existingDocs ?? []).map((r: { external_ref: string }) => r.external_ref));

  for (const file of files.slice(0, limit)) {
    if (have.has(file.ref)) { out.skipped++; continue; }
    try {
      // The Authorization header is dropped on GHL's cross-origin redirect to its
      // storage host (expected) — the signed redirect target serves the bytes.
      const bin = await fetch(file.url, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Version: "2021-07-28" },
      });
      if (!bin.ok) { out.failed++; console.warn(`[ghlDocs] download ${bin.status} for ${file.name}`); continue; }
      const bytes = new Uint8Array(await bin.arrayBuffer());
      if (!bytes.length) { out.failed++; continue; }

      const ct = file.mime || contentTypeFor(file.name);
      const docType = docTypeFor(`${file.hint} ${file.name}`);
      const slug = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "upload";
      // Path convention: `customer/<uuid>/…`. Both `customer/<uuid>/..` and
      // `<uuid>/..` exist in this bucket and the RLS policies resolve the owner via
      // storage_path_customer_id(), which handles BOTH — never assume foldername[1].
      const path = `customer/${customerId}/${file.ref}-${slug}`;
      const up = await db.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: ct, upsert: true });
      if (up.error) { out.failed++; console.warn(`[ghlDocs] storage upload failed: ${up.error.message}`); continue; }

      const { error: insErr } = await db.from("customer_documents").insert({
        customer_id: customerId,
        document_type: docType,
        filename: file.name,
        storage_path: path,
        file_size: bytes.length,
        mime_type: ct,
        status: "pending",
        external_ref: file.ref,
        description: "Auto-synced from the merchant's GHL upload.",
      });
      if (insErr) {
        // 23505 = the unique (customer_id, external_ref) index — another run beat us
        // to it. That IS the idempotency guarantee working, not a failure.
        if ((insErr as { code?: string }).code === "23505") { out.skipped++; continue; }
        out.failed++;
        console.warn(`[ghlDocs] customer_documents insert failed: ${insErr.message}`);
        continue;
      }
      out.synced++;
      out.documents.push({ filename: file.name, document_type: docType, external_ref: file.ref });
      if (docType === "bank_statement") out.bankStatementsAdded++;
    } catch (e) {
      out.failed++;
      console.warn(`[ghlDocs] ingest error for ${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return out;
}

/** Resolve the GHL contact id behind a customer (null when unlinked). */
export async function ghlContactIdForCustomer(
  db: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data } = await db
    .from("customers")
    .select("ghl_contact_id")
    .eq("id", customerId)
    .maybeSingle();
  return (data?.ghl_contact_id as string | null) ?? null;
}
