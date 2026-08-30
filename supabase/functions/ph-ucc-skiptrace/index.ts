// ph-ucc-skiptrace — the SKIP-TRACE stage of the PH UCC List Machine.
//
// Takes needs_skiptrace leads (debtor + filing address, no contact yet), calls
// BatchData.io property skip-trace, and appends persons/phones/emails onto
// ph_ucc_contacts + a lead-level summary. It NEVER dials and NEVER loads to GHL.
//
// HARD DNC RULE (conservative): every number BatchData returns is stored, but any
// number with dnc:true is flagged suppressed_dnc and is NEVER written to
// ph_ucc_leads.phone and NEVER exported to a dial CSV. A lead's dialable phone is
// only ever a NON-DNC, non-TCPA-litigator number. Post-trace status (STRAIGHT-THROUGH
// per the owner's decision — BatchData's DNC + TCPA-litigator suppression IS the
// compliance scrub, so a usable phone is already clean and needs no separate gate):
//   • ≥1 usable phone   → ready         (DNC + TCPA-litigator suppressed; ready to load)
//   • else ≥1 email     → email_only    (usable by the cold-email channel)
//   • else              → no_match      (no usable phone, no email)
//
// SPEND CONTROL: reads the wallet first; aborts loudly if balance < $5. Never
// traces more than `limit` leads per call (HARD 100 ceiling). Idempotent — a lead
// with traced_at set is skipped unless force:true.
//
// TARGETED SET: pass `lead_ids: string[]` to trace an EXACT set (the UI's filtered
// lead book passes the ids it shows, in batches of ≤100/call). The same hard
// safety still applies to every id: needs_skiptrace only, must have a street
// address, and never re-charged if already traced. When lead_ids is present the
// score/freshness filters are ignored (the UI already did that filtering).
//
// AUTH (mirrors ph-ucc-ingest): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.
//
// PHONE-DNC RE-CHECK: BatchData's skip-trace already returns a per-number dnc flag,
// so a separate /phone verification pass is redundant today. If a future provider
// omits dnc, add a phone-dnc re-check here before promoting to ready. (future)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient,
  getGhlConfig, getContact, listCustomFields, findFieldByName, updateContactCustomFields,
  type GhlConfig, type GhlCustomField,
} from "../_shared/ghl.ts";

const BATCH_BASE = "https://api.batchdata.com/api/v1";
const WALLET_PATH = "/wallet/balance";
const SKIPTRACE_PATH = "/property/skip-trace";

const MIN_BALANCE_USD = 5;      // abort a trace run below this
const BUDGET_MS = 55_000;       // stop starting new traces past this (platform kills ~60s)
const DEFAULT_LIMIT = 25;
const HARD_MAX_LIMIT = 100;     // never trace more than this in one call, whatever is asked
const DEFAULT_MAX_FRESHNESS_DAYS = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null; // Number(null)===0 would silently zero out defaults
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

// ── BatchData HTTP ────────────────────────────────────────────────────────────
async function batch(apiKey: string, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await fetch(`${BATCH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text.slice(0, 400) }; }
  return { ok: res.ok, status: res.status, body: parsed as Record<string, unknown> };
}

// Pull a numeric wallet balance out of BatchData's response, tolerating shape drift.
function parseBalance(b: Record<string, unknown>): number | null {
  const candidates = [
    (b as any)?.results?.balance,
    (b as any)?.results?.wallet?.balance,
    (b as any)?.results?.wallet?.amount,
    (b as any)?.data?.balance,
    (b as any)?.wallet?.balance,
    (b as any)?.balance,
    (b as any)?.results?.availableBalance,
  ];
  for (const c of candidates) { const n = num(c); if (n != null) return n; }
  return null;
}

async function getBalance(apiKey: string): Promise<{ balance: number | null; raw: Record<string, unknown>; ok: boolean; status: number }> {
  const r = await batch(apiKey, "GET", WALLET_PATH);
  return { balance: parseBalance(r.body), raw: r.body, ok: r.ok, status: r.status };
}

// ── Skip-trace response normalization ─────────────────────────────────────────
type Phone = {
  number: string; type: string | null; dnc: boolean; score: number | null;
  suppressed_dnc: boolean;
  tcpa_litigator: boolean;   // the owning person is a known TCPA litigator (person-level flag)
  suppressed_tcpa: boolean;  // person is a litigator OR person-level dnc.tcpa=true → never dialable
};
type Person = { person_name: string | null; phones: Phone[]; emails: string[]; raw: unknown };

function personsFrom(b: Record<string, unknown>): any[] {
  const r: any = b;
  return (
    r?.results?.persons ??
    r?.results?.[0]?.persons ??
    r?.persons ??
    r?.data?.persons ??
    (Array.isArray(r?.results) ? r.results.flatMap((x: any) => x?.persons ?? []) : null) ??
    []
  );
}

function nameFrom(p: any): string | null {
  const n = p?.name ?? p?.fullName ?? p?.full_name;
  if (typeof n === "string") return clean(n);
  if (n && typeof n === "object") {
    return clean(n.full ?? n.fullName ?? [n.first, n.middle, n.last].filter(Boolean).join(" "));
  }
  return clean([p?.firstName, p?.lastName].filter(Boolean).join(" "));
}

// TCPA is a PERSON-level signal on BatchData's skip-trace response (verified against our
// stored raw): `litigator` (bool) + `dnc: {tcpa: bool}` — NOT on the phone object. We fold
// both into one per-person suppression flag and stamp it onto every number the person owns,
// so a litigator's numbers can never surface as a dialable best_phone.
function personTcpa(p: any): { litigator: boolean; suppressed: boolean } {
  const litigator = p?.litigator === true || p?.litigator === "true";
  const dncTcpa = p?.dnc?.tcpa === true || p?.dnc?.tcpa === "true";
  return { litigator, suppressed: litigator || dncTcpa };
}

function phonesFrom(p: any): Phone[] {
  const arr: any[] = p?.phoneNumbers ?? p?.phones ?? [];
  const { litigator, suppressed } = personTcpa(p);
  const out: Phone[] = [];
  for (const ph of arr) {
    const number = clean(ph?.number ?? ph?.phoneNumber ?? ph);
    if (!number) continue;
    const dnc = ph?.dnc === true || ph?.dnc === "true" || ph?.doNotCall === true;
    out.push({
      number,
      type: clean(ph?.type ?? ph?.phoneType),
      dnc,
      score: num(ph?.score ?? ph?.reachability ?? ph?.confidence),
      suppressed_dnc: dnc,
      tcpa_litigator: litigator,
      suppressed_tcpa: suppressed,
    });
  }
  return out;
}

function emailsFrom(p: any): string[] {
  const arr: any[] = p?.emails ?? p?.emailAddresses ?? [];
  const out: string[] = [];
  for (const e of arr) {
    const email = clean(typeof e === "string" ? e : (e?.email ?? e?.address));
    if (email) out.push(email);
  }
  return out;
}

function personViewFromRaw(p: any): Person {
  return { person_name: nameFrom(p), phones: phonesFrom(p), emails: emailsFrom(p), raw: p };
}

function normalizePersons(b: Record<string, unknown>): Person[] {
  return personsFrom(b).map(personViewFromRaw);
}

// Aggregate a lead's persons into the lead-level summary. SHARED by the live trace and the
// no-spend reparse, so forward and retroactive logic can never diverge. A number is DIALABLE
// only when it is neither DNC nor TCPA-suppressed (litigator / person-level dnc.tcpa).
function aggregate(persons: Person[]) {
  const anyPerson = persons.some((p) => p.person_name || p.phones.length || p.emails.length);
  const allPhones = persons.flatMap((p) => p.phones);
  const allEmails = Array.from(new Set(persons.flatMap((p) => p.emails)));
  const usablePhones = allPhones.filter((p) => !p.dnc && !p.suppressed_tcpa);
  const dncPhones = allPhones.filter((p) => p.dnc);
  const tcpaPhones = allPhones.filter((p) => p.suppressed_tcpa);

  // best dialable = highest score among neither-DNC-nor-TCPA numbers (nulls last)
  const bestPhoneObj = usablePhones.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] ?? null;
  const bestPhone = bestPhoneObj?.number ?? null;
  const bestPhoneType = bestPhoneObj?.type ?? null;
  const bestPhoneDnc = bestPhoneObj ? bestPhoneObj.dnc : null;   // usable ⇒ false; null when no dialable number
  const bestEmail = allEmails[0] ?? null;
  const primaryName = persons.find((p) => p.person_name)?.person_name ?? null;

  // PERSON-level TCPA signal (litigator OR dnc.tcpa), independent of whether the person
  // had any phones — promoted to the queryable ph_ucc_leads.tcpa_litigator column.
  const tcpaLitigator = persons.some((p) => personTcpa(p.raw).suppressed);

  // STRAIGHT-THROUGH: a usable phone (neither DNC nor TCPA-litigator) is already
  // compliance-clean per the owner's Option-A decision, so it goes straight to
  // `ready` (loadable/dialable) — no separate needs_scrub cell-scrub gate.
  const status: "ready" | "email_only" | "no_match" =
    usablePhones.length > 0 ? "ready" : allEmails.length > 0 ? "email_only" : "no_match";

  // "What the scrub removed" fragment. Names a category ONLY when a number in it was
  // actually pulled — DNC only when dncPhones.length>0, litigator only when
  // tcpaPhones.length>0. It counts NUMBERS removed; it never labels the PERSON a
  // litigator (that person-level flag would only matter on a lead with zero usable
  // numbers, and even then we don't imply the human is a litigator on a ready lead).
  const removedParts: string[] = [];
  if (dncPhones.length) removedParts.push(`${dncPhones.length} DNC`);
  if (tcpaPhones.length) removedParts.push(`${tcpaPhones.length} litigator`);
  const removedList = removedParts.join(" + ");

  const statusReason =
    status === "ready"
      // OUTCOME first. Suppression clause appended ONLY when something was removed,
      // so a clean ready lead reads simply "Ready to dial — N usable number(s)."
      ? `Ready to dial — ${usablePhones.length} usable number(s).` +
        (removedList ? ` ${removedList} number(s) removed by BatchData scrub.` : "")
    : status === "email_only"
      ? `No dialable number (${removedList ? `${removedList} number(s) removed` : "none found"}); ` +
        `${allEmails.length} email(s) found — routed to cold email.`
    : anyPerson
      ? `Person matched but no usable number or email.` +
        (removedList ? ` ${removedList} number(s) removed by BatchData scrub.` : "")
      : `No skip-trace match for this address.`;

  return { anyPerson, allPhones, allEmails, usablePhones, dncPhones, tcpaPhones, bestPhone, bestPhoneType, bestPhoneDnc, bestEmail, primaryName, tcpaLitigator, status, statusReason };
}

// The exact smart_list_members patch for an aggregated skip-trace result. ONE builder
// shared by the ph_ucc lead mirror (matched by source/source_id) and the generalized
// member path (matched by member id), so the member view can never drift from the lead
// view. Captures the raw persons array too, so enrichment survives the smart_list cascade.
function skiptraceMemberPatch(persons: Person[], agg: ReturnType<typeof aggregate>, nowIso: string) {
  return {
    skiptrace_raw: persons.map((p) => p.raw),
    best_phone: agg.bestPhone,
    best_phone_type: agg.bestPhoneType,
    best_phone_dnc: agg.bestPhoneDnc,
    best_email: agg.bestEmail,
    person_name: agg.primaryName,
    phones: agg.allPhones,
    emails: agg.allEmails,
    tcpa_litigator: agg.tcpaLitigator,
    dnc_suppressed_count: agg.dncPhones.length,
    skiptraced_at: nowIso,
  };
}

// Mirror a lead's aggregated skip-trace result onto any smart_list_members that point
// at it (source='ph_ucc', source_id = lead.id as text). Best-effort, LOUD on failure —
// never blocks the lead write.
async function mirrorSkiptraceToMembers(
  db: SupabaseClient, leadId: string, persons: Person[], agg: ReturnType<typeof aggregate>, nowIso: string,
) {
  const { error } = await db.from("smart_list_members")
    .update(skiptraceMemberPatch(persons, agg, nowIso))
    .eq("source", "ph_ucc").eq("source_id", leadId);
  if (error) console.error("[ph-ucc-skiptrace] smart_list_members mirror failed", JSON.stringify({ lead_id: leadId, error: error.message }));
}

// Persist a ph_ucc lead's skip-trace result to its DURABLE rows: replace ph_ucc_contacts,
// update ph_ucc_leads, and mirror onto any smart_list_members. SHARED by the lead-book
// trace loop and the smart-list member path (source='ph_ucc'), so a ph_ucc member trace
// writes back exactly like a lead trace — no drift between the two entry points.
async function persistLeadTrace(
  db: SupabaseClient, leadId: string, persons: Person[], agg: ReturnType<typeof aggregate>, nowIso: string,
): Promise<{ ok: boolean; error?: string }> {
  // Replace any prior contact rows for this lead (idempotent re-trace on force).
  await db.from("ph_ucc_contacts").delete().eq("lead_id", leadId);
  if (persons.length > 0) {
    const rows = persons.map((p, i) => ({
      lead_id: leadId,
      person_name: p.person_name,
      is_primary: i === 0,
      phones: p.phones,
      emails: p.emails,
      trace_match: !!(p.person_name || p.phones.length || p.emails.length),
      provider: "batchdata",
      raw: p.raw,
      traced_at: nowIso,
    }));
    const { error: cErr } = await db.from("ph_ucc_contacts").insert(rows);
    if (cErr) return { ok: false, error: `contacts insert: ${cErr.message}` };
  }
  const { error: uErr } = await db.from("ph_ucc_leads").update({
    phone: agg.bestPhone,           // NON-DNC only, or null
    email: agg.bestEmail,
    person_name: agg.primaryName,
    traced_at: nowIso,
    trace_match: agg.anyPerson,
    tcpa_litigator: agg.tcpaLitigator,        // person-level litigator / dnc.tcpa (now queryable)
    dnc_suppressed_count: agg.dncPhones.length, // # of DNC numbers pulled & suppressed
    status: agg.status,
    status_reason: agg.statusReason,
  }).eq("id", leadId);
  if (uErr) return { ok: false, error: `lead update: ${uErr.message}` };

  await mirrorSkiptraceToMembers(db, leadId, persons, agg, nowIso);
  return { ok: true };
}

// ── Generalized smart-list member path (any source) ─────────────────────────────
// The Data Hygiene smart list can hold members from FOUR sources. Skip-trace needs a
// mailing ADDRESS, so the enrichment INPUT is resolved from each member's real SOURCE
// row (not the thin snapshot), then BatchData runs on that address. Results are written
// to the member row AND written back durably to the source (ph_ucc_leads/contacts,
// lead_records.skiptrace_raw, customers.skiptrace_raw, or the GHL contact's custom fields).

type MemberRow = { id: string; source: string; source_id: string; snapshot: Record<string, unknown> | null; skiptraced_at: string | null };
type Addr = { name: string | null; street: string | null; city: string | null; state: string | null; zip: string | null };

// Lazily-resolved GHL context: cfg (for reading a source='ghl' contact's address) plus
// the REUSED custom-field ids for write-back (never creates fields, per ghl-custom-field-traps).
type GhlSkipCtx = {
  cfg: GhlConfig | null;
  ids: { best_phone?: string; best_email?: string; person_name?: string; dnc?: string; tcpa?: string };
  matched: Record<string, string>;
  missing: string[];
  error: string | null;
};

async function resolveGhlSkipCtx(db: SupabaseClient): Promise<GhlSkipCtx> {
  const ctx: GhlSkipCtx = { cfg: null, ids: {}, matched: {}, missing: [], error: null };
  try { ctx.cfg = await getGhlConfig(db); } catch (e) { ctx.error = e instanceof Error ? e.message : String(e); return ctx; }
  const res = await listCustomFields(ctx.cfg);
  if (!res.ok || !res.data) { ctx.error = `listCustomFields failed: ${res.error ?? res.status}`; return ctx; }
  const fields: GhlCustomField[] = res.data.customFields ?? [];
  const find = (...terms: string[]): GhlCustomField | undefined => {
    for (const t of terms) { const f = findFieldByName(fields, t); if (f) return f; }
    return undefined;
  };
  const put = (key: keyof GhlSkipCtx["ids"], f: GhlCustomField | undefined) => {
    if (f) { ctx.ids[key] = f.id; ctx.matched[key] = f.name; } else ctx.missing.push(key);
  };
  put("best_phone", find("best phone", "skip trace phone", "skiptrace phone"));
  put("best_email", find("best email", "skip trace email", "skiptrace email"));
  put("person_name", find("owner name", "person name", "contact name"));
  put("dnc", find("do not call", "dnc"));
  put("tcpa", find("litigator", "tcpa"));
  return ctx;
}

async function writeGhlSkipContact(
  ctx: GhlSkipCtx, contactId: string, agg: ReturnType<typeof aggregate>,
): Promise<{ ok: boolean; error: string | null }> {
  if (!ctx.cfg) return { ok: false, error: ctx.error ?? "GHL not configured" };
  const fields: Array<{ id: string; value: string | number }> = [];
  if (ctx.ids.best_phone && agg.bestPhone != null) fields.push({ id: ctx.ids.best_phone, value: agg.bestPhone });
  if (ctx.ids.best_email && agg.bestEmail != null) fields.push({ id: ctx.ids.best_email, value: agg.bestEmail });
  if (ctx.ids.person_name && agg.primaryName != null) fields.push({ id: ctx.ids.person_name, value: agg.primaryName });
  if (ctx.ids.dnc && agg.dncPhones.length > 0) fields.push({ id: ctx.ids.dnc, value: "true" });
  if (ctx.ids.tcpa && agg.tcpaLitigator != null) fields.push({ id: ctx.ids.tcpa, value: agg.tcpaLitigator ? "true" : "false" });
  if (fields.length === 0) return { ok: true, error: null };
  const res = await updateContactCustomFields(ctx.cfg, contactId, fields);
  if (!res.ok) return { ok: false, error: res.error ?? `status ${res.status}` };
  return { ok: true, error: null };
}

// Resolve the skip-trace INPUT (name + mailing address) from a member's real source row.
// Returns null when the source row is gone. Missing street is left null (caller reports no_address).
async function resolveSkiptraceInput(db: SupabaseClient, m: MemberRow, ghlCfg: GhlConfig | null): Promise<Addr | null> {
  const sid = m.source_id;
  if (m.source === "ph_ucc") {
    const { data } = await db.from("ph_ucc_leads")
      .select("debtor_name,debtor_address,debtor_city,debtor_state,debtor_zip").eq("id", sid).maybeSingle();
    if (!data) return null;
    return { name: clean(data.debtor_name), street: clean(data.debtor_address), city: clean(data.debtor_city), state: clean(data.debtor_state), zip: clean(data.debtor_zip) };
  }
  if (m.source === "lead_records") {
    const { data } = await db.from("lead_records")
      .select("first_name,last_name,company,address,city,state,zip").eq("id", sid).maybeSingle();
    if (!data) return null;
    return {
      name: clean([data.first_name, data.last_name].filter(Boolean).join(" ")) ?? clean(data.company),
      street: clean(data.address), city: clean(data.city), state: clean(data.state), zip: clean(data.zip),
    };
  }
  if (m.source === "customers") {
    const { data } = await db.from("customers")
      .select("first_name,last_name,business_name,address_street,address_city,address_state,address_zip").eq("id", sid).maybeSingle();
    if (!data) return null;
    return {
      name: clean([data.first_name, data.last_name].filter(Boolean).join(" ")) ?? clean(data.business_name),
      street: clean(data.address_street), city: clean(data.address_city), state: clean(data.address_state), zip: clean(data.address_zip),
    };
  }
  if (m.source === "ghl") {
    if (!ghlCfg) return null;
    const got = await getContact(ghlCfg, sid);
    const c = got.data?.contact as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = clean([c.firstName, c.lastName].filter(Boolean).join(" ")) ?? clean(c.contactName) ?? clean(c.companyName);
    return { name, street: clean(c.address1), city: clean(c.city), state: clean(c.state), zip: clean(c.postalCode) };
  }
  return null;
}

// Skip-trace an EXACT set of smart_list_members across ANY source. Same spend controls
// as the lead path (wallet floor + BUDGET_MS budget + idempotent skiptraced_at guard +
// the HARD_MAX cap the caller already applied). Never spends on a member without a
// resolvable street address (no_address), and never re-charges an already-traced member
// unless force. Returns the JSON Response.
async function traceMembers(
  db: SupabaseClient, apiKey: string, memberIds: string[], force: boolean, started: number,
): Promise<Response> {
  // 1) Wallet gate — abort loudly if we can't afford to spend.
  const w0 = await getBalance(apiKey);
  if (!w0.ok) return json({ ok: false, error: "wallet lookup failed before trace", status: w0.status, raw: w0.raw }, 502);
  if (w0.balance == null) return json({ ok: false, error: "could not parse wallet balance — aborting for safety", raw: w0.raw }, 502);
  if (w0.balance < MIN_BALANCE_USD) {
    return json({ ok: false, error: `BatchData wallet balance $${w0.balance} is below the $${MIN_BALANCE_USD} floor — top up before tracing.`, balance: w0.balance }, 402);
  }

  // 2) Select the members. Idempotent: never re-trace one that already has skiptraced_at
  // unless force. (Selection is by member id; the caller already hard-capped the set.)
  let mq = db.from("smart_list_members")
    .select("id,source,source_id,snapshot,skiptraced_at")
    .in("id", memberIds);
  if (!force) mq = mq.is("skiptraced_at", null);
  const { data: memberData, error: memberErr } = await mq;
  if (memberErr) return json({ ok: false, error: `member select failed: ${memberErr.message}` }, 500);
  const members = (memberData as MemberRow[]) ?? [];
  if (members.length === 0) {
    return json({ ok: true, traced: 0, message: "No members matched (already traced, or ids not found).", balance_before: w0.balance });
  }

  // Resolve the GHL context ONCE up front — but only if a source='ghl' member is present
  // (avoids a GHL round-trip for pure-DB batches). Needed both to READ a GHL contact's
  // address and to WRITE the verdict back to its REUSED custom fields.
  const ghlResolved = members.some((m) => m.source === "ghl");
  const ghlCtx: GhlSkipCtx | null = ghlResolved ? await resolveGhlSkipCtx(db) : null;
  if (ghlCtx?.error) console.error("[ph-ucc-skiptrace] GHL context unavailable", JSON.stringify({ error: ghlCtx.error }));

  const perMember: Record<string, unknown>[] = [];
  let traced = 0, ready = 0, emailOnly = 0, noMatch = 0, noAddress = 0, errored = 0;
  let srcWriteback = 0, ghlWriteback = 0;

  for (const m of members) {
    if (Date.now() - started > BUDGET_MS) break; // leave the rest for the next call

    const addr = await resolveSkiptraceInput(db, m, ghlCtx?.cfg ?? null);
    if (!addr || !addr.street) {
      // Never spend on an un-trace-able record.
      noAddress++;
      perMember.push({ member_id: m.id, source: m.source, skipped: "no_address" });
      continue;
    }

    const propertyAddress: Record<string, string> = { street: addr.street };
    if (addr.city) propertyAddress.city = addr.city;
    if (addr.state) propertyAddress.state = addr.state;
    if (addr.zip) propertyAddress.zip = addr.zip;

    const r = await batch(apiKey, "POST", SKIPTRACE_PATH, { requests: [{ propertyAddress }] });
    if (!r.ok) {
      errored++;
      perMember.push({ member_id: m.id, source: m.source, error: `skip-trace ${r.status}`, detail: r.body });
      continue;
    }

    const persons = normalizePersons(r.body);
    const agg = aggregate(persons);
    const nowIso = new Date().toISOString();

    if (m.source === "ph_ucc") {
      // Durable ph_ucc rows + member mirror, exactly like the lead path.
      const res = await persistLeadTrace(db, m.source_id, persons, agg, nowIso);
      if (!res.ok) { errored++; perMember.push({ member_id: m.id, source: m.source, error: res.error }); continue; }
      srcWriteback++;
    } else {
      // Write the member row directly (by id).
      const { error: mErr } = await db.from("smart_list_members")
        .update(skiptraceMemberPatch(persons, agg, nowIso)).eq("id", m.id);
      if (mErr) { errored++; perMember.push({ member_id: m.id, source: m.source, error: `member update: ${mErr.message}` }); continue; }

      // Durable write-back to the source row (survives the smart_list cascade).
      if (m.source === "lead_records") {
        const { error: lErr } = await db.from("lead_records").update({ skiptrace_raw: persons.map((p) => p.raw) }).eq("id", m.source_id);
        if (lErr) console.error("[ph-ucc-skiptrace] lead_records write-back failed", JSON.stringify({ id: m.source_id, error: lErr.message }));
        else srcWriteback++;
      } else if (m.source === "customers") {
        const { error: lErr } = await db.from("customers").update({ skiptrace_raw: persons.map((p) => p.raw) }).eq("id", m.source_id);
        if (lErr) console.error("[ph-ucc-skiptrace] customers write-back failed", JSON.stringify({ id: m.source_id, error: lErr.message }));
        else srcWriteback++;
      } else if (m.source === "ghl") {
        // GHL is the CRM system of record — write key skip-trace fields to REUSED custom
        // fields (never create fields). source_id is the ghl_contact_id.
        if (ghlCtx) {
          const w = await writeGhlSkipContact(ghlCtx, m.source_id, agg);
          if (!w.ok) console.error("[ph-ucc-skiptrace] GHL contact write-back failed", JSON.stringify({ contact_id: m.source_id, error: w.error }));
          else ghlWriteback++;
        }
      }
    }

    if (agg.status === "ready") ready++;
    else if (agg.status === "email_only") emailOnly++;
    else noMatch++;
    traced++;
    perMember.push({
      member_id: m.id, source: m.source, person: agg.primaryName, persons: persons.length,
      phones_total: agg.allPhones.length, dialable: agg.usablePhones.length,
      dnc_suppressed: agg.dncPhones.length, tcpa_suppressed: agg.tcpaPhones.length,
      emails: agg.allEmails.length, status: agg.status,
    });
  }

  // Cost = actual wallet delta this run; distribute as a per-member estimate for the
  // response. NOT stamped onto smart_list_members.validation_cost — that column is the
  // phone-validation lookup cost (phone-validate owns it) and must not be clobbered here.
  const w1 = await getBalance(apiKey);
  const runSpend = w0.balance != null && w1.balance != null ? Math.max(0, Math.round((w0.balance - w1.balance) * 10000) / 10000) : null;
  const perLeadCost = runSpend != null && traced > 0 ? Math.round((runSpend / traced) * 10000) / 10000 : null;

  return json({
    ok: true,
    provider: "batchdata",
    mode: "members",
    requested_ids: memberIds.length,
    candidates: members.length,
    traced, ready, email_only: emailOnly, no_match: noMatch, no_address: noAddress, errored,
    source_writeback: srcWriteback, ghl_writeback: ghlWriteback,
    ghl_field_map: ghlResolved ? (ghlCtx && ghlCtx.cfg ? { matched: ghlCtx.matched, missing_skipped: ghlCtx.missing } : { unavailable: ghlCtx?.error }) : null,
    balance_before: w0.balance, balance_after: w1.balance, run_spend_usd: runSpend, per_lead_cost_est: perLeadCost,
    elapsed_ms: Date.now() - started,
    per_member: perMember,
  });
}

// ── Lead selection: fresh-first, high-score-first, spend-capped ────────────────
type Lead = {
  id: string; debtor_name: string | null; state: string | null;
  debtor_address: string | null; debtor_city: string | null;
  debtor_state: string | null; debtor_zip: string | null;
  score: number | null; freshness_days: number | null;
};

async function pickLeads(
  db: SupabaseClient, limit: number, minScore: number | null, maxFreshnessDays: number, force: boolean,
  leadIds?: string[] | null,
): Promise<Lead[]> {
  let q = db.from("ph_ucc_leads")
    .select("id,debtor_name,state,debtor_address,debtor_city,debtor_state,debtor_zip,score,freshness_days")
    .eq("status", "needs_skiptrace")        // SAFETY: only ever trace needs_skiptrace leads
    .not("debtor_address", "is", null)      // need a street to skip-trace an address
    .order("freshness_days", { ascending: true, nullsFirst: false }) // FRESH first
    .order("score", { ascending: false, nullsFirst: false })          // then high-score
    .limit(limit);
  if (leadIds && leadIds.length) {
    // Explicit set from the UI's filtered lead book. Trace exactly these — but the
    // needs_skiptrace + address + (below) idempotent traced_at safety still holds,
    // so an id that's already been traced or isn't eligible is silently dropped,
    // never re-charged. Score/freshness filters are intentionally NOT applied here.
    q = q.in("id", leadIds);
  } else {
    q = q.lte("freshness_days", maxFreshnessDays);
    if (minScore != null) q = q.gte("score", minScore);
  }
  if (!force) q = q.is("traced_at", null);   // idempotent: never re-trace
  const { data, error } = await q;
  if (error) throw new Error(`pickLeads failed: ${error.message}`);
  return (data as Lead[]) ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* GET/cron */ }
  const action = String(payload.action ?? url.searchParams.get("action") ?? "trace").toLowerCase();

  // API key from the vault (server-side only; never logged).
  const { data: apiKey, error: keyErr } = await db.rpc("get_ph_skiptrace_key");
  if (keyErr || !apiKey || typeof apiKey !== "string") {
    return json({ ok: false, error: "PH_SKIPTRACE_API_KEY missing from vault" }, 500);
  }

  // ── Wallet mode: the dashboard's remaining-spend tile ──
  if (action === "wallet") {
    const w = await getBalance(apiKey);
    if (!w.ok) return json({ ok: false, action: "wallet", status: w.status, error: "wallet lookup failed", raw: w.raw }, 502);
    return json({ ok: true, action: "wallet", provider: "batchdata", balance: w.balance, currency: "USD" });
  }

  const started = Date.now();
  const force = payload.force === true || url.searchParams.get("force") === "true";
  const debug = payload.debug === true || url.searchParams.get("debug") === "true";

  // ── Reparse mode: recompute phones[]/best_phone/status from STORED ph_ucc_contacts.raw,
  // with NO BatchData call and NO spend. Backfills TCPA-litigator suppression across leads
  // that were traced before that flag was parsed. Reuses the SAME phonesFrom/aggregate path
  // as a live trace, so a reparse and a re-trace yield identical results. Not gated by
  // skiptrace_enabled (it doesn't spend) and doesn't touch the wallet.
  if (action === "reparse") {
    const rpLimit = Math.max(1, Math.min(2000, Math.floor(num(payload.limit ?? url.searchParams.get("limit")) ?? 500)));
    const maxFresh = num(payload.max_freshness_days ?? url.searchParams.get("max_freshness_days"));
    let lq = db.from("ph_ucc_leads").select("id,debtor_name,status,phone")
      .not("traced_at", "is", null)
      // Never downgrade a human/terminal decision: leave loaded/ready/suppressed leads
      // untouched even though they're traced. reparse only re-derives parked contact data.
      .not("status", "in", "(loaded,ready,suppressed)")
      .order("freshness_days", { ascending: true, nullsFirst: false })
      .limit(rpLimit);
    if (maxFresh != null) lq = lq.lte("freshness_days", maxFresh);
    const { data: rpLeads, error: rpErr } = await lq;
    if (rpErr) return json({ ok: false, error: `reparse select failed: ${rpErr.message}` }, 500);

    let scanned = 0, changed = 0, phoneCleared = 0, statusChanged = 0, litigatorLeads = 0, errored = 0;
    const details: Record<string, unknown>[] = [];
    for (const lead of (rpLeads ?? []) as Array<{ id: string; debtor_name: string | null; status: string; phone: string | null }>) {
      if (Date.now() - started > BUDGET_MS) break;
      const { data: crows } = await db.from("ph_ucc_contacts").select("id,raw").eq("lead_id", lead.id);
      const rows = (crows ?? []) as Array<{ id: string; raw: any }>;
      if (rows.length === 0) continue;
      scanned++;

      const persons: Person[] = rows.map((cr) => personViewFromRaw(cr.raw));
      const agg = aggregate(persons);
      if (agg.tcpaPhones.length > 0) litigatorLeads++;

      // Rewrite each contact row's phones with the recomputed (TCPA-stamped) array.
      for (let i = 0; i < rows.length; i++) {
        const { error: cuErr } = await db.from("ph_ucc_contacts").update({ phones: persons[i].phones }).eq("id", rows[i].id);
        if (cuErr) { errored++; details.push({ lead_id: lead.id, error: `contact update: ${cuErr.message}` }); }
      }

      const clearsPhone = lead.phone != null && agg.bestPhone == null;
      const movesStatus = agg.status !== lead.status;
      if (clearsPhone) phoneCleared++;
      if (movesStatus) statusChanged++;

      const { error: luErr } = await db.from("ph_ucc_leads").update({
        phone: agg.bestPhone, email: agg.bestEmail, person_name: agg.primaryName,
        tcpa_litigator: agg.tcpaLitigator, dnc_suppressed_count: agg.dncPhones.length,
        status: agg.status, status_reason: agg.statusReason,
      }).eq("id", lead.id);
      if (luErr) { errored++; details.push({ lead_id: lead.id, error: `lead update: ${luErr.message}` }); continue; }

      // Keep any smart_list_members in sync with the reparsed enrichment too.
      await mirrorSkiptraceToMembers(db, lead.id, persons, agg, new Date().toISOString());

      if (clearsPhone || movesStatus || agg.tcpaPhones.length > 0) {
        changed++;
        details.push({
          lead_id: lead.id, debtor: lead.debtor_name,
          tcpa_suppressed: agg.tcpaPhones.length, dnc_suppressed: agg.dncPhones.length,
          phone_cleared: clearsPhone, status: movesStatus ? `${lead.status} -> ${agg.status}` : agg.status,
        });
      }
    }
    return json({
      ok: true, action: "reparse", scanned, changed,
      phone_cleared: phoneCleared, status_changed: statusChanged, litigator_leads: litigatorLeads, errored,
      elapsed_ms: Date.now() - started, details,
    });
  }

  // ── Reword mode: rewrite ONLY status_reason from STORED ph_ucc_contacts.raw, with NO
  // BatchData call, NO spend, and — unlike reparse — NO status/phone/email/phones change.
  // It exists to refresh the human-readable copy on leads traced before the reason wording
  // was fixed, INCLUDING ready/loaded/suppressed leads that reparse deliberately skips.
  // It recomputes the reason via the SAME aggregate() the trace uses, then writes only that
  // one string. offset+limit let the caller page through the whole traced book across calls.
  if (action === "reword") {
    const rwLimit = Math.max(1, Math.min(2000, Math.floor(num(payload.limit ?? url.searchParams.get("limit")) ?? 500)));
    const rwOffset = Math.max(0, Math.floor(num(payload.offset ?? url.searchParams.get("offset")) ?? 0));
    const { data: rwLeads, error: rwErr } = await db.from("ph_ucc_leads")
      .select("id,status,status_reason")
      .not("traced_at", "is", null)                 // only already-traced leads (no spend, nothing to trace)
      .order("traced_at", { ascending: true, nullsFirst: false })
      .range(rwOffset, rwOffset + rwLimit - 1);
    if (rwErr) return json({ ok: false, error: `reword select failed: ${rwErr.message}` }, 500);

    let scanned = 0, updated = 0, noContacts = 0, errored = 0;
    for (const lead of (rwLeads ?? []) as Array<{ id: string; status: string; status_reason: string | null }>) {
      if (Date.now() - started > BUDGET_MS) break;
      const { data: crows } = await db.from("ph_ucc_contacts").select("raw").eq("lead_id", lead.id);
      const rows = (crows ?? []) as Array<{ raw: any }>;
      if (rows.length === 0) { noContacts++; continue; }
      scanned++;
      const persons: Person[] = rows.map((cr) => personViewFromRaw(cr.raw));
      const agg = aggregate(persons);                // recompute — but we ONLY read agg.statusReason
      if (agg.statusReason === lead.status_reason) continue;   // already correct — skip write
      // SAFETY: update ONLY status_reason. Never status/phone/email/phones — this is copy-only.
      const { error: uErr } = await db.from("ph_ucc_leads").update({ status_reason: agg.statusReason }).eq("id", lead.id);
      if (uErr) { errored++; continue; }
      updated++;
    }
    const returned = (rwLeads ?? []).length;
    return json({
      ok: true, action: "reword", offset: rwOffset, limit: rwLimit,
      returned, scanned, updated, no_contacts: noContacts, errored,
      next_offset: returned === rwLimit ? rwOffset + rwLimit : null,   // null = end of the book
      elapsed_ms: Date.now() - started,
    });
  }

  // Owner-controlled gate flags, live-read from ph_settings every call (no redeploy
  // needed when the owner flips a toggle in the settings panel). skiptrace_enabled
  // is the master on/off for this stage; max_skiptrace_batch lets the owner lower
  // the per-call cap below our HARD_MAX_LIMIT ceiling.
  const { data: phSettings } = await db.from("platform_settings").select("value").eq("key", "ph_settings").maybeSingle();
  const settingsVal = (phSettings?.value ?? {}) as Record<string, unknown>;
  const skiptraceEnabled = settingsVal.skiptrace_enabled;   // undefined = treat as on (default true)
  const maxBatch = num(settingsVal.max_skiptrace_batch) ?? 300;

  // Enable-gate — a false flag pauses the stage (force:true is the manual override).
  if (skiptraceEnabled === false && !force) {
    return json({ ok: true, skipped: true, reason: "ph_settings.skiptrace_enabled is false — stage paused by owner. Pass force:true to override." });
  }

  // ── Generalized member path: skip-trace an EXACT set of smart_list_members of ANY
  // source (ph_ucc, lead_records, customers, ghl). Hard-capped to HARD_MAX_LIMIT here
  // too, so no caller can push more than the ceiling into a single call. Same wallet /
  // budget / idempotency / no-address safety as the lead path (all inside traceMembers).
  const memberIdsRaw = (payload as { smart_list_member_ids?: unknown }).smart_list_member_ids;
  const memberIds = Array.isArray(memberIdsRaw)
    ? memberIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, HARD_MAX_LIMIT)
    : null;
  if (memberIds && memberIds.length) {
    try {
      return await traceMembers(db, apiKey, memberIds, force, started);
    } catch (e) {
      console.error("[ph-ucc-skiptrace] member path FAILED", e instanceof Error ? e.message : String(e));
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // Explicit id set (from the filtered lead book). Hard-capped to 100 here too, so
  // no caller can ever push more than the ceiling into a single call.
  const leadIdsRaw = (payload as { lead_ids?: unknown }).lead_ids;
  const leadIds = Array.isArray(leadIdsRaw)
    ? leadIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, HARD_MAX_LIMIT)
    : null;

  // When lead_ids is present the default cap is the set size; otherwise DEFAULT_LIMIT.
  const rawLimit = num(payload.limit ?? url.searchParams.get("limit")) ?? (leadIds ? leadIds.length : DEFAULT_LIMIT);
  // Effective per-call cap = min(requested, hard ceiling, owner's batch cap).
  const limit = Math.max(1, Math.min(HARD_MAX_LIMIT, Math.floor(maxBatch), Math.floor(rawLimit)));
  const minScore = num(payload.min_score ?? url.searchParams.get("min_score"));
  const maxFreshnessDays = num(payload.max_freshness_days ?? url.searchParams.get("max_freshness_days")) ?? DEFAULT_MAX_FRESHNESS_DAYS;

  try {
    // 1) Wallet gate — abort loudly if we can't afford to spend.
    const w0 = await getBalance(apiKey);
    if (!w0.ok) return json({ ok: false, error: "wallet lookup failed before trace", status: w0.status, raw: w0.raw }, 502);
    if (w0.balance == null) return json({ ok: false, error: "could not parse wallet balance — aborting for safety", raw: w0.raw }, 502);
    if (w0.balance < MIN_BALANCE_USD) {
      return json({ ok: false, error: `BatchData wallet balance $${w0.balance} is below the $${MIN_BALANCE_USD} floor — top up before tracing.`, balance: w0.balance }, 402);
    }

    // 2) Select leads.
    const leads = await pickLeads(db, limit, minScore, maxFreshnessDays, force, leadIds);
    if (leads.length === 0) {
      return json({ ok: true, traced: 0, message: "No needs_skiptrace leads matched the filters.", balance_before: w0.balance });
    }

    const perLead: Record<string, unknown>[] = [];
    let traced = 0, ready = 0, emailOnly = 0, noMatch = 0, errored = 0;
    let firstRaw: unknown = null;

    for (const lead of leads) {
      if (Date.now() - started > BUDGET_MS) break; // leave the rest for the next call

      const propertyAddress: Record<string, string> = {};
      if (lead.debtor_address) propertyAddress.street = lead.debtor_address;
      if (lead.debtor_city) propertyAddress.city = lead.debtor_city;
      if (lead.debtor_state) propertyAddress.state = lead.debtor_state;
      if (lead.debtor_zip) propertyAddress.zip = lead.debtor_zip;

      const r = await batch(apiKey, "POST", SKIPTRACE_PATH, { requests: [{ propertyAddress }] });
      if (debug && firstRaw === null) firstRaw = r.body;
      if (!r.ok) {
        errored++;
        perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, error: `skip-trace ${r.status}`, detail: r.body });
        continue;
      }

      const persons = normalizePersons(r.body);
      // Shared aggregation: DNC + TCPA-litigator both suppress a number from becoming dialable.
      const agg = aggregate(persons);
      const { allPhones, allEmails, usablePhones, dncPhones, tcpaPhones, primaryName, status } = agg;
      if (status === "ready") ready++;
      else if (status === "email_only") emailOnly++;
      else noMatch++;

      const nowIso = new Date().toISOString();

      // Persist to the durable ph_ucc rows + mirror onto any smart_list_members. SHARED
      // with the member path via persistLeadTrace, so the two entry points never drift.
      const res = await persistLeadTrace(db, lead.id, persons, agg, nowIso);
      if (!res.ok) { errored++; perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, error: res.error }); continue; }

      traced++;
      perLead.push({
        lead_id: lead.id, debtor: lead.debtor_name, state: lead.state,
        person: primaryName, persons: persons.length,
        phones_total: allPhones.length, dialable: usablePhones.length,
        dnc_suppressed: dncPhones.length, tcpa_suppressed: tcpaPhones.length,
        emails: allEmails.length, status,
      });
    }

    // 3) Cost = actual wallet delta this run; distribute as a per-lead estimate.
    const w1 = await getBalance(apiKey);
    const runSpend = w0.balance != null && w1.balance != null ? Math.max(0, Math.round((w0.balance - w1.balance) * 10000) / 10000) : null;
    const perLeadCost = runSpend != null && traced > 0 ? Math.round((runSpend / traced) * 10000) / 10000 : null;
    if (perLeadCost != null) {
      // stamp the estimate onto the leads/contacts touched this run
      const ids = perLead.filter((p) => p.status).map((p) => p.lead_id as string);
      if (ids.length) {
        await db.from("ph_ucc_leads").update({ trace_cost: perLeadCost }).in("id", ids);
        await db.from("ph_ucc_contacts").update({ trace_cost: perLeadCost }).in("lead_id", ids);
      }
    }

    return json({
      ok: true,
      provider: "batchdata",
      requested_limit: limit,
      requested_ids: leadIds ? leadIds.length : null,
      candidates: leads.length,
      traced, ready, email_only: emailOnly, no_match: noMatch, errored,
      balance_before: w0.balance, balance_after: w1.balance, run_spend_usd: runSpend, per_lead_cost_est: perLeadCost,
      elapsed_ms: Date.now() - started,
      per_lead: perLead,
      ...(debug ? { first_raw: firstRaw } : {}),
    });
  } catch (e) {
    console.error("[ph-ucc-skiptrace] FAILED", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
