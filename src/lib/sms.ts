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

/** The JMP account this line runs on — static reference, straight from the
 *  setup guide. Shown on the ops page so nobody has to hunt for it mid-outage. */
export const JMP_ACCOUNT = {
  number: "+1 (786) 504-1159",
  jid: "mfunding@xmpp.chat",
  gateway: "cheogram.com",
  statusUrl: "https://status.jmp.chat",
} as const;
