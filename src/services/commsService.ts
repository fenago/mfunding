import supabase from "../supabase";

// Thin client over the `ghl-comms` edge function, which proxies GoHighLevel
// (the system of record for contacts and email). Mirrors adminUserService:
// every call goes through supabase.functions.invoke and surfaces the
// FunctionsHttpError JSON { error } message.

export interface GhlContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[];
  type?: string | null;
  source?: string | null;
  website?: string | null;
  additionalEmails?: Array<{ email: string }>;
  searchAfter?: unknown[];
}

export interface GhlMessage {
  id?: string;
  type?: number | string;
  messageType?: string;
  direction?: "inbound" | "outbound" | string;
  subject?: string | null;
  body?: string | null;
  status?: string | null;
  dateAdded?: string | null;
}

async function callComms<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ghl-comms", {
    body: { action, ...payload },
  });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (body?.error) msg = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(msg);
  }
  return data as T;
}

export interface SearchContactsResult {
  contacts: GhlContact[];
  total: number;
  nextCursor: unknown[] | null;
}

export function searchContacts(
  query: string,
  opts: { pageLimit?: number; startAfter?: unknown[] | null } = {}
): Promise<SearchContactsResult> {
  return callComms<SearchContactsResult>("searchContacts", {
    query: query || undefined,
    pageLimit: opts.pageLimit ?? 20,
    startAfter: opts.startAfter ?? undefined,
  });
}

export interface ThreadResult {
  conversationId: string | null;
  messages: GhlMessage[];
}

export function getThread(contactId: string): Promise<ThreadResult> {
  return callComms<ThreadResult>("getThread", { contactId });
}

export interface SendEmailResult {
  messageId: string | null;
  conversationId: string | null;
}

export function sendEmail(args: {
  contactId: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendEmailResult> {
  return callComms<SendEmailResult>("sendEmail", args);
}
