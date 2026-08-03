// ph-ucc-skiptrace — the SKIP-TRACE stage of the PH UCC List Machine.
//
// Takes needs_skiptrace leads (debtor + filing address, no contact yet), calls
// BatchData.io property skip-trace, and appends persons/phones/emails onto
// ph_ucc_contacts + a lead-level summary. It NEVER dials and NEVER loads to GHL.
//
// HARD DNC RULE (conservative): every number BatchData returns is stored, but any
// number with dnc:true is flagged suppressed_dnc and is NEVER written to
// ph_ucc_leads.phone and NEVER exported to a dial CSV. A lead's dialable phone is
// only ever a NON-DNC number. Post-trace status:
//   • ≥1 non-DNC phone  → needs_scrub   (still owes a TCPA cell-scrub before dialing)
//   • else ≥1 email     → email_only    (usable by the cold-email channel)
//   • else              → no_match      (no usable phone, no email)
//
// SPEND CONTROL: reads the wallet first; aborts loudly if balance < $5. Never
// traces more than `limit` leads per call. Idempotent — a lead with traced_at set
// is skipped unless force:true.
//
// AUTH (mirrors ph-ucc-ingest): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.
//
// PHONE-DNC RE-CHECK: BatchData's skip-trace already returns a per-number dnc flag,
// so a separate /phone verification pass is redundant today. If a future provider
// omits dnc, add a phone-dnc re-check here before promoting to needs_scrub. (future)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

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
  const bestPhone = usablePhones.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]?.number ?? null;
  const bestEmail = allEmails[0] ?? null;
  const primaryName = persons.find((p) => p.person_name)?.person_name ?? null;

  const status: "needs_scrub" | "email_only" | "no_match" =
    usablePhones.length > 0 ? "needs_scrub" : allEmails.length > 0 ? "email_only" : "no_match";

  const tcpaNote = tcpaPhones.length ? ` ${tcpaPhones.length} suppressed as TCPA-litigator.` : "";
  const statusReason =
    status === "needs_scrub"
      ? `${usablePhones.length} dialable number(s) found; ${dncPhones.length} DNC-suppressed.${tcpaNote} Awaiting TCPA cell-scrub.`
    : status === "email_only"
      ? `${allEmails.length} email(s) found; ${dncPhones.length} DNC + ${tcpaPhones.length} TCPA-litigator number(s) suppressed. Routed to cold-email.`
    : anyPerson
      ? `Person matched but no dialable number and no email (${dncPhones.length} DNC, ${tcpaPhones.length} TCPA-litigator).`
      : "No skip-trace match for this address.";

  return { anyPerson, allPhones, allEmails, usablePhones, dncPhones, tcpaPhones, bestPhone, bestEmail, primaryName, status, statusReason };
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
): Promise<Lead[]> {
  let q = db.from("ph_ucc_leads")
    .select("id,debtor_name,state,debtor_address,debtor_city,debtor_state,debtor_zip,score,freshness_days")
    .eq("status", "needs_skiptrace")
    .not("debtor_address", "is", null)      // need a street to skip-trace an address
    .lte("freshness_days", maxFreshnessDays)
    .order("freshness_days", { ascending: true, nullsFirst: false }) // FRESH first
    .order("score", { ascending: false, nullsFirst: false })          // then high-score
    .limit(limit);
  if (!force) q = q.is("traced_at", null);   // idempotent: never re-trace
  if (minScore != null) q = q.gte("score", minScore);
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
        status: agg.status, status_reason: agg.statusReason,
      }).eq("id", lead.id);
      if (luErr) { errored++; details.push({ lead_id: lead.id, error: `lead update: ${luErr.message}` }); continue; }

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

  const rawLimit = num(payload.limit ?? url.searchParams.get("limit")) ?? DEFAULT_LIMIT;
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
    const leads = await pickLeads(db, limit, minScore, maxFreshnessDays, force);
    if (leads.length === 0) {
      return json({ ok: true, traced: 0, message: "No needs_skiptrace leads matched the filters.", balance_before: w0.balance });
    }

    const perLead: Record<string, unknown>[] = [];
    let traced = 0, needsScrub = 0, emailOnly = 0, noMatch = 0, errored = 0;
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
      const { anyPerson, allPhones, allEmails, usablePhones, dncPhones, tcpaPhones,
              bestPhone, bestEmail, primaryName, status, statusReason } = aggregate(persons);
      if (status === "needs_scrub") needsScrub++;
      else if (status === "email_only") emailOnly++;
      else noMatch++;

      const nowIso = new Date().toISOString();

      // Replace any prior contact rows for this lead (idempotent re-trace on force).
      await db.from("ph_ucc_contacts").delete().eq("lead_id", lead.id);
      if (persons.length > 0) {
        const rows = persons.map((p, i) => ({
          lead_id: lead.id,
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
        if (cErr) { errored++; perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, error: `contacts insert: ${cErr.message}` }); continue; }
      }

      const { error: uErr } = await db.from("ph_ucc_leads").update({
        phone: bestPhone,           // NON-DNC only, or null
        email: bestEmail,
        person_name: primaryName,
        traced_at: nowIso,
        trace_match: anyPerson,
        status,
        status_reason: statusReason,
      }).eq("id", lead.id);
      if (uErr) { errored++; perLead.push({ lead_id: lead.id, debtor: lead.debtor_name, error: `lead update: ${uErr.message}` }); continue; }

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
      candidates: leads.length,
      traced, needs_scrub: needsScrub, email_only: emailOnly, no_match: noMatch, errored,
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
