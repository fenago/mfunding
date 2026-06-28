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
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tags?: string[];
  source?: string | null;
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
  opts?: { emailFrom?: string; text?: string },
) {
  const body: Record<string, unknown> = { type: "Email", contactId, subject, html };
  if (opts?.text) body.message = opts.text;
  if (opts?.emailFrom) body.emailFrom = opts.emailFrom;
  return await ghlFetch<{ messageId?: string; conversationId?: string }>(
    cfg, "POST", "/conversations/messages", body,
  );
}
