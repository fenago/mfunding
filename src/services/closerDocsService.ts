// closerDocsService — the data layer for Closer Onboarding & Documents.
//
// RLS does the real enforcement (see supabase/migrations/20260711_closer_documents_tracker.sql
// and 20260711_closer_docs_merge_esign.sql):
//   • admin / super_admin  → manage every closer's tracker row
//   • closer               → SELECT only their OWN rows; they cannot mark their
//                            own paperwork signed by writing to the table. The
//                            only way a row flips to 'signed' is the
//                            sign_closer_document() RPC, which verifies the caller
//                            owns the closer row and captures IP + user-agent
//                            server-side.
// The UI mirrors those rules, but the database is what actually enforces them.

import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";

export type DocStatus = "not_sent" | "sent" | "signed" | "na";

export interface CloserDocumentRow {
  id: string;
  closer_id: string;
  doc_slug: string;
  status: DocStatus;
  signed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  file_url: string | null;
  merged_content: string | null;
  merged_sha256: string | null;
  template_version: number | null;
}

export interface CloserDocTemplate {
  slug: string;
  title: string;
  body_md: string;
  version: number;
  esignable: boolean;
  sort_order: number;
}

export interface SignatureRow {
  id: string;
  closer_id: string;
  doc_slug: string;
  signer_name: string;
  consent_text: string;
  content_sha256: string;
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  not_sent: "Not sent",
  sent: "Sent — awaiting signature",
  signed: "Signed",
  na: "N/A",
};

export const STATUS_BADGE: Record<DocStatus, string> = {
  not_sent: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  sent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  signed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  na: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
};

export const STATUS_DOT: Record<DocStatus, string> = {
  not_sent: "bg-gray-300 dark:bg-gray-600",
  sent: "bg-amber-500",
  signed: "bg-mint-green",
  na: "bg-gray-300 dark:bg-gray-600",
};

/** Templates (staff-readable). Used for the admin preview of an unsent merge. */
export async function getDocTemplates(): Promise<CloserDocTemplate[]> {
  const { data, error } = await supabase
    .from("closer_doc_templates")
    .select("slug, title, body_md, version, esignable, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CloserDocTemplate[];
}

/**
 * The body of a REFERENCE document held in closer_doc_templates (the Comp Offer
 * Sheet). Not bundled: RLS decides whether the caller receives the text, so a
 * setter gets zero rows here even on a hand-rolled PostgREST call.
 *
 * Three outcomes, kept distinct on purpose — "the server refused me" must never
 * be indistinguishable from "there is nothing there":
 *   { body }        → the text
 *   { body: null }  → no row visible to this viewer (RLS, or unknown slug)
 *   { error }       → the read FAILED; the caller must say so, not render blank
 */
export async function getReferenceDocBody(
  slug: string,
): Promise<{ body: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("closer_doc_templates")
    .select("body_md")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return { body: null, error: error.message };
  return { body: (data?.body_md as string | undefined) ?? null, error: null };
}

/** Every tracker row. RLS narrows this to the caller's own rows for a closer. */
export async function getCloserDocuments(closerId?: string): Promise<CloserDocumentRow[]> {
  let q = supabase
    .from("closer_documents")
    .select(
      "id, closer_id, doc_slug, status, signed_at, sent_at, notes, file_url, merged_content, merged_sha256, template_version",
    );
  if (closerId) q = q.eq("closer_id", closerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CloserDocumentRow[];
}

/** The closers row belonging to the signed-in user, if any. */
export async function getMyCloser(): Promise<{ id: string; first_name: string; last_name: string } | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("closers")
    .select("id, first_name, last_name")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) return null;
  return data as { id: string; first_name: string; last_name: string } | null;
}

export async function getSignatures(closerId?: string): Promise<SignatureRow[]> {
  let q = supabase
    .from("closer_document_signatures")
    .select("id, closer_id, doc_slug, signer_name, consent_text, content_sha256, signed_at, ip_address, user_agent")
    .order("signed_at", { ascending: false });
  if (closerId) q = q.eq("closer_id", closerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SignatureRow[];
}

// --- Company merge settings ------------------------------------------------
// These live in platform_settings under the "closer_docs" key, alongside the
// lead-assignment strategy. Re-exported here so the docs pages have one import.
export {
  getCloserDocSettings as getMergeSettings,
  saveCloserDocSettings as saveMergeSettings,
  DEFAULT_CLOSER_DOC_SETTINGS,
} from "@/services/platformService";

// --- Admin actions ---------------------------------------------------------

/**
 * Manually set a tracker status. This is for the docs that are NOT e-signed
 * (W-9, direct deposit, licensing, the .docx agreement) — the owner records that
 * he collected them. It cannot be used to fake an e-signature: 'signed' on an
 * e-signable doc only ever comes from the sign_closer_document() RPC, which
 * writes a signature-ledger row alongside it.
 */
export async function setDocStatus(
  closerId: string,
  slug: string,
  status: DocStatus,
  patch?: { notes?: string | null; file_url?: string | null },
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  await mustWrite(
    "update closer document status",
    supabase
      .from("closer_documents")
      .update({
        status,
        signed_at: status === "signed" ? new Date().toISOString() : null,
        recorded_by: auth?.user?.id ?? null,
        ...(patch ?? {}),
      })
      .eq("closer_id", closerId)
      .eq("doc_slug", slug),
  );
}

export interface SendPackageResult {
  ok: boolean;
  to?: string;
  sent?: { slug: string; title: string; sha256: string }[];
  /** Set when the send was refused because documents still had unfilled fields. */
  blocked?: { slug: string; title: string; missing: { token: string; label: string; fix: string }[] }[];
  error?: string;
}

/**
 * Merge + freeze + email the onboarding package. Server-side; if any selected
 * document still has an unresolved placeholder, NOTHING is sent and `blocked`
 * comes back listing exactly what to fix.
 */
export async function sendOnboardingPackage(
  closerId: string,
  slugs: string[],
): Promise<SendPackageResult> {
  const { data, error } = await supabase.functions.invoke("send-closer-onboarding-package", {
    body: { closerId, slugs },
  });

  // supabase-js throws away the response body on non-2xx, so dig it back out —
  // the 422 "here's what's missing" payload is the whole point of the call.
  if (error) {
    let parsed: SendPackageResult | null = null;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { parsed = await ctx.json(); } catch { /* not JSON */ }
    }
    if (parsed?.blocked?.length) return { ok: false, blocked: parsed.blocked, error: parsed.error };
    return { ok: false, error: parsed?.error ?? error.message };
  }
  return { ...(data as SendPackageResult), ok: true };
}

// --- Materialize a single doc (self-service W-8BEN) ------------------------

export interface MaterializeResult {
  ok: boolean;
  /** Absolute URL to read + sign; the UI links to the in-app route instead. */
  signUrl?: string;
  slug?: string;
  alreadySigned?: boolean;
  sha256?: string;
  /** Set when required profile fields are still blank — nothing was prepared. */
  blocked?: { slug: string; title: string; missing: { token: string; label: string; fix: string }[] }[];
  error?: string;
}

/**
 * Merge + freeze ONE e-signable document for the signed-in contractor (or, for an
 * admin, a given closerId) and return where to sign it. Built for the substitute
 * W-8BEN self-service flow. If required profile fields are blank the server
 * BLOCKS and returns `blocked` with exactly what to fill in first.
 */
export async function materializeMyDoc(
  slug: string,
  closerId?: string,
): Promise<MaterializeResult> {
  const { data, error } = await supabase.functions.invoke("materialize-closer-doc", {
    body: closerId ? { slug, closerId } : { slug },
  });
  // supabase-js discards the body on non-2xx — dig the 422 "what's missing" out.
  if (error) {
    let parsed: MaterializeResult | null = null;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { parsed = await ctx.json(); } catch { /* not JSON */ }
    }
    if (parsed?.blocked?.length) return { ok: false, blocked: parsed.blocked, error: parsed.error };
    return { ok: false, error: parsed?.error ?? error.message };
  }
  return { ...(data as MaterializeResult), ok: true };
}

// --- Signing ---------------------------------------------------------------

export const CONSENT_TEXT =
  "I have read this document in full and I agree to be bound by it. I intend my typed name below to be my legal electronic signature.";

/**
 * Sign the document. The signer types their full legal name and ticks consent;
 * the RPC records the name, the consent sentence, a snapshot + SHA-256 of the
 * exact content they agreed to, the timestamp, and their IP + user-agent (taken
 * from the request headers server-side, not from the browser).
 */
export async function signDocument(slug: string, signerName: string): Promise<SignatureRow> {
  const { data, error } = await supabase.rpc("sign_closer_document", {
    p_doc_slug: slug,
    p_signer_name: signerName,
    p_consent_text: CONSENT_TEXT,
  });
  if (error) throw new Error(error.message);
  return data as SignatureRow;
}
