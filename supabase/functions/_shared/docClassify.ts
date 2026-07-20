// Content-based document classifier.
//
// WHY THIS EXISTS (the SIS Financial incident, 2026-07-15): a merchant uploaded
// 6 bank-statement PDFs from two accounts. Three were named
// "Business_Enhanced_Checking...4340_APR_2026.pdf" — no word "statement" — so the
// filename-only classifier (docTypeFor's bare /statement/ regex) typed them
// "other". underwrite-deal only analyzes document_type='bank_statement', so it
// rated the deal off HALF the merchant's banking and nobody noticed.
//
// The fix: read the document's FIRST PAGE with a cheap/fast vision model and let
// CONTENT decide the type, so a bank statement is a bank statement regardless of
// what the file is called. Filename rules (docTypeFor) stay as the instant first
// pass; this is the authority whenever the filename pass says "other" or the two
// disagree.
//
// MODEL CHOICE: Claude Haiku 4.5 (claude-haiku-4-5) — $1/1M input, $5/1M output,
// native PDF + image support. A 1-page classification is ~1-2k input tokens + a
// ~60-token tool call → well under $0.005/doc (see estimate in the return notes).
// It's the cheapest current Anthropic model that reliably reads a statement's
// first page; the extractor (Sonnet) is overkill for a 9-way label. Super-admins
// can override the model via llm_settings.task_overrides['doc_classify'] (provider
// must stay anthropic — document/image blocks are Anthropic-native, like the
// underwriter's extraction pass).
//
// SAFETY: never throws to the caller. A fetch/parse/model failure returns a result
// object with type=null + an error string, so classification can NEVER break an
// upload or an underwrite. Anything not in the DB enum collapses to "other".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropicBlocks } from "./llm.ts";

const DOC_BUCKET = "customer-documents";
const SIGNED_URL_TTL = 10 * 60; // 10 min — just long enough to fetch the bytes.
const MAX_BYTES = 15 * 1024 * 1024; // skip anything over 15MB (with a warn).
const DEFAULT_CLASSIFY_MODEL = "claude-haiku-4-5";

// The DB enum (customer_document_type), verified against the live DB. Do NOT invent
// values — a bad value fails the customer_documents update. Anything the model
// returns that isn't in here collapses to "other".
export const DOC_ENUM = [
  "bank_statement", "application", "tax_return", "id", "business_license",
  "voided_check", "credit_authorization", "personal_guarantee", "other",
] as const;
export type DocType = (typeof DOC_ENUM)[number];

export interface ClassifyResult {
  /** Enum-safe type, or null when classification could not run (see `error`). */
  type: DocType | null;
  confidence: number; // 0-1; 0 when type is null
  evidence: string; // one short sentence, or the reason it couldn't run
  bank_hint: { account_last4: string | null; statement_month: string | null } | null;
  error?: string; // set when type is null (unsupported mime, fetch/model failure, size cap)
  model?: string; // the model that produced the classification (for cost accounting)
}

function nullResult(evidence: string, error: string): ClassifyResult {
  return { type: null, confidence: 0, evidence, bank_hint: null, error };
}

// Base64-encode bytes without blowing the call stack on large files (chunked) —
// mirrors underwrite-deal's helper.
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Which Anthropic content-block do we send? PDFs → document block; images → image
// block. Everything else (docx/xlsx/csv/…) has no native block, so we can't
// content-classify it — the filename pass stands.
function blockKindFor(filename: string, mime: string | null | undefined): { kind: "pdf" } | { kind: "image"; media: string } | null {
  const m = (mime || "").toLowerCase();
  const n = filename.toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return { kind: "pdf" };
  if (m.includes("png") || n.endsWith(".png")) return { kind: "image", media: "image/png" };
  if (m.includes("jpeg") || m.includes("jpg") || /\.jpe?g$/.test(n)) return { kind: "image", media: "image/jpeg" };
  if (m.includes("webp") || n.endsWith(".webp")) return { kind: "image", media: "image/webp" };
  if (m.includes("gif") || n.endsWith(".gif")) return { kind: "image", media: "image/gif" };
  return null;
}

const CLASSIFY_TOOL = {
  name: "classify_document",
  description: "Report the single best document-type classification for this document.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...DOC_ENUM],
        description: "The one document type that best fits, judged primarily from the FIRST PAGE.",
      },
      confidence: { type: "number", description: "0.0-1.0 confidence in the type." },
      evidence: { type: "string", description: "ONE short sentence naming what on the first page proves the type." },
      account_last4: { type: ["string", "null"], description: "Bank statements only: last 4 digits of the account number, else null." },
      statement_month: { type: ["string", "null"], description: "Bank statements only: the statement period, e.g. 'April 2026', else null." },
    },
    required: ["type", "confidence", "evidence"],
  },
};

const CLASSIFY_SYSTEM =
  "You classify a single business-funding document for an MCA (merchant cash advance) back office. " +
  "Look PRIMARILY at the FIRST PAGE and pick the ONE type that best fits, from EXACTLY this set: " +
  "bank_statement | application | tax_return | id | business_license | voided_check | credit_authorization | personal_guarantee | other.\n" +
  "Definitions:\n" +
  "- bank_statement: a bank/credit-union account statement — shows an account number, a statement period, and a table of deposits/withdrawals with a beginning and ending balance. This is the most common and most important type; a 'Business Enhanced Checking' or 'Statement' page IS a bank_statement even if the word 'statement' is absent.\n" +
  "- application: a funding/credit application or merchant intake form (business + owner fields, amount requested, signature line).\n" +
  "- tax_return: an IRS return or schedule (1040, 1120, Schedule C, etc.).\n" +
  "- id: a government photo ID — driver's license, state ID, or passport.\n" +
  "- business_license: articles of incorporation/organization, an EIN letter, a business/occupational license, or similar formation/registration document.\n" +
  "- voided_check: a single check image marked VOID (or a bank letter / account-detail page standing in for one).\n" +
  "- credit_authorization: a signed authorization to pull credit / a background or credit-check consent.\n" +
  "- personal_guarantee: a personal-guaranty agreement making the owner personally liable.\n" +
  "- other: anything that clearly fits none of the above.\n" +
  "Be decisive but honest: set a lower confidence when the first page is ambiguous. " +
  "For a bank_statement, also return the account's last 4 digits and the statement month when visible (else null). " +
  "Call the classify_document tool with your answer; do not also write prose.";

/**
 * Fetch a stored document's bytes and classify it by content. Never throws.
 */
export async function classifyDocument(
  db: SupabaseClient,
  input: { storagePath: string; filename: string; mimeType?: string | null; fileSize?: number | null },
): Promise<ClassifyResult> {
  const filename = input.filename || "document";
  try {
    if (input.fileSize != null && input.fileSize > MAX_BYTES) {
      console.warn(`[docClassify] skipping ${filename} — ${input.fileSize} bytes over ${MAX_BYTES} cap`);
      return nullResult("File is too large to classify by content.", "over size cap");
    }
    const block = blockKindFor(filename, input.mimeType);
    if (!block) {
      return nullResult("File type is not a PDF or image — cannot read its first page.", "unsupported mime");
    }

    const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrl(input.storagePath, SIGNED_URL_TTL);
    const url = signed?.signedUrl;
    if (!url) return nullResult("Could not access the stored file.", "could not sign URL");

    const bin = await fetch(url);
    if (!bin.ok) return nullResult("Could not download the stored file.", `fetch ${bin.status}`);
    const bytes = new Uint8Array(await bin.arrayBuffer());
    if (!bytes.length) return nullResult("Stored file was empty.", "empty file");
    if (bytes.length > MAX_BYTES) return nullResult("File is too large to classify by content.", "over size cap");
    const b64 = base64FromBytes(bytes);

    // Model: default to the cheap tier (Haiku). Only an EXPLICIT per-task override
    // (llm_settings.task_overrides['doc_classify']) changes it — we deliberately do
    // NOT inherit the global active model (which is Sonnet), since a 9-way first-page
    // label doesn't need it and Sonnet is ~3x the cost. The override must stay on
    // provider "anthropic" — document/image blocks are Anthropic-native.
    let model = DEFAULT_CLASSIFY_MODEL;
    try {
      const { data } = await db.from("llm_settings").select("task_overrides").eq("id", 1).maybeSingle();
      const ov = (data?.task_overrides as Record<string, { provider?: string; model?: string }> | null | undefined)?.["doc_classify"];
      if (ov?.provider === "anthropic" && ov?.model) model = ov.model;
    } catch { /* use default */ }

    const contentBlock = block.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: block.media, data: b64 } };

    const text = await callAnthropicBlocks(
      db,
      model,
      [
        contentBlock,
        { type: "text", text: "Classify this document per your instructions and call the classify_document tool." },
      ],
      {
        system: CLASSIFY_SYSTEM,
        maxTokens: 512,
        temperature: 0,
        jsonMode: true,
        tools: [CLASSIFY_TOOL],
        toolChoice: { type: "tool", name: "classify_document" },
      },
    );

    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); } catch {
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { /* ignore */ } }
    }
    if (!parsed) return nullResult("Model returned an unparseable classification.", "parse failure");

    const rawType = String(parsed.type ?? "").trim();
    const type: DocType = (DOC_ENUM as readonly string[]).includes(rawType) ? (rawType as DocType) : "other";
    const confRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0;
    const evidence = typeof parsed.evidence === "string" && parsed.evidence.trim()
      ? parsed.evidence.trim().slice(0, 300)
      : "First page reviewed.";
    const last4 = parsed.account_last4 != null ? String(parsed.account_last4).replace(/\D/g, "").slice(-4) || null : null;
    const stmtMonth = parsed.statement_month != null && String(parsed.statement_month).trim()
      ? String(parsed.statement_month).trim().slice(0, 40) : null;
    const bank_hint = type === "bank_statement" ? { account_last4: last4, statement_month: stmtMonth } : null;

    return { type, confidence, evidence, bank_hint, model };
  } catch (e) {
    return nullResult("Content classification failed.", e instanceof Error ? e.message : String(e));
  }
}

export interface ReconcileOutcome {
  documentId: string;
  ran: boolean; // did content classification actually run?
  changed: boolean; // did we update document_type?
  from: string | null;
  to: string | null;
  result: ClassifyResult | null;
}

// Confidence floor below which we won't act on a disagreement (agreement/other-fill
// still act). Tuned conservative: a low-confidence content read never overrides a
// specific machine type, and never logs noise against a human's pick.
const DISAGREE_CONFIDENCE = 0.6;

/**
 * Classify a customer_documents row and reconcile its document_type.
 *
 * Policy:
 *  - authority 'machine' (filename/field/portal-derived types): CONTENT WINS when the
 *    current type is 'other', or when content disagrees with confidence ≥ 0.6.
 *    UPDATEs document_type and logs an activity_log note on the customer.
 *  - authority 'human' (an ops user explicitly picked the type in the admin dropdown):
 *    NEVER overwritten. If content disagrees (conf ≥ 0.6), logs the disagreement so a
 *    human can eyeball it — the type is left as the human set it.
 *
 * Never throws. Best-effort logging (a log failure never fails the reconcile).
 */
export async function reconcileDocumentType(
  db: SupabaseClient,
  opts: { documentId: string; authority?: "machine" | "human" },
): Promise<ReconcileOutcome> {
  const authority = opts.authority ?? "machine";
  const out: ReconcileOutcome = { documentId: opts.documentId, ran: false, changed: false, from: null, to: null, result: null };
  try {
    const { data: doc } = await db
      .from("customer_documents")
      .select("id, customer_id, document_type, filename, storage_path, mime_type, file_size")
      .eq("id", opts.documentId)
      .maybeSingle();
    if (!doc) return out;

    const currentType = (doc.document_type as string) ?? "other";
    out.from = currentType;
    out.to = currentType;

    const result = await classifyDocument(db, {
      storagePath: doc.storage_path as string,
      filename: (doc.filename as string) ?? "document",
      mimeType: (doc.mime_type as string) ?? null,
      fileSize: (doc.file_size as number) ?? null,
    });
    out.result = result;
    out.ran = result.type != null;
    if (result.type == null) return out; // couldn't classify — leave the type alone.

    // Persist the verdict on the row itself so the admin "What is this?" view (the
    // Deal Documents modal) can show the classified type + one-sentence evidence
    // without re-running the model, and so "Analyze all" can tell which docs still
    // lack a verdict (classification IS NULL). Best-effort — a write failure here
    // never blocks the type reconcile below. This runs for BOTH authorities: even
    // when a human's specific pick is kept, the content read is worth showing.
    await db
      .from("customer_documents")
      .update({
        classification: {
          type: result.type,
          confidence: result.confidence,
          evidence: result.evidence,
          bank_hint: result.bank_hint,
          model: result.model ?? null,
          authority,
          classified_at: new Date().toISOString(),
        },
      })
      .eq("id", opts.documentId);

    const contentType = result.type;
    const agrees = contentType === currentType;
    const filename = (doc.filename as string) ?? "document";
    const customerId = doc.customer_id as string;

    // A SPECIFIC human-picked type is authoritative — never silently overwritten.
    // ("other" is not a real classification, it's "unspecified" — so it still gets
    // filled by content below, even on a human upload.)
    if (authority === "human" && currentType !== "other") {
      if (!agrees && result.confidence >= DISAGREE_CONFIDENCE) {
        await logNote(
          db, customerId,
          `Doc type check: "${filename}" is kept as ops-selected "${currentType}", but content looks like "${contentType}" (${Math.round(result.confidence * 100)}% — ${result.evidence}). Verify if unexpected.`,
        );
      }
      return out;
    }

    // Machine-derived type (or an unspecified "other" from any source). Correct
    // 'other', or a confident disagreement.
    const shouldChange = (currentType === "other" && contentType !== "other") ||
      (!agrees && result.confidence >= DISAGREE_CONFIDENCE);
    if (!shouldChange) return out;

    const { error: upErr } = await db
      .from("customer_documents")
      .update({ document_type: contentType })
      .eq("id", opts.documentId);
    if (upErr) {
      console.warn(`[docClassify] update document_type failed for ${opts.documentId}: ${upErr.message}`);
      return out;
    }
    out.changed = true;
    out.to = contentType;
    await logNote(db, customerId, `Auto-classified ${filename} as ${contentType} (was ${currentType}) — ${result.evidence}`);
    return out;
  } catch (e) {
    console.warn(`[docClassify] reconcile error for ${opts.documentId}: ${e instanceof Error ? e.message : e}`);
    return out;
  }
}

/** Best-effort activity_log note against a customer (interaction_type 'note' —
 * the only value the check constraint reliably allows for a system-written row). */
async function logNote(db: SupabaseClient, customerId: string, content: string): Promise<void> {
  try {
    const { error } = await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: customerId,
      interaction_type: "note",
      subject: "doc:auto-classify",
      content,
    });
    if (error) console.warn(`[docClassify] activity_log insert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[docClassify] activity_log threw: ${e instanceof Error ? e.message : e}`);
  }
}
