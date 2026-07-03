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

/** Authenticated request against the LeadConnector API. */
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
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (parsed as T) : null,
    error: res.ok ? undefined : (typeof parsed === "string" ? parsed : JSON.stringify(parsed)),
  };
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

/** Latest email message id in the contact's conversation (or null). Use as
 * replyMessageId so outbound lands as a threaded reply in the recipient's inbox. */
export async function latestEmailMessageId(cfg: GhlConfig, contactId: string): Promise<string | null> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  const cid = conv.data?.conversations?.[0]?.id;
  if (!cid) return null;
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=10`,
  );
  for (const m of msgs.data?.messages?.messages ?? []) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    // replyMessageId must be an EMAIL RECORD id (meta.email.messageIds), not
    // the conversation-message id — GHL 404s otherwise.
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    if (ids.length) return String(ids[ids.length - 1]);
  }
  return null;
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
