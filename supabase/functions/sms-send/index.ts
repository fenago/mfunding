// sms-send — queue ONE outbound SMS on the JMP.chat line.
//
// This function does not talk to a carrier. It writes a single row into
// public.sms_messages with status 'queued'; a droplet-side bridge polls queued
// rows and hands them to JMP over XMPP. Everything here is the gate in front of
// that queue.
//
//   POST { to, body, customer_id? }
//        → { ok:true, id, status:'queued', phone, customer_id }      (200)
//        | { ok:false, error, code }                                 (4xx/5xx)
//
// `customer_id` is ADVISORY. It is never written and never decides anything about
// suppression — the returned customer_id is whatever the DB trigger resolved from
// the phone. Supplying one that contradicts the number is refused (409), because
// that means the caller is on the wrong thread.
//
// ── WHY THE GATE IS THIS STRICT ──────────────────────────────────────────────
// JMP.chat is a CONSUMER line, not an A2P 10DLC campaign. It has no carrier
// registration behind it, so the only thing keeping it deliverable is that its
// traffic looks like a person texting. Two things kill it permanently:
//   • texting someone who opted out — TCPA exposure, and STOP complaints are
//     exactly what carriers score a consumer number on;
//   • volume that looks like a blast — the number gets filtered, and the fix is
//     going back to A2P registration, which is weeks.
// So: one message per call (there is deliberately no array form and no loop),
// a hard refusal against the phone-keyed suppression list public.sms_opt_outs and
// customers.do_not_contact and GHL's contact DND, and rate caps at three scopes.
//
// ── UNREADABLE IS NOT "CLEAR" ────────────────────────────────────────────────
// Every guard below FAILS CLOSED. If we cannot read the DND state, or cannot
// count recent sends, we refuse and say why — we never treat an unreadable
// check as a passed check. A guard that silently degrades to "allow" is not a
// guard, and this codebase has been burned by failure-reads-as-success before.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
// verify_jwt = true at the gateway PLUS an in-code staff-role check against
// profiles (closer/employee/admin/super_admin). Per the house rule a
// service_role bearer is NOT a session and is rejected here — there is no cron
// path and no shared-secret path, because nothing automated should ever be able
// to text a merchant from this line.
//
// COMPLIANCE: an MCA is a purchase of future receivables, never a "loan". A body
// containing that word is refused and nothing is queued. We never rewrite,
// append to, or truncate what the sender typed — it goes out verbatim or not at
// all.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

const STAFF_ROLES = ["closer", "employee", "admin", "super_admin"];

// One SMS segment is 160 GSM-7 chars; carriers concatenate up to ~10. Past that
// a "message" is a document and reads as spray on a consumer line.
const MAX_CHARS = 1600;

// ── Rate caps ────────────────────────────────────────────────────────────────
// Three scopes, because they defend against different things:
//
//  PER NUMBER — a merchant must not be machine-gunned. A real back-and-forth is
//    a few messages in a few minutes; 4 in 5 minutes leaves room for that and
//    stops a stuck retry loop from becoming harassment.
//  PER USER — bounds one staff member pasting a list into the box by hand.
//  LINE-WIDE — the one that actually protects the phone number. Per-user caps do
//    nothing here: every closer shares a SINGLE JMP number, so the carrier sees
//    the sum. 30/hour and 200/day is comfortably inside consumer-line behavior.
const LIMITS = {
  perNumber: { max: 4, windowMin: 5, label: "this number" },
  perUser: { max: 8, windowMin: 1, label: "you" },
  perUserHour: { max: 60, windowMin: 60, label: "you" },
  lineHour: { max: 30, windowMin: 60, label: "the JMP line" },
  lineDay: { max: 200, windowMin: 1440, label: "the JMP line" },
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, error: string, status: number) {
  return json({ ok: false, code, error }, status);
}

/** Normalize to NANP E.164 (+1XXXXXXXXXX), or null if it isn't one.
 *
 *  NANP-ONLY ON PURPOSE. JMP issues US/Canada numbers and the bridge sends over
 *  a North-American gateway; a +44 destination would be accepted by the queue
 *  and then fail silently downstream. Refusing here makes the failure visible at
 *  the moment someone can still fix the number. Also rejects the structurally
 *  impossible NANP forms (area code or exchange starting 0/1) — those are typos,
 *  not numbers, and a typo'd text is a text delivered to a stranger. */
function toE164(raw: string): string | null {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** Exact stored forms, used only for the additional_phones array overlap (an
 *  array-element LIKE is not expressible through PostgREST). */
function phoneVariants(e164: string): string[] {
  const d = e164.slice(2); // strip +1
  return [e164, `1${d}`, d, `+1 ${d}`];
}

/** Last 10 digits — the identity rule public.sms_messages_link_customer() uses to
 *  decide whether a number belongs to a customer. Every match below is settled
 *  with this, so our answer and the trigger's cannot diverge. */
function last10(raw: string | null): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

/** A LIKE pattern that survives any separator layout: '2025550177',
 *  '202-555-0177', '(202) 555-0177' and '+1 202.555.0177' all match
 *  '%202%555%0177'.
 *
 *  WHY THIS EXISTS. This started as a list of literal spellings, which silently
 *  failed to match a stored '(202) 555-0177' — and a customer-lookup miss is not
 *  a neutral outcome here, it reads as "nobody has opted out". That bug was
 *  reproduced live: a do_not_contact=true merchant whose phone carried
 *  punctuation was queued for a send. The pattern only NARROWS candidates; every
 *  hit is then verified digit-exactly with last10(), so being loose costs
 *  nothing and being literal cost a merchant. */
function loosePhonePattern(e164: string): string {
  const d = e164.slice(2);
  return `%${d.slice(0, 3)}%${d.slice(3, 6)}%${d.slice(6)}`;
}

/** Upper bound on candidates we will verify. Hitting it means the pattern was
 *  too broad to settle safely, which is UNREADABLE — never "no match". */
const MAX_CANDIDATES = 200;

interface CustomerRow {
  id: string;
  do_not_contact: boolean | null;
  do_not_contact_reason: string | null;
  ghl_contact_id: string | null;
  business_name: string | null;
}
const CUSTOMER_COLS = "id, do_not_contact, do_not_contact_reason, ghl_contact_id, business_name";

interface DndVerdict {
  blocked: boolean;
  /** Set when the check could not be COMPLETED. Never conflated with "clear". */
  unreadable?: string;
  /** Set when the caller's customer_id contradicts the number being texted. */
  mismatch?: string;
  reason?: string;
}

/** Is this destination opted out?
 *
 *  THE PHONE IS THE SUBJECT, NOT THE customer_id. An earlier version let a
 *  caller-supplied customer_id drive this check, which meant a request whose
 *  customer_id did not own the number got its opt-out decision made about the
 *  WRONG PERSON — and filed the message on that person's thread. The number being
 *  texted is the only thing that identifies who is about to receive a message, so
 *  every source below is keyed on it.
 *
 *  NEITHER OF THE FIRST TWO SOURCES IS A SUPERSET OF THE OTHER, so both are always
 *  consulted and either one blocks:
 *   1. public.sms_opt_outs is keyed by PHONE. It is the only record that exists
 *      for the purchased/UCC book, where there is no customers row at all.
 *      sms_messages_stop_optout() inserts here unconditionally on an inbound
 *      opt-out and DELETES here on START/UNSTOP/YES, so re-subscribes work.
 *      Looked up with the DB's own sms_normalize_phone() — see below.
 *   2. customers.do_not_contact is keyed by PERSON. It is the only thing that
 *      catches a merchant who opted out from one of their numbers while we are
 *      texting a different one. Dropping it in favour of the phone table would
 *      reopen the same hole pointed the other way.
 *      Written by set-contact-dnd, the wavv disposition drain, and the STOP
 *      trigger.
 *   3. the GHL contact's dnd / dndSettings.SMS — the durable suppression the
 *      dialer enforces. One GHL call per send; volume is human-scale (one-off
 *      texts typed by a person), so this is noise against the 200k/day cap — see
 *      the ghl-standing-consumers-ledger. This is not a sweep.
 *
 *  Any source saying "suppressed" blocks. Any source being UNREADABLE blocks too,
 *  with a distinct message — we cannot prove the merchant did not opt out, so we
 *  do not send. */
async function checkDnd(
  db: SupabaseClient,
  phone: string,
  explicitCustomerId: string | null,
): Promise<DndVerdict> {
  const variants = phoneVariants(phone);

  // ── The structural suppression list. Checked FIRST and keyed on nothing but
  //    the number, so it works for a number we have never seen before.
  //
  // THE LOOKUP KEY COMES FROM THE DATABASE, NOT FROM US. sms_opt_outs.phone is
  // written by sms_messages_stop_optout() through public.sms_normalize_phone(),
  // so that function defines the spelling of a suppressed number. Our own
  // toE164() agrees with it for every NANP input today — verified — but agreeing
  // today is not the same as being the same function. If the two ever diverge,
  // a locally-spelled key silently misses and we text someone who said STOP;
  // there is no error, just a send. So we ask the DB to spell it. One extra
  // round-trip buys away an entire class of silent compliance failure.
  const { data: normalized, error: eN } = await db
    .rpc("sms_normalize_phone", { p: phone });
  const suppressionKey = (normalized as string | null) ?? null;
  if (eN || !suppressionKey) {
    return {
      blocked: true,
      unreadable: `couldn't normalize ${phone} for the opt-out lookup` +
        (eN ? `: ${eN.message}` : " (normalizer returned null)"),
    };
  }

  const { data: optOut, error: e0 } = await db
    .from("sms_opt_outs").select("phone, opted_out_at, source")
    .eq("phone", suppressionKey).maybeSingle();
  if (e0) return { blocked: true, unreadable: `opt-out list lookup failed: ${e0.message}` };
  if (optOut) {
    const when = (optOut as { opted_out_at?: string }).opted_out_at;
    return {
      blocked: true,
      reason: `${phone} is on the SMS suppression list` +
        (when ? ` (opted out ${when.slice(0, 10)})` : "") +
        ". That opt-out stands whether or not the number is attached to a customer " +
        "record, and only an inbound START from the merchant lifts it.",
    };
  }

  // ── Who owns this NUMBER? (never "who did the caller name?") ──
  // Two candidate queries — a separator-tolerant LIKE on the primary phone, and
  // an exact overlap on additional_phones — then digit-exact verification of
  // every hit. Two queries rather than one `or(...)` because the array overlap
  // operator does not compose with `.or()` cleanly, and a silently-malformed
  // filter here would read as "no DND row found", i.e. as permission to send.
  const cols = `${CUSTOMER_COLS}, phone, additional_phones`;
  type Candidate = CustomerRow & { phone: string | null; additional_phones: string[] | null };
  const [primary, alt] = await Promise.all([
    db.from("customers").select(cols).ilike("phone", loosePhonePattern(phone)).limit(MAX_CANDIDATES),
    db.from("customers").select(cols).overlaps("additional_phones", variants).limit(MAX_CANDIDATES),
  ]);
  if (primary.error) return { blocked: true, unreadable: `phone lookup failed: ${primary.error.message}` };
  if (alt.error) return { blocked: true, unreadable: `alt-phone lookup failed: ${alt.error.message}` };
  if ((primary.data?.length ?? 0) >= MAX_CANDIDATES || (alt.data?.length ?? 0) >= MAX_CANDIDATES) {
    return {
      blocked: true,
      unreadable: `too many customer records match ${phone} to check them all safely`,
    };
  }

  const target = phone.slice(2); // the 10 significant digits
  const owners = ([...(primary.data ?? []), ...(alt.data ?? [])] as Candidate[])
    .filter((c) =>
      last10(c.phone) === target ||
      (c.additional_phones ?? []).some((p) => last10(p) === target));

  // When a number appears on more than one record the SUPPRESSED one wins — a
  // duplicate that has not been marked must never override an opt-out.
  const row: CustomerRow | null =
    owners.find((c) => c.do_not_contact) ?? owners[0] ?? null;

  if (row?.do_not_contact) {
    return {
      blocked: true,
      reason: row.do_not_contact_reason?.trim() ||
        `${row.business_name ?? "This contact"} is marked do-not-contact.`,
    };
  }

  // ── A caller-supplied customer_id is ADVISORY ONLY ──
  // It no longer picks the row's linkage (the BEFORE INSERT trigger does that from
  // the phone) and it deliberately does NOT feed any check above: letting it name
  // the subject is what previously made the opt-out decision about the wrong
  // person. The one thing still done with it is refusing a request that
  // CONTRADICTS the number — a number that demonstrably belongs to someone else
  // means the caller is on the wrong thread, and that is worth saying out loud
  // rather than silently texting whoever `to` actually is.
  if (explicitCustomerId && row && row.id !== explicitCustomerId) {
    const { data: named } = await db
      .from("customers").select("id, business_name").eq("id", explicitCustomerId).maybeSingle();
    return {
      blocked: true,
      mismatch: `${phone} belongs to a different customer (${row.business_name ?? row.id}) ` +
        `than the customer_id you sent (${(named as { business_name?: string } | null)?.business_name ?? explicitCustomerId}).`,
    };
  }

  // ── GHL contact-level DND ──
  const contactId = row?.ghl_contact_id ?? null;
  if (!contactId) {
    // No linked contact: nothing more to read, and nothing stale to worry about.
    return { blocked: false };
  }

  let cfg;
  try {
    cfg = await getGhlConfig(db);
  } catch (e) {
    return {
      blocked: true,
      unreadable: `GHL not configured, so the opt-out state can't be verified (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  const r = await ghlFetch<{ contact?: Record<string, unknown> }>(cfg, "GET", `/contacts/${contactId}`);
  if (!r.ok) {
    // "The contact is gone" and "we couldn't read it" are DIFFERENT answers and
    // must not collapse into each other.
    //
    // A deleted/merged contact is a normal, permanent state — our ghl_contact_id
    // outlives the record every time a dedupe runs — and it means there is no
    // suppression record in GHL to consult, so the local mirror's verdict stands.
    // Verified live 2026-08-29: LeadConnector answers a missing contact with
    // HTTP *400* and body "Contact with id … not found", NOT a 404. Matching on
    // the status alone would fail closed forever on every merged contact.
    // Anything else — 401, 403, 429, 5xx, a network drop — is a read we could not
    // complete, and that refuses.
    const notFound = (r.status === 404) ||
      (r.status === 400 && /not\s*found/i.test(r.error ?? ""));
    if (notFound) return { blocked: false };
    return {
      blocked: true,
      unreadable: `couldn't read the contact's opt-out state from GHL (${r.status}: ${r.error ?? "unknown"})`,
    };
  }

  const c = (r.data?.contact ?? {}) as Record<string, unknown>;
  const settings = (c.dndSettings ?? {}) as Record<string, { status?: string }>;
  const smsStatus = (settings.SMS?.status ?? "").toLowerCase();
  if (c.dnd === true || smsStatus === "active" || smsStatus === "permanent") {
    return {
      blocked: true,
      reason: "This contact is on Do Not Contact in GHL (opted out).",
    };
  }

  return { blocked: false };
}

interface CapCheck { over: boolean; unreadable?: string; message?: string }

/** Count rows in a window and compare to a cap. Any read error is UNREADABLE and
 *  refuses — an uncountable rate limit is not an absent one. */
async function underCap(
  db: SupabaseClient,
  cap: { max: number; windowMin: number; label: string },
  filter?: { column: string; value: string },
): Promise<CapCheck> {
  const since = new Date(Date.now() - cap.windowMin * 60_000).toISOString();
  let q = db.from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .gte("created_at", since);
  if (filter) q = q.eq(filter.column, filter.value);
  const { count, error } = await q;
  if (error) return { over: true, unreadable: `rate-limit check failed: ${error.message}` };
  if (count === null) return { over: true, unreadable: "rate-limit check returned no count" };
  if (count >= cap.max) {
    const window = cap.windowMin >= 1440
      ? "today"
      : cap.windowMin >= 60
        ? `in the last ${cap.windowMin / 60} hour${cap.windowMin > 60 ? "s" : ""}`
        : `in the last ${cap.windowMin} minute${cap.windowMin > 1 ? "s" : ""}`;
    return {
      over: true,
      message: `Rate limit: ${cap.max} texts ${window} for ${cap.label} — ${count} already sent. ` +
        `This line is a consumer number; bursts get it carrier-filtered. Wait, or call instead.`,
    };
  }
  return { over: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method", "Method not allowed", 405);

  const db = serviceClient();

  // ── Auth: a real staff session. A service_role bearer is not a session. ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("unauthorized", "Missing authorization", 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return fail("unauthorized", "Invalid session", 401);

  const { data: prof, error: profErr } = await db
    .from("profiles").select("id, role").eq("id", caller.id).maybeSingle();
  if (profErr) return fail("server", `Could not read your profile: ${profErr.message}`, 500);
  const role = prof?.role as string | undefined;
  if (!role || !STAFF_ROLES.includes(role)) {
    return fail("forbidden", "Staff access required", 403);
  }

  // ── Input. ONE message. There is no array form by design. ──
  const payload = (await req.json().catch(() => null)) as
    | { to?: string; body?: string; customer_id?: string }
    | null;
  if (!payload) return fail("bad_request", "Invalid JSON body", 400);

  const rawTo = (payload.to ?? "").trim();
  const body = (payload.body ?? "").trim();
  const customerId = (payload.customer_id ?? "").trim() || null;

  if (!body) return fail("empty_body", "Write a message first — nothing was queued.", 400);
  if (body.length > MAX_CHARS) {
    return fail("too_long",
      `That message is ${body.length} characters — the limit is ${MAX_CHARS}.`, 400);
  }

  // COMPLIANCE GATE. An MCA is not a loan; the word cannot go out on our line.
  if (/\bloans?\b/i.test(body)) {
    return fail("compliance",
      'Not queued: an MCA is a purchase of future receivables, never a "loan". ' +
      "Say advance, working capital, or funding.", 400);
  }

  if (!rawTo) return fail("bad_request", "`to` is required.", 400);
  const phone = toE164(rawTo);
  if (!phone) {
    return fail("bad_number",
      `"${rawTo}" isn't a valid US/Canada mobile number. Use a 10-digit number ` +
      "(or 11 digits starting with 1). This line can't text outside North America.", 400);
  }

  // ── Guard 1: opt-out. Fails closed on an unreadable check. ──
  const dnd = await checkDnd(db, phone, customerId);
  if (dnd.unreadable) {
    return fail("dnd_unreadable",
      `Not queued — ${dnd.unreadable}. Nothing was sent: we don't text a number ` +
      "whose opt-out status we can't confirm.", 503);
  }
  if (dnd.mismatch) {
    return fail("customer_mismatch",
      `Not queued — ${dnd.mismatch} Texting it would file this conversation under ` +
      "the wrong merchant. Open the thread for the number you meant, or drop " +
      "customer_id and let it resolve from the phone.", 409);
  }
  if (dnd.blocked) {
    return fail("dnd",
      `Not queued — ${phone} is on Do Not Contact. ${dnd.reason ?? ""}`.trim(), 403);
  }

  // ── Guard 2: rate caps. All five counted in parallel; each fails closed, and
  //    the array order fixes which message wins when more than one trips. ──
  const byUser = { column: "created_by", value: caller.id };
  const checks = await Promise.all([
    underCap(db, LIMITS.perNumber, { column: "phone", value: phone }),
    underCap(db, LIMITS.perUser, byUser),
    underCap(db, LIMITS.perUserHour, byUser),
    underCap(db, LIMITS.lineHour),
    underCap(db, LIMITS.lineDay),
  ]);
  for (const c of checks) {
    if (c.unreadable) {
      return fail("rate_unreadable",
        `Not queued — ${c.unreadable}. Nothing was sent: we don't send when we ` +
        "can't count what already went out.", 503);
    }
    if (c.over) return fail("rate_limited", c.message ?? "Rate limit reached.", 429);
  }

  // ── Queue it. ONE row. The bridge picks it up from here. ──
  //
  // customer_id is NEVER passed. The BEFORE INSERT trigger
  // sms_messages_link_customer() resolves it from `phone` on the last 10 digits,
  // and it backs off entirely if a value is supplied — so passing one is the only
  // way to produce a row whose linkage disagrees with the number being texted.
  // That is not hypothetical: an earlier version passed it and filed a message on
  // a merchant whose phone did not match. Omitting it makes a wrong-thread row
  // structurally impossible rather than merely guarded against. It also picks up
  // format matches ("(555) 010-7788" vs "+15550107788") a literal match misses.
  //
  // `status` must be passed explicitly: the column DEFAULT is 'received', so an
  // omitted status would silently produce an inbound-shaped row.
  const { data: inserted, error: insErr } = await db
    .from("sms_messages")
    .insert({
      direction: "outbound",
      phone,
      body,
      status: "queued",
      created_by: caller.id,
    })
    .select("id, status, customer_id")
    .single();

  if (insErr) {
    return fail("queue_failed", `Could not queue the message: ${insErr.message}`, 500);
  }

  // Read the linkage BACK off the stored row rather than re-deriving it, so the
  // activity trail and the queue row can never name different merchants.
  const linkedCustomerId = (inserted.customer_id as string | null) ?? null;

  // Activity trail. 'sms' is one of the values the activity_log check constraint
  // allows; the marker mirrors textmagic-send's 'merchant:sms — …'. Best-effort
  // by design, but only AFTER the row exists — a logging miss must never make a
  // queued text look unqueued, and it must never make an unqueued one look sent.
  if (linkedCustomerId) {
    await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: linkedCustomerId,
      interaction_type: "sms",
      subject: `merchant:sms — ${phone}`,
      content: `${body.slice(0, MAX_CHARS)}\n[jmp:queued sms_message:${inserted.id}]`,
      logged_by: caller.id,
    }).then(() => {}, () => {});
  }

  return json({
    ok: true,
    id: inserted.id,
    status: inserted.status ?? "queued",
    phone,
    customer_id: linkedCustomerId,
  });
});
