// textmagic-send — send an SMS to a merchant from inside the Revenue Playbook.
//
// The closer lives in the playbook. Texting a merchant used to mean leaving it
// for the shared Google Voice tab (the old "Text — company line" chip was a
// LOGIN affordance, not a send). This is the send: one POST, one text, logged on
// the deal's activity trail like every other merchant touch.
//
//   POST { deal_id, phone, message }
//        → { ok:true, id }                       (200)
//        | { ok:false, error }                   (4xx/5xx — TextMagic's own
//                                                 message passed through verbatim)
//
// AUTH: verify_jwt = true at the gateway PLUS an in-code staff role check
// (closer/admin/super_admin) — a service_role bearer is NOT a session and is
// rejected (house rule). A closer may only text on a deal they own or that is
// unassigned, mirroring the deals RLS they read under.
//
// CREDENTIALS: TextMagic REST v2 auth is the PAIR X-TM-Username + X-TM-Key, read
// from the vault via public.get_textmagic_creds() (SECURITY DEFINER, service_role
// only). Never in the repo, never returned, never logged.
//
// COMPLIANCE — hard gate, not advice: an MCA is a purchase of future receivables,
// NEVER a loan. Any message containing the word "loan" is refused with a 400 and
// nothing is sent. We do NOT append, prepend or rewrite the closer's text — what
// they typed is what goes out (or nothing does).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const TM_BASE = "https://rest.textmagic.com/api/v2";
const MAX_CHARS = 1600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Normalize a US/NANP number to E.164 (+1XXXXXXXXXX). Returns null when the
 *  input isn't a usable number — mirrors src/lib/phone.ts's canonical form, but
 *  refuses instead of passing junk through (a bad number burns a paid send). */
function toE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  // Already-international non-US numbers are accepted as typed (+ then 8-15 digits).
  if (/^\+(?!1)\d{8,15}$/.test(trimmed.replace(/[\s()-]/g, ""))) {
    return trimmed.replace(/[\s()-]/g, "");
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// A 2xx from POST /messages means ACCEPTED, not SENT. TextMagic can still reject
// the message a beat later — and does today: the account's toll-free sender is
// not yet carrier-verified, so US carriers drop everything from it (status "j",
// $0.00 charged, never delivered). A closer who is told "sent" on a text that
// never left is worse than an error, so we read the message back before
// answering. These are the codes that mean "still on its way or arrived".
const OK_STATUSES = new Set(["q", "a", "d", "b"]); // queued / sent / delivered / buffered

/** Read the message back until it settles, so a rejection is caught rather than
 *  reported as a success. Returns the last status seen (null if unreadable). */
async function readBackStatus(
  username: string, apiKey: string, id: number | string,
): Promise<{ status: string | null; rejectReason: string | null }> {
  const headers = { "X-TM-Username": username, "X-TM-Key": apiKey };
  let last: { status: string | null; rejectReason: string | null } = { status: null, rejectReason: null };
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 900));
    try {
      const res = await fetch(`${TM_BASE}/messages/${id}`, { headers });
      if (!res.ok) continue;
      const m = await res.json() as { status?: string; rejectReason?: string | null };
      last = { status: m.status ?? null, rejectReason: m.rejectReason ?? null };
      // 'q' is genuinely in-flight — keep looking. Anything else has settled.
      if (last.status && last.status !== "q") break;
    } catch { /* transient — try again */ }
  }
  return last;
}

/** TextMagic returns errors as { message, errors:{field:[msg]} } — surface the
 *  real thing (balance, invalid number, suspended account) rather than a status
 *  code. A $0.50 balance WILL fail sends; the closer needs to read why. */
function tmError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string; errors?: Record<string, string[]> };
    const detail = j.errors
      ? Object.entries(j.errors).map(([f, m]) => `${f}: ${(m ?? []).join(", ")}`).join(" · ")
      : "";
    const msg = [j.message, detail].filter(Boolean).join(" — ");
    if (msg) return `TextMagic: ${msg}`;
  } catch { /* not JSON — fall through to the raw body */ }
  return `TextMagic returned ${status}: ${body.slice(0, 300) || "no detail"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const db = serviceClient();

  // ── Auth: a real staff session (never a service_role bearer) ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ ok: false, error: "Invalid session" }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
  const role = prof?.role as string | undefined;
  if (!role || !["closer", "admin", "super_admin"].includes(role)) {
    return json({ ok: false, error: "Staff access required" }, 403);
  }

  // ── Input ──
  const payload = (await req.json().catch(() => ({}))) as {
    deal_id?: string; phone?: string; message?: string;
  };
  const dealId = (payload.deal_id ?? "").trim();
  const message = (payload.message ?? "").trim();
  const rawPhone = (payload.phone ?? "").trim();

  if (!dealId) return json({ ok: false, error: "deal_id is required." }, 400);
  if (!message) return json({ ok: false, error: "Write a message first — nothing was sent." }, 400);
  if (message.length > MAX_CHARS) {
    return json({ ok: false, error: `That message is ${message.length} characters — the limit is ${MAX_CHARS}.` }, 400);
  }

  // COMPLIANCE GATE. An MCA is not a loan; the word cannot go out on our line.
  if (/\bloans?\b/i.test(message)) {
    return json({
      ok: false,
      error: 'Not sent: an MCA is a purchase of future receivables, never a "loan". Say advance, working capital, or funding.',
    }, 400);
  }

  const phone = toE164(rawPhone);
  if (!phone) {
    return json({ ok: false, error: `"${rawPhone || "(blank)"}" isn't a valid phone number.` }, 400);
  }

  // ── The deal (and the closer's right to text on it) ──
  const { data: deal, error: dealErr } = await db
    .from("deals")
    .select("id, customer_id, assigned_closer_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealErr) return json({ ok: false, error: `Could not load the deal: ${dealErr.message}` }, 500);
  if (!deal) return json({ ok: false, error: "That deal no longer exists." }, 404);
  if (role === "closer" && deal.assigned_closer_id && deal.assigned_closer_id !== caller.id) {
    return json({ ok: false, error: "This deal belongs to another closer." }, 403);
  }

  // ── Credentials ──
  const { data: creds, error: credErr } = await db.rpc("get_textmagic_creds");
  const username = (creds as { username?: string } | null)?.username;
  const apiKey = (creds as { api_key?: string } | null)?.api_key;
  if (credErr || !username || !apiKey) {
    return json({
      ok: false,
      error: "TextMagic isn't configured — TEXTMAGIC_USERNAME / TEXTMAGIC_API_KEY are missing from the vault.",
    }, 500);
  }

  // ── Send ──
  let tmId: number | string | null = null;
  try {
    const res = await fetch(`${TM_BASE}/messages`, {
      method: "POST",
      headers: {
        "X-TM-Username": username,
        "X-TM-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: message, phones: phone }),
    });
    const raw = await res.text();
    if (!res.ok) return json({ ok: false, error: tmError(res.status, raw) }, 502);
    try {
      tmId = (JSON.parse(raw) as { id?: number | string }).id ?? null;
    } catch { /* accepted but unparseable — the send still happened */ }
  } catch (e) {
    return json({
      ok: false,
      error: `Could not reach TextMagic: ${e instanceof Error ? e.message : String(e)}`,
    }, 502);
  }

  // ── Did it actually go? (see OK_STATUSES) ──
  const settled = tmId
    ? await readBackStatus(username, apiKey, tmId)
    : { status: null, rejectReason: null };

  if (settled.status && !OK_STATUSES.has(settled.status)) {
    return json({
      ok: false,
      id: tmId,
      error:
        `TextMagic accepted the message then REJECTED it (status "${settled.status}"` +
        `${settled.rejectReason ? `, reason "${settled.rejectReason}"` : ""}) — it was not delivered. ` +
        `The usual cause is the sending number not being carrier-verified yet, or a trial account. ` +
        `Check the TextMagic account before retrying; a retry will be rejected the same way.`,
    }, 502);
  }

  // ── Log it on the deal's trail. Marker mirrors send-merchant-email's
  //    'merchant:email — …'; interaction_type 'sms' is one of the values the
  //    activity_log check constraint actually allows. Best-effort: a logging
  //    miss must never make a SENT text look unsent. ──
  await db.from("activity_log").insert({
    entity_type: "deal",
    entity_id: dealId,
    interaction_type: "sms",
    subject: `merchant:sms — ${phone}`,
    content: message.slice(0, 1600) +
      (tmId ? `\n[textmagic:${tmId}${settled.status ? ` status:${settled.status}` : ""}]` : ""),
    logged_by: caller.id,
  }).then(() => {}, () => {});

  return json({ ok: true, id: tmId, phone, status: settled.status });
});
