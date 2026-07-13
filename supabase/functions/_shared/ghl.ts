// Shared GoHighLevel (LeadConnector API v2) client for Supabase edge functions.
//
// Credentials are NEVER hardcoded. They are read from the Supabase vault via the
// `public.get_ghl_config()` SECURITY DEFINER RPC, using the service-role client.
// This keeps the GHL Private Integration Token server-side only.
//
// Targets the MFunding sub-account (location set in the vault as GHL_LOCATION_ID).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface GhlConfig {
  apiKey: string;
  locationId: string;
}

/** Service-role Supabase client (full DB access, bypasses RLS). */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Load GHL credentials from the vault via the service-role-only RPC. */
export async function getGhlConfig(db: SupabaseClient): Promise<GhlConfig> {
  const { data, error } = await db.rpc("get_ghl_config");
  if (error) throw new Error(`get_ghl_config failed: ${error.message}`);
  const apiKey = data?.api_key as string | undefined;
  const locationId = data?.location_id as string | undefined;
  if (!apiKey || !locationId) {
    throw new Error("GHL credentials missing from vault (GHL_API_KEY / GHL_LOCATION_ID)");
  }
  return { apiKey, locationId };
}

export interface GhlResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/** PII / secret keys that must never reach a log line. */
const REDACT_KEYS = new Set([
  "ssn", "socialsecuritynumber", "social_security_number",
  "bankaccount", "bank_account", "bankaccountnumber", "bank_account_number",
  "routing", "routingnumber", "bank_routing_number",
  "apikey", "api_key", "authorization", "token", "password",
]);

/** Deep-copy a request body with secrets/PII replaced by "[redacted]" and long
 * HTML bodies truncated, so a failed call can be logged safely. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…[+${value.length - 500} chars]` : value;
  if (typeof value !== "object") return value;
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 60).map((v) => redactForLog(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase().replace(/[^a-z_]/g, "")) ? "[redacted]" : redactForLog(v, depth + 1);
  }
  return out;
}

/** Authenticated request against the LeadConnector API.
 *
 * OBSERVABILITY: every non-2xx is logged server-side with the endpoint, the
 * request payload (secrets/PII redacted), the HTTP status and GHL's FULL
 * response body. A GHL failure must never leave nothing to look at — the
 * K.L. Breen 400 ("Contact's email is invalid") could not be reconstructed from
 * the logs because this function used to swallow everything but the return value.
 */
export async function ghlFetch<T = unknown>(
  cfg: GhlConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<GhlResponse<T>> {
  const res = await fetch(`${GHL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Version: GHL_API_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    console.error("[ghl] REQUEST FAILED", JSON.stringify({
      endpoint: `${method} ${path}`,
      status: res.status,
      request: body === undefined ? null : redactForLog(body),
      response: typeof parsed === "string" ? parsed.slice(0, 2000) : parsed,
    }));
  }
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (parsed as T) : null,
    error: res.ok ? undefined : (typeof parsed === "string" ? parsed : JSON.stringify(parsed)),
  };
}

/** Pull the human message out of a GHL error body (which is usually
 * {"statusCode":400,"message":"…","error":"Bad Request"} JSON-stringified). */
export function ghlErrorMessage(err: string | undefined): string {
  if (!err) return "unknown error";
  try {
    const o = JSON.parse(err) as { message?: unknown };
    const m = o?.message;
    if (typeof m === "string") return m;
    if (Array.isArray(m)) return m.map(String).join("; ");
  } catch { /* not JSON */ }
  return err;
}

// ---- Contact helpers ---------------------------------------------------------

export interface ContactInput {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  website?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tags?: string[];
  source?: string | null;
  /** GHL custom fields by field key (e.g. "business_name") — these are what
   * Documents & Contracts "linked fields" pre-fill from. */
  customFields?: { key: string; field_value: unknown }[];
}

/**
 * Upsert a contact. GHL's /contacts/upsert dedupes by email/phone within the
 * location and returns the contact (new or existing) with its id.
 */
export async function upsertContact(cfg: GhlConfig, input: ContactInput) {
  const payload: Record<string, unknown> = { locationId: cfg.locationId };
  for (const [k, v] of Object.entries(input)) {
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) payload[k] = v;
  }
  return await ghlFetch<{ contact: { id: string } }>(cfg, "POST", "/contacts/upsert", payload);
}

export async function getContact(cfg: GhlConfig, contactId: string) {
  return await ghlFetch<{ contact: Record<string, unknown> }>(cfg, "GET", `/contacts/${contactId}`);
}

export interface EnsuredContact {
  /** The contact id that actually owns `email` — may differ from the one passed in. */
  contactId: string | null;
  /** true when we had to upsert/re-point because the stored contact was wrong. */
  healed: boolean;
  /** What the stored contact carried before we touched it (for the audit trail). */
  previousEmail: string | null;
  /** Why the send can't proceed (contactId is null when this is set). */
  error?: string;
}

/**
 * PRE-FLIGHT + SELF-HEAL for any GHL send.
 *
 * GHL rejects a send with 400 "Contact's email is invalid" when the CONTACT it is
 * sending to has no/!valid email — which happens when our stored ghl_contact_id
 * points at a duplicate, emailless or deleted contact, even though the merchant's
 * email in Supabase is perfectly fine. So before we send: read the target contact,
 * confirm it carries a usable email, and if it doesn't, upsert BY EMAIL (GHL
 * dedupes on it) and hand back whichever contact actually owns the address. This
 * is the same guarantee push-application-to-ghl gets by always upserting by email.
 *
 * Callers should persist a healed contactId back onto customers/deals.
 */
export async function ensureContactEmail(
  cfg: GhlConfig,
  contactId: string | null,
  desiredEmail: string,
  profile?: Omit<ContactInput, "email">,
): Promise<EnsuredContact> {
  const valid = (e: unknown): e is string =>
    typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  if (!valid(desiredEmail)) {
    return { contactId: null, healed: false, previousEmail: null, error: `"${desiredEmail}" is not a valid email address` };
  }

  let previousEmail: string | null = null;
  if (contactId) {
    const got = await getContact(cfg, contactId);
    const onFile = (got.data?.contact as { email?: unknown } | undefined)?.email;
    previousEmail = typeof onFile === "string" ? onFile : null;
    // Healthy: the linked contact exists and already carries a valid email that
    // matches ours (case-insensitive). Send against it, unchanged.
    if (got.ok && valid(previousEmail) && previousEmail.trim().toLowerCase() === desiredEmail.trim().toLowerCase()) {
      return { contactId, healed: false, previousEmail };
    }
    console.warn("[ghl] contact pre-flight: linked contact is unusable, healing", JSON.stringify({
      contactId, fetch_ok: got.ok, status: got.status,
      contact_email: previousEmail, expected_email: desiredEmail,
    }));
  }

  // Heal: upsert by email. Returns the canonical contact that owns this address
  // (creating it if there isn't one) and guarantees the address is on the record.
  const up = await upsertContact(cfg, { ...(profile ?? {}), email: desiredEmail });
  const healedId = up.data?.contact?.id ?? null;
  if (!healedId) {
    return {
      contactId: null, healed: false, previousEmail,
      error: `GHL would not accept a contact for ${desiredEmail}: ${ghlErrorMessage(up.error)}`,
    };
  }
  return { contactId: healedId, healed: healedId !== contactId, previousEmail };
}

// ---- FILE_UPLOAD custom fields (merchant-uploaded docs live GHL-side) ---------

export interface GhlUploadedFile { name: string; url: string | null }
export interface GhlUploadField { field: string; files: GhlUploadedFile[] }

/**
 * Enumerate the files sitting on a contact's FILE_UPLOAD custom fields (e.g. the
 * "Bank Statements & Documents Upload" form). Returns one entry per populated
 * FILE_UPLOAD field with its friendly name and each file's original name + a
 * download URL. The URLs are public leadconnectorhq.com/documents/download/{id}
 * links (they 307-redirect to a short-lived signed GCS URL), so they can be
 * handed to a funder or fetched server-side without an auth header.
 */
export async function listContactFileUploads(
  cfg: GhlConfig,
  contactId: string,
): Promise<GhlUploadField[]> {
  const fieldsRes = await ghlFetch<{ customFields?: { id: string; name: string; dataType: string }[] }>(
    cfg, "GET", `/locations/${cfg.locationId}/customFields`,
  );
  const fileFieldNames = new Map(
    (fieldsRes.data?.customFields ?? [])
      .filter((f) => f.dataType === "FILE_UPLOAD")
      .map((f) => [f.id, f.name]),
  );

  const contactRes = await getContact(cfg, contactId);
  const cf = ((contactRes.data?.contact as Record<string, unknown> | undefined)?.customFields ??
    []) as { id: string; value: unknown }[];

  const out: GhlUploadField[] = [];
  for (const f of cf) {
    if (!fileFieldNames.has(f.id) || !f.value || typeof f.value !== "object") continue;
    const files = Object.values(f.value as Record<string, Record<string, unknown>>).map((v) => {
      const meta = (v?.meta ?? {}) as Record<string, unknown>;
      return {
        name: String(meta.originalname ?? "file"),
        url: typeof v?.url === "string" ? (v.url as string) : null,
      };
    });
    if (files.length) out.push({ field: fileFieldNames.get(f.id)!, files });
  }
  return out;
}

// ---- Business (company) helpers — groups contacts into a business hierarchy --

export interface BusinessInput {
  name: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/** List the location's GHL Businesses (companies). Used to find one by name
 * before creating a duplicate. Returns { businesses: [{ id, name, website }] }. */
export async function listBusinesses(cfg: GhlConfig) {
  return await ghlFetch<{ businesses: Array<{ id: string; name: string; website?: string | null }> }>(
    cfg, "GET", `/businesses/?locationId=${cfg.locationId}`,
  );
}

/** Create a GHL Business (company) that contacts can be grouped under. */
export async function createBusiness(cfg: GhlConfig, input: BusinessInput) {
  const payload: Record<string, unknown> = { locationId: cfg.locationId };
  for (const [k, v] of Object.entries(input)) {
    if (v !== null && v !== undefined && v !== "") payload[k] = v;
  }
  return await ghlFetch<{ business: { id: string } }>(cfg, "POST", "/businesses/", payload);
}

/** Link a contact to a business (so it shows under that business in GHL/VibeReach).
 * Note: businessId is rejected on /contacts/upsert, so it must be set via this PUT. */
export async function linkContactToBusiness(cfg: GhlConfig, contactId: string, businessId: string) {
  return await ghlFetch<{ contact: { id: string } }>(cfg, "PUT", `/contacts/${contactId}`, { businessId });
}

// ---- Opportunity helpers -----------------------------------------------------

export interface OpportunityInput {
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  name: string;
  monetaryValue?: number | null;
  status?: "open" | "won" | "lost" | "abandoned";
}

export async function createOpportunity(cfg: GhlConfig, input: OpportunityInput) {
  return await ghlFetch<{ opportunity: { id: string } }>(cfg, "POST", "/opportunities/", {
    locationId: cfg.locationId,
    status: "open",
    ...input,
  });
}

export async function updateOpportunity(cfg: GhlConfig, opportunityId: string, patch: Partial<OpportunityInput>) {
  return await ghlFetch<{ opportunity: { id: string } }>(cfg, "PUT", `/opportunities/${opportunityId}`, patch);
}

/** List pipelines (used to resolve pipeline + stage IDs for the account). */
export async function listPipelines(cfg: GhlConfig) {
  return await ghlFetch<{ pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }> }>(
    cfg, "GET", `/opportunities/pipelines?locationId=${cfg.locationId}`,
  );
}

// ---- Custom fields -----------------------------------------------------------

export interface GhlCustomField { id: string; name: string; fieldKey?: string; dataType?: string }

/** List the location's contact custom fields (to resolve a field id by name). */
export async function listCustomFields(cfg: GhlConfig) {
  return await ghlFetch<{ customFields: GhlCustomField[] }>(
    cfg, "GET", `/locations/${cfg.locationId}/customFields`,
  );
}

/** Set custom field values on a contact. fields = [{ id, value }]. */
export async function updateContactCustomFields(
  cfg: GhlConfig,
  contactId: string,
  fields: Array<{ id: string; value: string | number }>,
) {
  return await ghlFetch<{ contact: { id: string } }>(
    cfg, "PUT", `/contacts/${contactId}`, { customFields: fields },
  );
}

/** Find a custom field whose name contains the given term (case-insensitive). */
export function findFieldByName(fields: GhlCustomField[], term: string): GhlCustomField | undefined {
  const t = term.toLowerCase();
  return fields.find((f) => (f.name ?? "").toLowerCase().includes(t));
}

// ---- Tags --------------------------------------------------------------------

/** Add one or more tags to a contact (fires GHL "tag added" workflows). */
export async function addContactTags(cfg: GhlConfig, contactId: string, tags: string[]) {
  return await ghlFetch<{ tags: string[] }>(
    cfg, "POST", `/contacts/${contactId}/tags`, { tags },
  );
}

// ---- Email (send through GHL, not a 3rd-party ESP) ---------------------------

/** Send an Email to a contact via GHL conversations. The contact must exist
 * (use upsertContact first). GHL handles the sending domain/deliverability. */
export async function sendEmailToContact(
  cfg: GhlConfig,
  contactId: string,
  subject: string,
  html: string,
  opts?: { emailFrom?: string; text?: string; emailCc?: string[]; emailBcc?: string[]; attachments?: string[]; replyMessageId?: string },
) {
  const body: Record<string, unknown> = { type: "Email", contactId, subject, html };
  if (opts?.text) body.message = opts.text;
  if (opts?.emailFrom) body.emailFrom = opts.emailFrom;
  if (opts?.emailCc?.length) body.emailCc = opts.emailCc;
  if (opts?.emailBcc?.length) body.emailBcc = opts.emailBcc;
  // Array of file URLs GHL fetches at send time and attaches to the email
  // (e.g. secure customer-document links or leadconnectorhq download URLs).
  if (opts?.attachments?.length) body.attachments = opts.attachments;
  // Thread the send as a reply to an existing email in the conversation so the
  // recipient's inbox keeps one thread (GHL sets Re:/In-Reply-To headers).
  if (opts?.replyMessageId) body.replyMessageId = opts.replyMessageId;
  return await ghlFetch<{ messageId?: string; conversationId?: string }>(
    cfg, "POST", "/conversations/messages", body,
  );
}

/** Send an SMS to a contact via LeadConnector (lands in the contact's
 * Conversations thread). The contact must have a valid phone on file; GHL
 * returns an error otherwise. Used as the on-call invite path (closer clicks,
 * merchant's phone buzzes). */
export async function sendSmsToContact(cfg: GhlConfig, contactId: string, message: string) {
  return await ghlFetch<{ messageId?: string; conversationId?: string }>(
    cfg, "POST", "/conversations/messages", { type: "SMS", contactId, message },
  );
}

/** Machine marker to append to an activity_log content string so the opens
 * harvester (poll-funder-replies phase 3) can later resolve THIS send's GHL
 * email record and stamp it opened. Prefers the email-record id (directly
 * fetchable via /conversations/messages/email/{id}) over the conversation-
 * message id (which must first be expanded to its email record). Returns "" when
 * the send response carried neither — the row simply never gets an opened chip. */
export function sendMarker(sendData: unknown): string {
  const d = (sendData ?? {}) as Record<string, unknown>;
  const emsg = typeof d.emailMessageId === "string" ? d.emailMessageId : "";
  if (emsg) return ` [emsg:${emsg}]`;
  const msg = typeof d.messageId === "string" ? d.messageId : "";
  if (msg) return ` [msg:${msg}]`;
  return "";
}

/** Walk a contact's conversation and return the EMAIL RECORD ids carried by its
 * email messages, newest message first (and, within a message, in GHL's order).
 * This is the one traversal every email-record lookup shares: conversation →
 * messages → meta.email.messageIds. A conversation message is NOT an email record
 * — it has no status/error and its direction lies about sibling-address replies
 * (see the "GHL email records vs messages" memory), so anything that needs to
 * JUDGE an email must fetch the record ids this returns. */
async function emailRecordIds(cfg: GhlConfig, contactId: string, limit = 10): Promise<string[]> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  const cid = conv.data?.conversations?.[0]?.id;
  if (!cid) return [];
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=${limit}`,
  );
  const out: string[] = [];
  for (const m of msgs.data?.messages?.messages ?? []) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    for (const id of ids) out.push(String(id));
  }
  return out;
}

/** Latest email message id in the contact's conversation (or null). Use as
 * replyMessageId so outbound lands as a threaded reply in the recipient's inbox. */
export async function latestEmailMessageId(cfg: GhlConfig, contactId: string): Promise<string | null> {
  // replyMessageId must be an EMAIL RECORD id (meta.email.messageIds), not the
  // conversation-message id — GHL 404s otherwise.
  const ids = await emailRecordIds(cfg, contactId, 10);
  return ids.length ? ids[0] : null;
}

/** One GHL email record — the authoritative object for "did this email land?". */
export interface GhlEmailRecord {
  id: string;
  direction?: string;
  status?: string;
  error?: string;
  to?: string[];
  subject?: string;
  dateAdded?: string;
}

/** Fetch a single email record by its id. */
export async function getEmailRecord(cfg: GhlConfig, emailMessageId: string) {
  return await ghlFetch<{ emailMessage: GhlEmailRecord }>(
    cfg, "GET", `/conversations/messages/email/${emailMessageId}`,
  );
}

/** GHL/Mailgun terminal states that mean "this address does not accept mail".
 * Once GHL records one of these it flags the address and rejects EVERY later send
 * to it with 400 "Contact's email is invalid". */
const UNDELIVERABLE_STATUSES = new Set(["failed", "bounced", "rejected", "undelivered"]);

export interface LastEmailOutcome {
  /** true when the most recent OUTBOUND email to this contact did not deliver. */
  bounced: boolean;
  /** GHL's email-record status: "delivered" | "opened" | "failed" | … null = never emailed. */
  status: string | null;
  /** GHL's SMTP-level reason, e.g. "1 Requested mail action aborted, mailbox not found" (550). */
  error: string | null;
  /** The address GHL actually sent to (may differ from what we hold). */
  to: string | null;
  emailMessageId: string | null;
  /** When the record was created (ISO). */
  at: string | null;
}

const NO_EMAIL_ON_RECORD: LastEmailOutcome = {
  bounced: false, status: null, error: null, to: null, emailMessageId: null, at: null,
};

/**
 * Did the last email we sent this contact BOUNCE, and why?
 *
 * Walks the same conversation → message → email-record path as
 * latestEmailMessageId, then reads the most recent OUTBOUND email RECORD's
 * `status` / `error`. Judging by the record (not the conversation message) is
 * mandatory: the conversation message carries no status at all, so a hard bounce
 * is completely invisible from it.
 *
 * This is the check that would have caught klbreen3@yahoo.com before a closer
 * spent an entire application on a dead mailbox: its very first automated email
 * came back status "failed" / "1 Requested mail action aborted, mailbox not found",
 * and from that moment GHL 400s every send to the address.
 *
 * Never throws — a GHL hiccup returns "no bounce on record" (status null) so a
 * lookup failure can never block a legitimate send.
 */
export async function lastEmailFailure(cfg: GhlConfig, contactId: string): Promise<LastEmailOutcome> {
  try {
    const ids = await emailRecordIds(cfg, contactId, 10);
    for (const id of ids) {
      const rec = await getEmailRecord(cfg, id);
      const em = rec.data?.emailMessage;
      if (!em) continue;
      // Inbound records (merchant replies) say nothing about deliverability.
      if (String(em.direction ?? "").toLowerCase() !== "outbound") continue;
      const status = typeof em.status === "string" ? em.status : null;
      return {
        bounced: !!status && UNDELIVERABLE_STATUSES.has(status.toLowerCase()),
        status,
        error: typeof em.error === "string" && em.error ? em.error : null,
        to: Array.isArray(em.to) && em.to.length ? String(em.to[0]) : null,
        emailMessageId: em.id ?? id,
        at: typeof em.dateAdded === "string" ? em.dateAdded : null,
      };
    }
    return NO_EMAIL_ON_RECORD;
  } catch (e) {
    console.warn("[ghl] lastEmailFailure lookup failed (treating as no bounce on record):",
      e instanceof Error ? e.message : String(e));
    return NO_EMAIL_ON_RECORD;
  }
}

/** The exact sentence a closer must see when an address is dead. One copy, one
 * truth — used by every send path so the message never drifts. */
export function bounceMessage(email: string, outcome: LastEmailOutcome): string {
  const reason = outcome.error ?? outcome.status ?? "the mail server rejected it";
  return `${email} is undeliverable — the last email to it bounced (${reason}). ` +
    `GHL will reject every send to this address. Call the merchant, get a working email, ` +
    `update it on the deal, then re-send.`;
}

/** Persist a bounce verdict onto the customer row so the UI can show it without
 * hitting GHL on every render. Best-effort by design, but LOUD on failure. */
export async function recordEmailOutcome(
  db: SupabaseClient,
  customerId: string,
  email: string,
  outcome: LastEmailOutcome,
): Promise<void> {
  if (!outcome.status) return; // never emailed — leave the row alone
  const patch = outcome.bounced
    ? {
      email_status: "bounced",
      email_bounced_at: outcome.at ?? new Date().toISOString(),
      email_bounce_reason: (outcome.error ?? outcome.status).slice(0, 500),
      email_checked_at: new Date().toISOString(),
    }
    : {
      email_status: "ok",
      email_bounced_at: null,
      email_bounce_reason: null,
      email_checked_at: new Date().toISOString(),
    };
  const { error } = await db.from("customers").update(patch).eq("id", customerId).eq("email", email);
  if (error) console.error("[ghl] recordEmailOutcome update failed:", error.message);
}

// ---- Comms page helpers (contact search + thread history) --------------------

export interface SearchContactsArgs {
  query?: string;
  pageLimit?: number;
  /** Cursor from a prior page: the `searchAfter` array of the last contact. */
  startAfter?: unknown[];
}

/**
 * Search the location's contacts via POST /contacts/search. Returns the GHL
 * payload ({ contacts, total }). Each contact carries its own `searchAfter`
 * cursor; pass the last one back as `startAfter` to page forward.
 */
export async function searchContacts(cfg: GhlConfig, args: SearchContactsArgs = {}) {
  const { query, pageLimit = 20, startAfter } = args;
  const body: Record<string, unknown> = { locationId: cfg.locationId, pageLimit };
  if (query) body.query = query;
  if (startAfter && Array.isArray(startAfter) && startAfter.length > 0) body.searchAfter = startAfter;
  return await ghlFetch<{ contacts: Array<Record<string, unknown>>; total: number }>(
    cfg, "POST", "/contacts/search", body,
  );
}

/**
 * Pull a contact's email/message history: find their first conversation, then
 * load its messages. Returns { conversationId, messages } — empty when the
 * contact has no conversation yet (never been emailed/texted).
 */
export async function getContactThread(cfg: GhlConfig, contactId: string) {
  const convs = await ghlFetch<{ conversations: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  const conversationId = convs.data?.conversations?.[0]?.id;
  if (!conversationId) {
    return { ok: convs.ok, status: convs.status, conversationId: null, messages: [], error: convs.error };
  }
  // GHL nests the array as { messages: { messages: [...] } }; flatten defensively.
  const msgs = await ghlFetch<{ messages?: { messages?: unknown[] } | unknown[] }>(
    cfg, "GET", `/conversations/${conversationId}/messages`,
  );
  const raw = msgs.data?.messages as { messages?: unknown[] } | unknown[] | undefined;
  const messages = Array.isArray(raw) ? raw : (raw?.messages ?? []);
  return { ok: msgs.ok, status: msgs.status, conversationId, messages, error: msgs.error };
}
