// ph-ucc-scan-unmatched — the "MCA funders we're missing" radar (API states).
//
// Continuously surfaces the highest-frequency secured-party names in each API
// state's RAW UCC data that our funder dictionary does NOT already match and that
// are NOT depository/banks — probable MCA funders we're overlooking. Writes only a
// lightweight name+count snapshot into ph_ucc_unmatched_parties; the owner then
// promotes or dismisses each candidate on the PH UCC Machine page.
//
// EGRESS LAW: the frequency ranking is computed SERVER-SIDE on Socrata via a
// $select=<party>,count(1)&$group=<party> aggregate. Only the small aggregated
// result set (a few hundred rows per state) ever crosses the wire — we never pull
// the millions of raw filings. All matching / depository / dedupe / upsert logic
// lives in the single ph_ucc_upsert_unmatched() RPC so "unmatched" can never drift
// from what the matcher considers matched.
//
// SOURCES (aggregate-capable, verified live):
//   CT  data.ct.gov      xfev-8smz  (sec_party_nm_bus) — windowed to our lead
//        universe: Active + ORIG FIN STMT + dt_accept in the 540d window, non-lapsed.
//   CO  data.colorado.gov ap62-sav4 (organizationname) — secured-party party table
//        has no per-row date/status, so the whole table is ranked (standing radar).
//   OR  data.oregon.gov   2kf7-i54h  (secured_party) — ranked across the dataset.
//   CA / FL are paid FILE states — their radar candidates are emitted by the
//        DuckDB loaders (scripts/ph_ucc_ca_loader.py / ph_ucc_fl_loader.py) on
//        their normal runs, via the same ph_ucc_upsert_unmatched RPC.
//
// AUTH (mirrors ph-ucc-ingest): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const CT_URL = "https://data.ct.gov/resource/xfev-8smz.json";
const CO_URL = "https://data.colorado.gov/resource/ap62-sav4.json";
const OR_URL = "https://data.oregon.gov/resource/2kf7-i54h.json";

const TOP_N = 400;             // top secured parties by frequency to pull per state
const MIN_COUNT = 5;           // ignore long-tail one-off names (matches the RPC floor)
const CT_WINDOW_DAYS = 540;    // mirror the ingest lead universe for CT

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Candidate = { name: string; cnt: number };

async function soda(url: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SODA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

// Normalize a Socrata aggregate row to {name,cnt}. count(1) aliased to `cnt`;
// Socrata returns the count as a string.
function toCandidates(rows: Record<string, unknown>[], field: string): Candidate[] {
  const out: Candidate[] = [];
  for (const r of rows) {
    const name = String(r[field] ?? "").trim();
    const cnt = Number(r.cnt ?? 0) || 0;
    if (name) out.push({ name, cnt });
  }
  return out;
}

async function scanCT(): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - CT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const where =
    `lien_status='Active' AND cd_flng_type='ORIG FIN STMT'`
    + ` AND dt_accept > '${cutoff}T00:00:00'`
    + ` AND (dt_lapse IS NULL OR dt_lapse >= '${today}T00:00:00')`
    + ` AND sec_party_nm_bus IS NOT NULL`;
  const rows = await soda(CT_URL, {
    $select: "sec_party_nm_bus,count(1) as cnt",
    $where: where,
    $group: "sec_party_nm_bus",
    $order: "cnt desc",
    $limit: String(TOP_N),
  });
  return toCandidates(rows, "sec_party_nm_bus");
}

async function scanCO(): Promise<Candidate[]> {
  const rows = await soda(CO_URL, {
    $select: "organizationname,count(1) as cnt",
    $where: "organizationname IS NOT NULL",
    $group: "organizationname",
    $order: "cnt desc",
    $limit: String(TOP_N),
  });
  return toCandidates(rows, "organizationname");
}

async function scanOR(): Promise<Candidate[]> {
  const rows = await soda(OR_URL, {
    $select: "secured_party,count(1) as cnt",
    $where: "secured_party IS NOT NULL",
    $group: "secured_party",
    $order: "cnt desc",
    $limit: String(TOP_N),
  });
  return toCandidates(rows, "secured_party");
}

const SCANNERS: Record<string, () => Promise<Candidate[]>> = {
  CT: scanCT,
  CO: scanCO,
  OR: scanOR,
};

async function scanState(db: SupabaseClient, state: string) {
  const candidates = await SCANNERS[state]();
  const { data, error } = await db.rpc("ph_ucc_upsert_unmatched", {
    p_state: state,
    p_rows: candidates,
    p_min_count: MIN_COUNT,
  });
  if (error) throw new Error(`ph_ucc_upsert_unmatched(${state}) failed: ${error.message}`);
  return { fetched: candidates.length, upserted: (data as number) ?? 0 };
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
  const stateParam = String(payload.state ?? url.searchParams.get("state") ?? "ALL").toUpperCase();
  const started = Date.now();

  const targets = stateParam === "ALL" ? Object.keys(SCANNERS) : [stateParam];
  const results: Record<string, unknown> = {};
  let totalUpserted = 0;

  for (const st of targets) {
    if (!SCANNERS[st]) {
      results[st] = { skipped: true, reason: `no aggregate scanner for ${st} (file states CA/FL emit via their loaders)` };
      continue;
    }
    try {
      const r = await scanState(db, st);
      results[st] = r;
      totalUpserted += r.upserted;
    } catch (e) {
      // Loud per-state error; keep scanning the others.
      results[st] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const anyError = Object.values(results).some((r) => (r as { error?: string }).error);
  return json({
    ok: !anyError,
    state: stateParam,
    upserted: totalUpserted,
    elapsed_ms: Date.now() - started,
    ...results,
  }, anyError ? 207 : 200);
});
