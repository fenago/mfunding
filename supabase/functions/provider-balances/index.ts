// provider-balances — ONE place both the Data Hygiene panel and System Health read
// remaining spend across every paid enrichment provider. Read-only; spends nothing.
//
// Returns:
//   {
//     batchdata:        { balance, currency, ok, error? },       // skip-trace wallet
//     apollo:           { available:false, reason },             // no credits API — see below
//     phone_validation: { provider, balance|null, currency|null, ok, gated?, error? }
//   }
//
// SOURCES:
//   • BatchData — the SAME wallet path ph-ucc-skiptrace uses: GET /wallet/balance
//     with the vault key (get_ph_skiptrace_key), tolerant balance parsing.
//   • Apollo — Apollo.io's REST API exposes NO credit/usage balance endpoint. Rather
//     than fabricate a number we report available:false with the reason. (Credit usage
//     is visible only in the Apollo web dashboard / CSV export, not the API.)
//   • Phone validation — Twilio Balance API when keyed; otherwise gated:true (the
//     TWILIO_* vault entries aren't set yet).
//   • RealPhoneValidation — the SECOND phone-validation provider. RealValidation.com
//     exposes NO credit/balance endpoint for the Scrub product (every candidate 404s),
//     so we report available:false with the reason rather than fabricate a number.
//     gated:true until REALPHONEVALIDATION_TOKEN is present in the vault.
//
// AUTH (copied from ph-ucc-skiptrace): trusted cron via ?secret=<GHL webhook secret>
// + anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const BATCH_WALLET_URL = "https://api.batchdata.com/api/v1/wallet/balance";
const PHONE_PROVIDER = "twilio";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

// Tolerant BatchData wallet-balance parse (mirrors ph-ucc-skiptrace.parseBalance).
function parseBatchBalance(b: any): number | null {
  const candidates = [
    b?.results?.balance, b?.results?.wallet?.balance, b?.results?.wallet?.amount,
    b?.data?.balance, b?.wallet?.balance, b?.balance, b?.results?.availableBalance,
  ];
  for (const c of candidates) { const n = num(c); if (n != null) return n; }
  return null;
}

async function batchdataBalance(db: SupabaseClient) {
  const { data: apiKey, error: keyErr } = await db.rpc("get_ph_skiptrace_key");
  if (keyErr || !apiKey || typeof apiKey !== "string") {
    return { balance: null, currency: "USD", ok: false, error: "PH_SKIPTRACE_API_KEY missing from vault" };
  }
  try {
    const res = await fetch(BATCH_WALLET_URL, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const text = await res.text();
    let b: any = {}; try { b = text ? JSON.parse(text) : {}; } catch { b = {}; }
    if (!res.ok) return { balance: null, currency: "USD", ok: false, error: `wallet lookup failed (${res.status})` };
    return { balance: parseBatchBalance(b), currency: "USD", ok: true };
  } catch (e) {
    return { balance: null, currency: "USD", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function twilioBalance(db: SupabaseClient) {
  const { data: creds } = await db.rpc("get_phone_validation_key");
  const sid = clean((creds as any)?.account_sid);
  const token = clean((creds as any)?.auth_token);
  if (!sid || !token) {
    return { provider: PHONE_PROVIDER, balance: null, currency: null, ok: false, gated: true, error: "Add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN to the vault" };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`;
    const res = await fetch(url, { headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), Accept: "application/json" } });
    const text = await res.text();
    let b: any = {}; try { b = text ? JSON.parse(text) : {}; } catch { b = {}; }
    if (!res.ok) return { provider: PHONE_PROVIDER, balance: null, currency: null, ok: false, error: `balance lookup failed (${res.status})` };
    return { provider: PHONE_PROVIDER, balance: num(b?.balance), currency: clean(b?.currency) ?? "USD", ok: true };
  } catch (e) {
    return { provider: PHONE_PROVIDER, balance: null, currency: null, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// RealPhoneValidation: no balance API exists (re-verified — all candidates 404), so
// the wallet is TRACKED: the owner sets their current RPV balance (platform_settings
// key 'rpv_wallet' = { balance, set_at }) and we subtract our own recorded per-lookup
// spend (smart_list_members.validation_cost where provider='realphonevalidation')
// since that stamp. Estimated — external spend outside this app won't be seen.
async function realPhoneValidationBalance(db: SupabaseClient) {
  const { data: token, error } = await db.rpc("get_rpv_token");
  if (error) {
    return { provider: "realphonevalidation", available: false, balance: null, currency: null, ok: false, error: `vault read failed: ${error.message}` };
  }
  if (!token || typeof token !== "string") {
    return { provider: "realphonevalidation", available: false, balance: null, currency: null, ok: false, gated: true, reason: "Add REALPHONEVALIDATION_TOKEN to the vault" };
  }
  const { data: setting } = await db
    .from("platform_settings").select("value").eq("key", "rpv_wallet").maybeSingle();
  const v = (setting?.value ?? null) as { balance?: number; set_at?: string } | null;
  const start = typeof v?.balance === "number" ? v.balance : null;
  if (start == null) {
    return {
      provider: "realphonevalidation", available: false, balance: null, currency: null, ok: true,
      needs_setup: true,
      reason: "RealValidation has no balance API — set your current balance (from their dashboard) to track it here",
    };
  }
  // Tracked spend since the stamp.
  let spent = 0;
  const since = v?.set_at ?? "1970-01-01";
  const { data: spendRows } = await db
    .from("smart_list_members")
    .select("validation_cost")
    .eq("validation_provider", "realphonevalidation")
    .gte("phone_validated_at", since)
    .not("validation_cost", "is", null);
  for (const r of (spendRows ?? []) as { validation_cost: number | null }[]) {
    spent += Number(r.validation_cost ?? 0) || 0;
  }
  const est = Math.max(0, Math.round((start - spent) * 100) / 100);
  return {
    provider: "realphonevalidation", available: true, balance: est, currency: "USD", ok: true,
    estimated: true, set_at: v?.set_at ?? null, tracked_spend: Math.round(spent * 100) / 100,
    reason: "estimated — RPV has no balance API; your set balance minus spend tracked here",
  };
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

  // Fetch in parallel (each is an independent network / vault hop).
  const [batchdata, phone_validation, realphonevalidation] = await Promise.all([
    batchdataBalance(db),
    twilioBalance(db),
    realPhoneValidationBalance(db),
  ]);

  const apollo = {
    available: false,
    reason: "Apollo API exposes no credit/usage balance endpoint",
  };

  return json({ ok: true, batchdata, apollo, phone_validation, realphonevalidation });
});
