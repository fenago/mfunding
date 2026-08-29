// Shared types + display helpers for the JMP.chat SMS line.
//
// ONE consumer number (+1 786 504-1159) bridged through XMPP into
// public.sms_messages. Both SMS screens — the staff inbox (/admin/text-messages)
// and the super-admin ops view (/admin/text-messages/admin) — read the same
// table and speak the same vocabulary, so the vocabulary lives here.
//
// This is deliberately NOT the TextMagic path used inside the playbook
// (TextMerchantPanel → `textmagic-send`). Different carrier, different number,
// different table. Don't merge them.

import supabase from "@/supabase";

export type SmsDirection = "inbound" | "outbound";
export type SmsStatus = "received" | "queued" | "sending" | "sent" | "failed";

export interface SmsMessage {
  id: string;
  direction: SmsDirection;
  phone: string;
  body: string | null;
  media_url: string | null;
  status: SmsStatus;
  error: string | null;
  customer_id: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  /** Soft-delete markers (super-admin only, reversible). A row with deleted_at
   *  set is hidden from the inbox and dropped from the unread count; the row is
   *  retained for TCPA/compliance. The inbox query filters deleted_at IS NULL,
   *  so these are effectively always null on rows the page holds. */
  deleted_at?: string | null;
  deleted_by?: string | null;
}

/** How a merchant reads as a name once their customer row resolves.
 *  A merchant can have BOTH a business name ("Acme Corp") and a person name
 *  ("Khalil Lyons"); the inbox shows both when both exist. `label` is the
 *  combined string used for the search filter and the single-line fallback. */
export interface SmsContact {
  customerId: string | null;
  business: string | null;
  person: string | null;
  label: string;
  doNotContact: boolean;
}

/** Split a customer row into its business and person names, plus a combined
 *  `label` for search / single-line display. Both null → "Unnamed contact". */
export function customerNames(c: {
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): { business: string | null; person: string | null; label: string } {
  const business = c.business_name?.trim() || null;
  const person =
    [c.first_name, c.last_name]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join(" ")
      .trim() || null;
  const label = [business, person].filter(Boolean).join(" · ") || "Unnamed contact";
  return { business, person, label };
}

/** Chip styling per delivery status. Failed is the only red — it's the only one
 *  that means a merchant did NOT get the message. */
export const STATUS_CHIP: Record<SmsStatus, string> = {
  received: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  queued: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  sending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export const STATUS_LABEL: Record<SmsStatus, string> = {
  received: "received",
  queued: "queued",
  sending: "sending",
  sent: "sent ✓",
  failed: "failed",
};

/** +18435551234 → (843) 555-1234. Anything we can't parse prints as-is —
 *  never destroy a number we don't recognise. */
export function prettyPhone(e164: string): string {
  const d = (e164 || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return e164;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Every spelling of a phone we might have stored a customer under, so a
 *  best-effort name lookup by phone finds the row that customer_id missed. */
export function phoneVariants(e164: string): string[] {
  const d = (e164 || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return [e164];
  return [`+1${ten}`, `1${ten}`, ten, `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`];
}

/** Carrier-standard opt-out keywords. An inbound message that opens with one of
 *  these is a STOP — the merchant must be flipped to do_not_contact. */
const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt-out"];
const STOP_RE = new RegExp(`^\\s*(${STOP_WORDS.join("|")})\\b`, "i");

export function isOptOut(body: string | null): boolean {
  return !!body && STOP_RE.test(body);
}

/** Short relative time for the conversation list ("4m", "3h", "Tue"). */
export function shortWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Picture messages (MMS) ───────────────────────────────────────────────────
// Outbound media is uploaded to a dedicated PUBLIC Supabase bucket so the JMP/
// Cheogram gateway can fetch it over plain HTTPS and transcode it into an MMS.
// sms-send validates the URL is an object in exactly this bucket before queueing.

/** The dedicated public bucket for outbound SMS/MMS media. */
export const SMS_MEDIA_BUCKET = "sms-media";

/** Client-side upload ceiling. Mirrors the bucket's file_size_limit (10MB). MMS
 *  carriers transcode down hard, so this is a generous upper bound, not a target. */
export const SMS_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** Image types the bucket accepts (must stay in sync with allowed_mime_types). */
export const SMS_MEDIA_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** `accept` attribute for the file input. */
export const SMS_MEDIA_ACCEPT = SMS_MEDIA_MIME.join(",");

/** A collision-resistant object path for an outbound image. Grouped by date so
 *  the bucket stays browsable; the random suffix avoids clobbering. */
export function smsMediaObjectPath(fileName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rand = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const ext = (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `outbound/${yyyy}/${mm}/${rand}${ext ? `.${ext}` : ""}`;
}

/** Human-readable reason a file can't be sent as a picture message, or null. */
export function smsMediaRejectReason(file: File): string | null {
  if (!(SMS_MEDIA_MIME as readonly string[]).includes(file.type)) {
    return "Only images can be attached (JPG, PNG, GIF, WebP, HEIC).";
  }
  if (file.size > SMS_MEDIA_MAX_BYTES) {
    return `That image is ${(file.size / 1_048_576).toFixed(1)}MB — the limit is 10MB.`;
  }
  return null;
}

// ── Document links (secure, unauthenticated HTTPS — NOT MMS) ─────────────────
// MMS can't reliably carry a PDF/Word/Excel doc, so "attach a document" on the
// SMS composers is a different path from a picture message: upload the file to a
// dedicated PUBLIC bucket, then drop a shareable HTTPS link into the message BODY.
// It sends as ordinary text through sms-send (no media_url), and a merchant with
// no login taps the link to open the file. See migration 20260829n_sms_docs_bucket.

/** The dedicated public bucket for outbound merchant-shared documents. */
export const SMS_DOCS_BUCKET = "sms-docs";

/** Client-side upload ceiling. Mirrors the bucket's file_size_limit (15MB). */
export const SMS_DOCS_MAX_BYTES = 15 * 1024 * 1024;

/** File extensions we accept for a texted document, mapped to the content-type
 *  the bucket's allowed_mime_types will accept. file.type is unreliable for Office
 *  docs and CSVs (browsers report it blank or as an Excel alias), so we key off
 *  the extension and pass a KNOWN-GOOD content-type on upload — otherwise the
 *  bucket would reject an application/octet-stream the browser handed us. Keep
 *  this in sync with allowed_mime_types in the migration. */
export const SMS_DOCS_EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** `accept` attribute for the document file input — extension-based, because
 *  file.type is unreliable for the very formats we most want (docx/xlsx/csv). */
export const SMS_DOCS_ACCEPT = Object.keys(SMS_DOCS_EXT_MIME)
  .map((ext) => `.${ext}`)
  .join(",");

/** Lowercased, sanitized extension of a filename (no dot), or "". */
export function smsDocFileExt(fileName: string): string {
  return (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The content-type to store a document under — always a value the bucket allows,
 *  derived from the extension rather than the browser's unreliable file.type. */
export function smsDocContentType(fileName: string): string {
  return SMS_DOCS_EXT_MIME[smsDocFileExt(fileName)] ?? "application/octet-stream";
}

/** An UNGUESSABLE object key for a shared document. The link is unauthenticated,
 *  so the key IS the access control: two UUIDs (64 hex chars) make it impossible
 *  to enumerate. Grouped by month so the bucket stays browsable; the extension is
 *  preserved so the merchant's browser opens the file with the right handler. */
export function smsDocsObjectPath(fileName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const a = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const b = crypto.randomUUID?.() ?? `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  const rand = `${a}${b}`.replace(/-/g, "");
  const ext = smsDocFileExt(fileName);
  return `outbound/${yyyy}/${mm}/${rand}${ext ? `.${ext}` : ""}`;
}

/** Human-readable reason a file can't be shared as a document link, or null. */
export function smsDocsRejectReason(file: File): string | null {
  const ext = smsDocFileExt(file.name);
  if (!ext || !(ext in SMS_DOCS_EXT_MIME)) {
    return "Attach a PDF, Word, Excel, CSV, text, or image file.";
  }
  if (file.size > SMS_DOCS_MAX_BYTES) {
    return `That file is ${(file.size / 1_048_576).toFixed(1)}MB — the limit is 15MB.`;
  }
  return null;
}

/** A document attached to a composer: its display name and its public link. */
export interface SmsDocAttachment {
  name: string;
  url: string;
}

/** Upload a document to the public sms-docs bucket and return its public URL.
 *  Validates first (returns the reason on a rejected file). Used by BOTH SMS
 *  composers so the upload + public-URL logic lives in exactly one place. The
 *  returned URL is meant to be inserted into the message BODY as plain text — it
 *  is NOT an MMS media_url and must not be passed as one. */
export async function uploadSmsDoc(
  file: File,
): Promise<{ url: string; name: string } | { error: string }> {
  const reason = smsDocsRejectReason(file);
  if (reason) return { error: reason };
  const path = smsDocsObjectPath(file.name);
  const { error: upErr } = await supabase.storage
    .from(SMS_DOCS_BUCKET)
    .upload(path, file, {
      contentType: smsDocContentType(file.name),
      upsert: false,
    });
  if (upErr) return { error: `Upload failed — nothing was attached. ${upErr.message}` };
  const { data: pub } = supabase.storage.from(SMS_DOCS_BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl ?? null;
  if (!url) return { error: "The file uploaded but its public link couldn't be resolved." };
  return { url, name: file.name };
}

/** The JMP account this line runs on — static reference, straight from the
 *  setup guide. Shown on the ops page so nobody has to hunt for it mid-outage. */
export const JMP_ACCOUNT = {
  number: "+1 (786) 504-1159",
  jid: "mfunding@xmpp.chat",
  gateway: "cheogram.com",
  statusUrl: "https://status.jmp.chat",
} as const;
