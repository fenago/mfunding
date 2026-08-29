// sms-send — queue ONE outbound SMS on the JMP.chat line.
//
// This function does not talk to a carrier. It writes a single row into
// public.sms_messages with status 'queued'; a droplet-side bridge polls queued
// rows and hands them to JMP over XMPP. Everything here is the gate in front of
// that queue.
//
//   POST { to, body, customer_id?, line_id?, media_url? }
//        → { ok:true, id, status:'queued', phone, customer_id, line_id }   (200)
//        | { ok:false, error, code }                                       (4xx/5xx)
//
// `media_url` is OPTIONAL and turns this into a picture message (MMS). It must be
// an https URL to an object in OUR OWN sms-media storage bucket — the gateway
// (Cheogram) fetches it to build the MMS, so a foreign URL would make us hand an
// arbitrary third-party fetch target to the carrier. When media_url is present the
// body may be empty (media-only send); the body, when present, rides along as the
// MMS caption. The URL is validated against SUPABASE_URL + the sms-media bucket
// path and stored on the queued row for the bridge to attach via jabber:x:oob.
//
// `customer_id` is ADVISORY. It is never written and never decides anything about
// suppression — the returned customer_id is whatever the DB trigger resolved from
// the phone. Supplying one that contradicts the number is refused (409), because
// that means the caller is on the wrong thread.
//
// `line_id` is ADVISORY too, and OPTIONAL: it names which company SMS line
// (public.sms_lines) the message goes out from. Omit it and it resolves to the
// active default line. A line that does not exist, or exists but is inactive, is
// REFUSED — never silently swapped for the default — because "send from the line I
// picked" and "send from whatever's default" are different intents, and a line was
// deactivated for a reason. The resolved line_id is stamped on the queued row so
// the bridge, the thread view, and the rate history all agree on which number it
// belongs to. Today exactly one line exists (the default), so an omitted line_id
// is the whole world; this is the seam multi-line grows into.
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
// a hard refusal via public.sms_suppression_check() — which consults BOTH the
// phone-keyed sms_opt_outs list and the person-keyed customers.do_not_contact
// flag — plus GHL's contact DND, and rate caps at three scopes.
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

/** Validate an outbound picture-message URL.
 *
 *  MMS on this line works by handing Cheogram an HTTPS URL it fetches and
 *  transcodes. That makes the URL an SSRF-shaped input: whatever we accept, the
 *  gateway will go retrieve. So we accept ONLY objects in our own public
 *  sms-media bucket — same host as SUPABASE_URL and under the bucket's public
 *  path — and reject anything else. Returns the normalized URL or an error string. */
function validateMediaUrl(raw: string): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "media_url is not a valid URL." };
  }
  if (u.protocol !== "https:") {
    return { error: "media_url must be an https URL." };
  }
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  let baseHost = "";
  try {
    baseHost = new URL(base).host;
  } catch {
    return { error: "server is misconfigured (SUPABASE_URL unreadable)." };
  }
  if (u.host !== baseHost) {
    return { error: `media_url must be hosted on ${baseHost} (our storage), not ${u.host}.` };
  }
  // Public object route for the dedicated SMS media bucket.
  if (!u.pathname.startsWith("/storage/v1/object/public/sms-media/")) {
    return { error: "media_url must be an object in the sms-media storage bucket." };
  }
  return { url: u.toString() };
}

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

/** Is this destination suppressed?
 *
 *  THE PHONE IS THE SUBJECT, NOT THE customer_id. An earlier version let a
 *  caller-supplied customer_id drive this check, which meant a request whose
 *  customer_id did not own the number got its opt-out decision made about the
 *  WRONG PERSON — and filed the message on that person's thread. The number being
 *  texted is the only thing that identifies who is about to receive a message.
 *
 *  ── THE VERDICT IS THE DATABASE'S, NOT OURS ─────────────────────────────────
 *  public.sms_suppression_check(phone) answers this in one call. It consults BOTH
 *  suppression records, because neither is a superset of the other:
 *    • sms_opt_outs is keyed by PHONE — the only record that exists for a number
 *      with no customers row, which is most of the purchased/UCC book.
 *    • customers.do_not_contact is keyed by PERSON — the only thing that catches
 *      a merchant who opted out from one of their numbers while we text another.
 *  It compares the primary phone AND every additional_phones entry in canonical
 *  form via sms_normalize_phone(), and resolves ties toward suppressed.
 *
 *  This replaced hand-rolled matching in this function, and the reason is worth
 *  keeping: that version compared literal phone spellings, so a merchant stored
 *  as '(202) 555-0177' matched nothing — and "no customer found" reads as "nobody
 *  opted out". A do_not_contact merchant was queued for a send in testing. Phone
 *  identity is the database's job; every spelling question now has exactly one
 *  answer, and it is not ours to get wrong.
 *
 *  It RAISES on an unparseable number rather than reporting "not suppressed", so
 *  a normalization failure surfaces as an error here and refuses. Do not soften
 *  that into an allow.
 *
 *  GHL's contact dnd / dndSettings.SMS is checked separately below — it is the
 *  durable suppression the dialer enforces and lives outside our DB. One GHL call
 *  per send; volume is human-scale, so this is noise against the 200k/day cap
 *  (see the ghl-standing-consumers-ledger). This is not a sweep. */
async function checkDnd(
  db: SupabaseClient,
  phone: string,
  explicitCustomerId: string | null,
): Promise<DndVerdict> {
  const { data: verdictRows, error: vErr } = await db
    .rpc("sms_suppression_check", { p_phone: phone });
  if (vErr) {
    return { blocked: true, unreadable: `suppression check failed: ${vErr.message}` };
  }
  const verdict = (Array.isArray(verdictRows) ? verdictRows[0] : verdictRows) as
    | { suppressed: boolean; reason: string | null; customer_id: string | null }
    | undefined;
  if (!verdict) {
    return { blocked: true, unreadable: "suppression check returned no verdict" };
  }

  // The owner of the NUMBER, as the database resolved it — returned whether or
  // not the number is suppressed, so it also serves the GHL and mismatch checks.
  const ownerId = verdict.customer_id ?? null;
  let row: CustomerRow | null = null;
  if (ownerId) {
    const { data: c, error: cErr } = await db
      .from("customers").select(CUSTOMER_COLS).eq("id", ownerId).maybeSingle();
    if (cErr) return { blocked: true, unreadable: `customer lookup failed: ${cErr.message}` };
    row = (c as CustomerRow | null) ?? null;
  }

  if (verdict.suppressed) {
    const detail = verdict.reason === "opted_out"
      ? `${phone} is on the SMS suppression list. That opt-out stands whether or ` +
        "not the number is attached to a customer record, and only an inbound " +
        "START from the merchant lifts it."
      : row?.do_not_contact_reason?.trim() ||
        `${row?.business_name ?? "This contact"} is marked do-not-contact.`;
    return { blocked: true, reason: detail };
  }

  // ── A caller-supplied customer_id is ADVISORY ONLY ──
  // It does not pick the row's linkage (the BEFORE INSERT trigger does that from
  // the phone) and it deliberately feeds no check above: letting it name the
  // subject is what previously made the opt-out decision about the wrong person.
  // The one thing still done with it is refusing a request that CONTRADICTS the
  // number — that means the caller is on the wrong thread, and it is worth saying
  // out loud rather than silently texting whoever `to` actually is.
  if (explicitCustomerId && ownerId && ownerId !== explicitCustomerId) {
    const { data: named } = await db
      .from("customers").select("id, business_name").eq("id", explicitCustomerId).maybeSingle();
    return {
      blocked: true,
      mismatch: `${phone} belongs to a different customer (${row?.business_name ?? ownerId}) ` +
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve which sms_lines row this send belongs to. FAILS CLOSED like every
 *  other guard: a read error is UNREADABLE (not "use the default"), and a
 *  requested line that is missing or inactive is REFUSED, never silently
 *  substituted.
 *
 *  Requested line: must exist AND be is_active. Omitted line: the one row that is
 *  is_default AND is_active. If the default line has been deactivated and no
 *  replacement default set, there is no line to send from and this refuses —
 *  better a visible "no active line" than a queued row the bridge can't attribute. */
async function resolveLine(
  db: SupabaseClient,
  requestedLineId: string | null,
): Promise<{ lineId: string } | { code: string; error: string; status: number }> {
  if (requestedLineId) {
    if (!UUID_RE.test(requestedLineId)) {
      return { code: "bad_line", error: `"${requestedLineId}" isn't a valid line id.`, status: 400 };
    }
    const { data, error } = await db
      .from("sms_lines").select("id, is_active, label, phone").eq("id", requestedLineId).maybeSingle();
    if (error) {
      return { code: "line_unreadable", error: `couldn't verify the SMS line (${error.message})`, status: 503 };
    }
    if (!data) {
      return { code: "line_not_found", error: `SMS line ${requestedLineId} doesn't exist.`, status: 400 };
    }
    if (!(data as { is_active: boolean }).is_active) {
      const d = data as { label: string | null; phone: string };
      return {
        code: "line_inactive",
        error: `The line you picked (${d.label ?? d.phone}) is inactive — pick an active line.`,
        status: 400,
      };
    }
    return { lineId: (data as { id: string }).id };
  }

  const { data, error } = await db
    .from("sms_lines").select("id").eq("is_default", true).eq("is_active", true).maybeSingle();
  if (error) {
    return { code: "line_unreadable", error: `couldn't resolve the default SMS line (${error.message})`, status: 503 };
  }
  if (!data) {
    return {
      code: "no_active_line",
      error: "No active default SMS line is configured, so there's nothing to send from.",
      status: 503,
    };
  }
  return { lineId: (data as { id: string }).id };
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
    | { to?: string; body?: string; customer_id?: string; line_id?: string; media_url?: string }
    | null;
  if (!payload) return fail("bad_request", "Invalid JSON body", 400);

  const rawTo = (payload.to ?? "").trim();
  const body = (payload.body ?? "").trim();
  const customerId = (payload.customer_id ?? "").trim() || null;
  const requestedLineId = (payload.line_id ?? "").trim() || null;
  const rawMediaUrl = (payload.media_url ?? "").trim() || null;

  // media_url turns this into a picture message and is validated hard (it becomes
  // a gateway fetch target). A media-only send is allowed, so the empty-body
  // refusal only fires when there is NEITHER text NOR media.
  let mediaUrl: string | null = null;
  if (rawMediaUrl) {
    const v = validateMediaUrl(rawMediaUrl);
    if ("error" in v) return fail("bad_media", `Not queued — ${v.error}`, 400);
    mediaUrl = v.url;
  }

  if (!body && !mediaUrl) {
    return fail("empty_body", "Write a message or attach an image first — nothing was queued.", 400);
  }
  if (body.length > MAX_CHARS) {
    return fail("too_long",
      `That message is ${body.length} characters — the limit is ${MAX_CHARS}.`, 400);
  }

  // COMPLIANCE GATE. An MCA is not a loan; the word cannot go out on our line.
  // (A caption on a picture message is still merchant-facing text.)
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

  // ── Guard 3: which line does this go out from? Fails closed on an unreadable
  //    lookup, and refuses a missing/inactive line rather than swapping in the
  //    default. Resolved LAST so a blocked send never touches the line registry. ──
  const line = await resolveLine(db, requestedLineId);
  if ("error" in line) {
    return fail(line.code, `Not queued — ${line.error}`, line.status);
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
      media_url: mediaUrl,
      status: "queued",
      created_by: caller.id,
      line_id: line.lineId,
    })
    .select("id, status, customer_id, line_id")
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
      content: `${body.slice(0, MAX_CHARS)}${mediaUrl ? `${body ? "\n" : ""}[image: ${mediaUrl}]` : ""}\n[jmp:queued sms_message:${inserted.id}]`,
      logged_by: caller.id,
    }).then(() => {}, () => {});
  }

  return json({
    ok: true,
    id: inserted.id,
    status: inserted.status ?? "queued",
    phone,
    customer_id: linkedCustomerId,
    line_id: (inserted.line_id as string | null) ?? line.lineId,
  });
});
