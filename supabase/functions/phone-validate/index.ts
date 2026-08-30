// phone-validate — the PHONE-HYGIENE stage of the Data Hygiene feature.
//
// Validates a phone's LINE TYPE (mobile/landline/voip), carrier, and live status
// for smart_list_members (and optionally writes back to ph_ucc_leads). It NEVER
// dials and NEVER loads to GHL — it only stamps the validation_* columns.
//
// PROVIDER SEAM: PROVIDER (default 'twilio') selects a lookup(e164) implementation
// returning { line_type, carrier, reachable, disconnected }. realphonevalidation
// and ipqs are left as clearly-marked stubs.
//
// ⚠️ TWILIO CAVEAT — reachable ≠ connected. Twilio Lookup "Line Type Intelligence"
// returns line type + carrier + a top-level `valid` (the number is a well-formed,
// assigned number), but it does NOT tell you whether the line is currently
// connected/answering. So we set reachable = valid and leave disconnected = null
// (unknown). A provider that DOES report true disconnection (realphonevalidation's
// "disconnected" status, ipqs "active":false) should set disconnected accordingly.
//
// GATING (two independent gates, both owner-controlled):
//   1) Credentials: get_phone_validation_key() returns { account_sid, auth_token }
//      from the vault. Until the owner adds TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
//      the pair is null → every spend path returns { ok:false, gated:true }.
//   2) Enable flag: ph_settings.phone_validate_enabled (default false) pauses the
//      'validate' action unless force:true (mirrors skiptrace_enabled / apollo).
//
// AUTH (copied verbatim from ph-ucc-skiptrace): trusted cron via ?secret=<GHL
// webhook secret> + anon-key Bearer, OR a signed-in staff user
// (closer/admin/super_admin). A service-role bearer deliberately fails the role
// check — use the secret path for server-side calls.
//
// ACTIONS (body { action?, smart_list_id?, member_ids?, provider?, force? }):
//   • balance  — provider account balance (Twilio Balance API). gated when unkeyed.
//   • preview  — count members needing validation + estimated cost. No spend, no key.
//   • validate — validate up to HARD_MAX_LIMIT (200) members; write validation_* back.
//                The UI loops toward ~1000 by calling repeatedly.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const PROVIDER_DEFAULT = "twilio";
const HARD_MAX_LIMIT = 200;                 // never validate more than this per call
const DEFAULT_LIMIT = 100;
const BUDGET_MS = 55_000;                    // stop starting new lookups past this (platform kills ~60s)

// Per-lookup list price (USD). Twilio Line Type Intelligence is $0.008/lookup.
// Used ONLY for the preview estimate + the per-member validation_cost stamp; the
// authoritative balance is read live from the provider.
const COST_PER_LOOKUP: Record<string, number> = {
  twilio: 0.008,
  realphonevalidation: 0.0,
  ipqs: 0.0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

// Normalize a raw phone to E.164 (US default). Returns null when it can't be made
// into a plausible E.164 number, so an unusable string is skipped, never charged.
function toE164(raw: unknown): string | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 8 && d.length <= 15) return `+${d}`;   // already-international, no +
  return null;
}

// ── Provider seam ──────────────────────────────────────────────────────────────
interface LookupResult {
  line_type: string | null;      // mobile | landline | voip | ...
  carrier: string | null;
  reachable: boolean | null;     // number is well-formed/assigned (Twilio `valid`)
  disconnected: boolean | null;  // true=known-disconnected; null=unknown (Twilio)
}
interface Provider {
  name: string;
  lookup(e164: string): Promise<{ ok: boolean; status: number; result?: LookupResult; error?: string }>;
  balance(): Promise<{ ok: boolean; status: number; balance: number | null; currency: string | null; error?: string }>;
}

// -- Twilio (Lookup v2 Line Type Intelligence + Balance API) --------------------
function twilioProvider(sid: string, token: string): Provider {
  const basic = "Basic " + btoa(`${sid}:${token}`);
  return {
    name: "twilio",
    async lookup(e164) {
      const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
      const res = await fetch(url, { headers: { Authorization: basic, Accept: "application/json" } });
      const text = await res.text();
      let b: any = {};
      try { b = text ? JSON.parse(text) : {}; } catch { b = { _raw: text.slice(0, 300) }; }
      if (!res.ok) {
        // Twilio 404 = number not found / invalid. Treat as an unreachable verdict,
        // not a hard error, so a bad number is recorded rather than aborting the batch.
        if (res.status === 404) {
          return { ok: true, status: 404, result: { line_type: null, carrier: null, reachable: false, disconnected: null } };
        }
        return { ok: false, status: res.status, error: (b?.message ?? text ?? "").toString().slice(0, 300) };
      }
      const lti = b?.line_type_intelligence ?? {};
      // Twilio returns type + carrier + a top-level `valid`. reachable = valid;
      // disconnected is UNKNOWN from this product → null (see header caveat).
      return {
        ok: true,
        status: res.status,
        result: {
          line_type: clean(lti?.type),
          carrier: clean(lti?.carrier_name),
          reachable: typeof b?.valid === "boolean" ? b.valid : null,
          disconnected: null,
        },
      };
    },
    async balance() {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`;
      const res = await fetch(url, { headers: { Authorization: basic, Accept: "application/json" } });
      const text = await res.text();
      let b: any = {};
      try { b = text ? JSON.parse(text) : {}; } catch { b = {}; }
      if (!res.ok) return { ok: false, status: res.status, balance: null, currency: null, error: (b?.message ?? text ?? "").toString().slice(0, 300) };
      const n = Number(b?.balance);
      return { ok: true, status: res.status, balance: Number.isFinite(n) ? n : null, currency: clean(b?.currency) ?? "USD" };
    },
  };
}

// -- Stubs for future providers (clearly marked; not wired) --------------------
function unimplementedProvider(name: string): Provider {
  const err = `phone-validation provider '${name}' is not implemented yet — only 'twilio' is wired`;
  return {
    name,
    async lookup() { return { ok: false, status: 501, error: err }; },
    async balance() { return { ok: false, status: 501, balance: null, currency: null, error: err }; },
  };
}

function makeProvider(name: string, creds: { sid: string | null; token: string | null }): Provider | null {
  switch (name) {
    case "twilio":
      if (!creds.sid || !creds.token) return null;   // unkeyed → gated
      return twilioProvider(creds.sid, creds.token);
    case "realphonevalidation":  // TODO: RealPhoneValidation Turbo/Scrub — reports true disconnected
    case "ipqs":                 // TODO: IPQualityScore phone validation — reports active/leaked/fraud
      return unimplementedProvider(name);
    default:
      return null;
  }
}

// ── Member selection ─────────────────────────────────────────────────────────
type Member = { id: string; source: string; source_id: string; snapshot: Record<string, unknown> | null; phone_validated_at: string | null };

function memberPhone(m: Member): string | null {
  const s = m.snapshot ?? {};
  return toE164((s as any).phone ?? (s as any).phone_number ?? (s as any).mobile ?? null);
}

async function pickMembers(
  db: SupabaseClient, smartListId: string | null, memberIds: string[] | null, force: boolean, limit: number,
): Promise<Member[]> {
  let q = db.from("smart_list_members")
    .select("id,source,source_id,snapshot,phone_validated_at")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (memberIds && memberIds.length) q = q.in("id", memberIds);
  if (smartListId) q = q.eq("smart_list_id", smartListId);
  if (!force) q = q.is("phone_validated_at", null);   // idempotent: skip already-validated
  const { data, error } = await q;
  if (error) throw new Error(`pickMembers failed: ${error.message}`);
  return (data as Member[]) ?? [];
}

// Count members that still need validation (for preview). Same predicate as pickMembers.
async function countNeeding(db: SupabaseClient, smartListId: string | null, memberIds: string[] | null, force: boolean): Promise<number> {
  let q = db.from("smart_list_members").select("id", { count: "exact", head: true });
  if (memberIds && memberIds.length) q = q.in("id", memberIds);
  if (smartListId) q = q.eq("smart_list_id", smartListId);
  if (!force) q = q.is("phone_validated_at", null);
  const { count, error } = await q;
  if (error) throw new Error(`countNeeding failed: ${error.message}`);
  return count ?? 0;
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
  const action = String(payload.action ?? url.searchParams.get("action") ?? "validate").toLowerCase();
  const providerName = String(payload.provider ?? url.searchParams.get("provider") ?? PROVIDER_DEFAULT).toLowerCase();
  const force = payload.force === true || url.searchParams.get("force") === "true";
  const smartListId = clean(payload.smart_list_id ?? url.searchParams.get("smart_list_id"));
  const memberIdsRaw = (payload as { member_ids?: unknown }).member_ids;
  const memberIds = Array.isArray(memberIdsRaw)
    ? memberIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, HARD_MAX_LIMIT)
    : null;

  const started = Date.now();
  const costPer = COST_PER_LOOKUP[providerName] ?? 0;

  // ── Credentials from the vault (the gate). Null pair = not keyed yet. ──
  const { data: creds } = await db.rpc("get_phone_validation_key");
  const sid = clean((creds as any)?.account_sid);
  const authToken = clean((creds as any)?.auth_token);
  const gated = providerName === "twilio" && (!sid || !authToken);

  // ── preview: no spend, no key required. Count members + estimate cost. ──
  if (action === "preview") {
    try {
      const needing = await countNeeding(db, smartListId, memberIds, force);
      return json({
        ok: true, action: "preview", provider: providerName,
        needing_validation: needing,
        est_cost_usd: Math.round(needing * costPer * 10000) / 10000,
        cost_per_lookup: costPer,
        gated, hard_max_limit: HARD_MAX_LIMIT,
      });
    } catch (e) {
      return json({ ok: false, action: "preview", error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // ── balance: provider account balance. Gated when unkeyed. ──
  if (action === "balance") {
    if (gated) return json({ ok: false, gated: true, action: "balance", provider: providerName, error: "Add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN to the vault" });
    const provider = makeProvider(providerName, { sid, token: authToken });
    if (!provider) return json({ ok: false, action: "balance", provider: providerName, error: `unknown provider '${providerName}'` }, 400);
    const b = await provider.balance();
    if (!b.ok) return json({ ok: false, action: "balance", provider: providerName, status: b.status, error: b.error ?? "balance lookup failed" }, 502);
    return json({ ok: true, action: "balance", provider: providerName, balance: b.balance, currency: b.currency });
  }

  // ── validate: the spend path ──
  if (action !== "validate") return json({ ok: false, error: `unknown action '${action}'` }, 400);

  // Gate 1: credentials.
  if (gated) return json({ ok: false, gated: true, error: "Add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN to the vault" });

  // Gate 2: owner enable flag (default off), overridable with force:true.
  const { data: phSettings } = await db.from("platform_settings").select("value").eq("key", "ph_settings").maybeSingle();
  const settingsVal = (phSettings?.value ?? {}) as Record<string, unknown>;
  if (settingsVal.phone_validate_enabled !== true && !force) {
    return json({ ok: true, skipped: true, reason: "ph_settings.phone_validate_enabled is not true — stage paused by owner. Pass force:true to override." });
  }

  const provider = makeProvider(providerName, { sid, token: authToken });
  if (!provider) return json({ ok: false, error: `provider '${providerName}' not available` }, 400);

  const rawLimit = Number(payload.limit ?? url.searchParams.get("limit"));
  const limit = Math.max(1, Math.min(HARD_MAX_LIMIT, Math.floor(Number.isFinite(rawLimit) ? rawLimit : (memberIds ? memberIds.length : DEFAULT_LIMIT))));

  try {
    const members = await pickMembers(db, smartListId, memberIds, force, limit);
    if (members.length === 0) {
      return json({ ok: true, action: "validate", provider: providerName, validated: 0, message: "No members needed validation." });
    }

    const perMember: Record<string, unknown>[] = [];
    let validated = 0, mobile = 0, landline = 0, voip = 0, unreachable = 0, noPhone = 0, errored = 0;

    for (const m of members) {
      if (Date.now() - started > BUDGET_MS) break;   // leave the rest for the next call
      const e164 = memberPhone(m);
      if (!e164) {
        noPhone++;
        perMember.push({ member_id: m.id, error: "no usable phone in snapshot" });
        continue;
      }

      const r = await provider.lookup(e164);
      if (!r.ok || !r.result) {
        errored++;
        perMember.push({ member_id: m.id, phone: e164, error: r.error ?? `lookup ${r.status}` });
        continue;
      }
      const { line_type, carrier, reachable, disconnected } = r.result;
      const nowIso = new Date().toISOString();

      const { error: uErr } = await db.from("smart_list_members").update({
        line_type, carrier, phone_reachable: reachable, phone_disconnected: disconnected,
        phone_validated_at: nowIso, validation_provider: provider.name, validation_cost: costPer,
      }).eq("id", m.id);
      if (uErr) { errored++; perMember.push({ member_id: m.id, phone: e164, error: `member update: ${uErr.message}` }); continue; }

      // Optional write-back onto the source ph_ucc_lead (columns added by the DH
      // migration). Best-effort but LOUD on failure — never blocks the member write.
      if (m.source === "ph_ucc") {
        const { error: lErr } = await db.from("ph_ucc_leads").update({
          line_type, carrier, phone_reachable: reachable, phone_validated_at: nowIso,
        }).eq("id", m.source_id);
        if (lErr) console.error("[phone-validate] ph_ucc_leads write-back failed", JSON.stringify({ lead_id: m.source_id, error: lErr.message }));
      }

      validated++;
      const t = (line_type ?? "").toLowerCase();
      if (t === "mobile") mobile++; else if (t === "landline") landline++; else if (t === "voip") voip++;
      if (reachable === false) unreachable++;
      perMember.push({ member_id: m.id, phone: e164, line_type, carrier, reachable, disconnected });
    }

    return json({
      ok: true, action: "validate", provider: provider.name,
      requested_limit: limit, candidates: members.length,
      validated, mobile, landline, voip, unreachable, no_phone: noPhone, errored,
      est_run_cost_usd: Math.round(validated * costPer * 10000) / 10000,
      elapsed_ms: Date.now() - started,
      per_member: perMember,
    });
  } catch (e) {
    console.error("[phone-validate] FAILED", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
