// ph-ucc-ingest-masked — harvest AGENT-MASKED MCA leads from state UCC open data.
//
// The named-funder pipeline (ph-ucc-ingest) matches the secured party against our
// FUNDER dictionary. This sibling matches it against the REPRESENTATION-AGENT
// dictionary (ph_ucc_agents: CSC / C T Corporation / First Corporate Solutions /
// CHTD / Middesk / Lien Solutions / …) — filings where the true funder is hidden on
// the filing image and unrecoverable from bulk data, but the DEBTOR (merchant) is
// fully known. Those merchants are then MCA-SCORED and only the high-confidence set
// is promoted, so the equipment/RE/bank-syndication noise these agents ALSO file
// never becomes a lead. See migration 20260805_ph_ucc_22_agent_masked.sql.
//
// EGRESS LAW (a free-tier egress cap once caused a site outage): the harvest windows
// + pages SERVER-SIDE on Socrata and stores ONLY the scored survivors' filings into
// ph_ucc_filings (filing_class='agent_masked') — never the ~100k+ raw masked filings.
// Then it calls ph_ucc_rebuild_masked_leads() to materialize agent_masked leads.
//
// SCORING (mirrors ph_ucc_is_agent_noise / ph_ucc_rebuild_masked_leads in SQL — keep
// AGENT_NOISE in sync): stack_depth = # distinct fresh agent-masked liens on the same
// normalized business debtor. Promote when stack_depth >= 2 AND the debtor name is
// not RE/leasing/holding/gov noise AND the debtor is not already a named_funder lead
// (that merchant is already captured — reported as overlap, never re-dialed).
//
// STATES:
//   CT  data.ct.gov/xfev-8smz  — denormalized (debtor + secured party + dt_accept on
//        each row). Full 540d Active/ORIG-FIN-STMT agent slice pulled → exact stacking.
//   OR  data.oregon.gov/snfi-f79b — "last month" denormalized (party_type DB/SP). Tiny;
//        accumulates run-over-run in ph_ucc_filings, rebuild finds cross-run stackers.
//   CO  data.colorado.gov — 3 tables (ap62-sav4 secured / wffy-3uut filing / 8upq-58vz
//        debtor) joined on fileid, hydrated with bounded CONCURRENCY. Fresh(540d) +
//        non-terminated only.
//   CA / FL are paid FILE states — their agent-masked survivors are emitted by the
//        DuckDB/streaming loaders (scripts/ph_ucc_ca_loader.py / ph_ucc_fl_loader.py).
//
// AUTH (mirrors ph-ucc-ingest): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const CT_URL = "https://data.ct.gov/resource/xfev-8smz.json";
const OR_URL = "https://data.oregon.gov/resource/snfi-f79b.json";
const CO_BASE = "https://data.colorado.gov/resource";
const CO_SECURED = "ap62-sav4";
const CO_FILING = "wffy-3uut";
const CO_DEBTOR = "8upq-58vz";

const WINDOW_DAYS = 540;             // freshness window (mirror named ingest)
const PAGE = 1000;                   // Socrata max page
// Store ALL fresh agent-filed business debtors (non-noise, not already named) and let
// the rebuild TIER them by confidence: high=3+ / medium=2 / low=1 stacked liens. The
// owner dials which tiers get loaded when the gate is flipped; all stay gated here.
const MIN_STACK = 1;
const CO_MAX_AGENT_FILES = 60_000;   // safety cap on CO agent fileids per run
const HYDRATE_CHUNK = 200;           // fileid IN-list chunk for CO hydration
const HYDRATE_CONCURRENCY = 8;       // concurrent CO hydration requests

// KEEP IN SYNC with public.ph_ucc_is_agent_noise(text) and the CA/FL loaders.
// TRUE = a non-MCA RE/leasing/holding/gov entity that agents also file for.
const AGENT_NOISE_A =
  /(REAL ESTATE|REALTY|PROPERT(Y|IES)|LEASING|(^| )HOLDINGS?( |$)|(^| )HOLDING (CO|COMPANY|LLC)|APARTMENT|CONDOMINIUM|(^| )RENTALS?( |$)|DEVELOPMENT|(^| )INVESTMENTS?( |$)|(^| )VENTURES?( |$)|LAND (COMPANY|HOLDING|TRUST)|(^| )REIT( |$)|SOLAR|WIND FARM)/;
const AGENT_NOISE_B =
  /((^| )(CITY|COUNTY|TOWN|VILLAGE|BOROUGH) OF |UNIVERSITY|(^| )AUTHORITY( |$)|MUNICIPAL|BOARD OF EDUCATION|HOUSING AUTHORITY|SCHOOL DISTRICT)/;
function isAgentNoise(name: string | null): boolean {
  const s = (name ?? "").toUpperCase();
  return AGENT_NOISE_A.test(s) || AGENT_NOISE_B.test(s);
}

// Mirror of public.ph_ucc_norm() for the debtor dedupe key (used to detect
// named-funder overlap + to roll agent liens up per debtor consistently).
function phNorm(s: string | null): string {
  return (s ?? "")
    .toUpperCase()
    .replace(
      /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT|FUNDING|FUND|CAPITAL|FINANCIAL|FINANCE|GROUP|SERVICING)\b/g,
      " ",
    )
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function soda(url: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SODA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

function toDate(s: unknown): string | null {
  const v = (s ?? "").toString();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}
const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

type Agent = { pattern: string; canonical: string };
type FilingRow = {
  state: string; filing_no: string; filed_date: string | null; lapse_date: string | null;
  status: string | null; debtor_name: string | null; debtor_address: string | null;
  debtor_city: string | null; debtor_state: string | null; debtor_zip: string | null;
  secured_party_raw: string | null; filing_class: string; raw: Record<string, unknown>;
  source_id: string | null;
};
type Tiers = {
  agent_filings_fresh: number;   // raw fresh agent-masked liens scanned
  agent_debtors: number;         // distinct business debtors with >=1 fresh agent lien
  conf_high: number;             // promoted debtors, 3+ stacked (confidence 'high')
  conf_medium: number;           // promoted debtors, exactly 2 stacked ('medium')
  conf_low: number;              // promoted debtors, single lien ('low')
  excluded_name_noise: number;   // dropped as RE/leasing/holding/gov
  excluded_already_named: number;// already captured as a named_funder lead ('confirmed')
  promoted_debtors: number;      // net-new agent-masked leads stored (all tiers)
  survivor_filing_rows: number;  // agent filing rows stored for promoted debtors
};

// Canonicalize a raw secured-party name to a seeded agent, or null if not an agent.
function matchAgent(raw: string | null, agents: Agent[]): string | null {
  if (!raw) return null;
  const u = raw.toUpperCase();
  for (const a of agents) if (u.includes(a.pattern)) return a.canonical;
  return null;
}

// Build the survivor set from a flat list of {debtorRaw, filingNo, agentCanonical,
// filed_date, ...} agent-lien records. Rolls up per normalized debtor, applies the
// stack/noise/overlap rules, and returns {survivorFilings, tiers}.
function scoreAndSelect(
  state: string,
  liens: Array<{ rec: FilingRow; debtorKey: string }>,
  namedKeys: Set<string>,
): { survivors: FilingRow[]; tiers: Tiers } {
  // group by debtor key → distinct filing_no set + the filing rows + a display name
  const byDebtor = new Map<string, { filings: Map<string, FilingRow>; name: string | null }>();
  for (const { rec, debtorKey } of liens) {
    if (!debtorKey) continue;
    const g = byDebtor.get(debtorKey) ?? { filings: new Map(), name: null };
    if (!g.filings.has(rec.filing_no)) g.filings.set(rec.filing_no, rec);
    if (!g.name || (rec.debtor_name && rec.debtor_name.length > (g.name?.length ?? 0))) g.name = rec.debtor_name;
    byDebtor.set(debtorKey, g);
  }

  const tiers: Tiers = {
    agent_filings_fresh: liens.length,
    agent_debtors: byDebtor.size,
    conf_high: 0, conf_medium: 0, conf_low: 0,
    excluded_name_noise: 0, excluded_already_named: 0,
    promoted_debtors: 0, survivor_filing_rows: 0,
  };
  const survivors: FilingRow[] = [];
  for (const [key, g] of byDebtor) {
    const depth = g.filings.size;
    // Exclusions first (noise + already-captured-as-named); the remainder are all
    // promoted and TIERED by stacking (high 3+ / medium 2 / low 1).
    if (isAgentNoise(g.name)) { tiers.excluded_name_noise++; continue; }
    if (namedKeys.has(key)) { tiers.excluded_already_named++; continue; }
    if (depth >= 3) tiers.conf_high++;
    else if (depth === 2) tiers.conf_medium++;
    else tiers.conf_low++;
    tiers.promoted_debtors++;
    for (const f of g.filings.values()) survivors.push(f);
  }
  tiers.survivor_filing_rows = survivors.length;
  return { survivors, tiers };
}

async function loadNamedKeys(db: SupabaseClient, state: string): Promise<Set<string>> {
  // Named-funder leads for this state are small for the Socrata states (CT/CO/OR).
  const keys = new Set<string>();
  const { data, error } = await db.from("ph_ucc_leads")
    .select("dedupe_key").eq("state", state).eq("lead_class", "named_funder");
  if (error) throw new Error(`load named keys(${state}) failed: ${error.message}`);
  for (const r of (data ?? []) as { dedupe_key: string }[]) keys.add(r.dedupe_key);
  return keys;
}

async function upsertFilings(db: SupabaseClient, rows: FilingRow[]): Promise<number> {
  // Collapse rows that share a dedupe_hash tuple (state|filing_no|secured_party):
  // a lien with co-debtors emits several rows with the SAME (filing, agent) — they
  // collide on the generated dedupe_hash inside one upsert batch ("cannot affect row
  // a second time"). Keep the first (mirrors the named CT ingest's co-debtor collapse).
  const seen = new Set<string>();
  const deduped: FilingRow[] = [];
  for (const r of rows) {
    const k = `${r.state}|${r.filing_no}|${r.secured_party_raw ?? ""}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  rows = deduped;
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error, count } = await db
      .from("ph_ucc_filings")
      .upsert(chunk, { onConflict: "dedupe_hash", ignoreDuplicates: false, count: "exact" });
    if (error) throw new Error(`upsert filings failed: ${error.message}`);
    n += count ?? chunk.length;
  }
  return n;
}

// ── CONNECTICUT ───────────────────────────────────────────────────────────────
async function harvestCT(db: SupabaseClient, sourceId: string | null, agents: Agent[]) {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const agentOr = agents.map((a) => `upper(sec_party_nm_bus) like '%${a.pattern.replace(/'/g, "''")}%'`).join(" OR ");
  const where =
    `lien_status='Active' AND cd_flng_type='ORIG FIN STMT'`
    + ` AND dt_accept > '${cutoff}T00:00:00'`
    + ` AND (dt_lapse IS NULL OR dt_lapse >= '${today}T00:00:00')`
    + ` AND debtor_nm_bus IS NOT NULL AND (${agentOr})`;

  const liens: Array<{ rec: FilingRow; debtorKey: string }> = [];
  let offset = 0;
  for (;;) {
    const rows = await soda(CT_URL, {
      $select: "id_lien_flng_nbr,id_ucc_flng_nbr,debtor_nm_bus,debtor_ad_str1,debtor_ad_city,"
        + "debtor_ad_state,debtor_ad_zip,sec_party_nm_bus,dt_accept,dt_lapse,lien_status",
      $where: where,
      $order: "dt_accept DESC, id_ucc_flng_nbr",
      $limit: String(PAGE), $offset: String(offset),
    });
    if (!rows.length) break;
    for (const r of rows) {
      const debtor = clean(r.debtor_nm_bus);
      const canon = matchAgent(clean(r.sec_party_nm_bus), agents);
      const filingNo = clean(r.id_lien_flng_nbr) ?? clean(r.id_ucc_flng_nbr);
      if (!debtor || !canon || !filingNo) continue;
      liens.push({
        debtorKey: `ct|${phNorm(debtor)}`,
        rec: {
          state: "CT", filing_no: filingNo, filed_date: toDate(r.dt_accept), lapse_date: toDate(r.dt_lapse),
          status: clean(r.lien_status), debtor_name: debtor, debtor_address: clean(r.debtor_ad_str1),
          debtor_city: clean(r.debtor_ad_city), debtor_state: clean(r.debtor_ad_state), debtor_zip: clean(r.debtor_ad_zip),
          secured_party_raw: clean(r.sec_party_nm_bus), filing_class: "agent_masked",
          raw: { source: "CT/xfev-8smz", agent_canonical: canon, sec_party: clean(r.sec_party_nm_bus) },
          source_id: sourceId,
        },
      });
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  const namedKeys = await loadNamedKeys(db, "CT");
  const { survivors, tiers } = scoreAndSelect("CT", liens, namedKeys);
  const upserted = await upsertFilings(db, survivors);
  return { tiers, upserted };
}

// ── OREGON (last-month; accumulates) ────────────────────────────────────────────
async function harvestOR(db: SupabaseClient, sourceId: string | null, agents: Agent[]) {
  // Pull the whole last-month denormalized set, group by file into debtor + secured
  // parties, keep only agent-secured business-debtor liens.
  const byFile = new Map<string, { db: Record<string, unknown>[]; sp: Record<string, unknown>[] }>();
  let offset = 0;
  for (;;) {
    const rows = await soda(OR_URL, { $limit: String(PAGE), $offset: String(offset), $order: "file_number" });
    if (!rows.length) break;
    for (const r of rows) {
      const fn = clean(r.file_number) ?? clean(r.original_file_number);
      if (!fn) continue;
      const g = byFile.get(fn) ?? { db: [], sp: [] };
      const pt = (r.party_type ?? "").toString().toUpperCase();
      if (pt === "SP") g.sp.push(r); else if (pt === "DB") g.db.push(r);
      byFile.set(fn, g);
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  const liens: Array<{ rec: FilingRow; debtorKey: string }> = [];
  for (const [fn, g] of byFile) {
    const d = g.db[0];
    const debtor = d ? clean(d.entity) : null;
    if (!debtor) continue; // business debtor required
    for (const sp of g.sp) {
      const canon = matchAgent(clean(sp.entity), agents);
      if (!canon) continue;
      liens.push({
        debtorKey: `or|${phNorm(debtor)}`,
        rec: {
          state: "OR", filing_no: fn, filed_date: toDate(sp.filing_date ?? d?.filing_date),
          lapse_date: toDate(sp.lapse_date ?? d?.lapse_date), status: clean(sp.lien_type),
          debtor_name: debtor, debtor_address: d ? clean(d.mail_addr_1) : null,
          debtor_city: d ? clean(d.city_descr) : null, debtor_state: d ? clean(d.st_cd_txt) : null,
          debtor_zip: d ? clean(d.zip_code_txt) : null, secured_party_raw: clean(sp.entity),
          filing_class: "agent_masked",
          raw: { source: "OR/snfi-f79b", agent_canonical: canon, sec_party: clean(sp.entity) },
          source_id: sourceId,
        },
      });
    }
  }
  // OR's window is "last month", so cross-month stacking accumulates in ph_ucc_filings;
  // store every fresh non-noise, non-already-named agent lien (they are few) and let
  // the rebuild tier by accumulated stack depth.
  const namedKeys = await loadNamedKeys(db, "OR");
  const { survivors, tiers } = scoreAndSelect("OR", liens, namedKeys);
  const upserted = await upsertFilings(db, survivors);
  return { tiers, upserted, note: "OR window is last-month; stacking accumulates in ph_ucc_filings across runs (rebuild re-tiers)." };
}

// ── COLORADO (3-table join, concurrent hydration) ───────────────────────────────
async function pMapChunks<T>(items: string[][], fn: (c: string[]) => Promise<T[]>, conc: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i += conc) {
    const batch = items.slice(i, i + conc);
    const res = await Promise.all(batch.map(fn));
    for (const r of res) out.push(...r);
  }
  return out;
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function harvestCO(db: SupabaseClient, sourceId: string | null, agents: Agent[]) {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const agentOr = agents.map((a) => `upper(organizationname) like '%${a.pattern.replace(/'/g, "''")}%'`).join(" OR ");

  // 1) agent fileids + agent (paged).
  const agentByFile = new Map<string, string>(); // fileid → canonical agent
  let offset = 0;
  for (;;) {
    if (agentByFile.size >= CO_MAX_AGENT_FILES) break;
    const rows = await soda(`${CO_BASE}/${CO_SECURED}.json`, {
      $select: "fileid,organizationname",
      $where: `(${agentOr}) AND fileid IS NOT NULL`,
      $order: "fileid", $limit: String(PAGE), $offset: String(offset),
    });
    if (!rows.length) break;
    for (const r of rows) {
      const fid = clean(r.fileid);
      const canon = matchAgent(clean(r.organizationname), agents);
      if (fid && canon && !agentByFile.has(fid)) agentByFile.set(fid, canon);
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  const allFileIds = Array.from(agentByFile.keys());

  // 2) filing dates/status for those fileids (concurrent) → keep fresh + non-terminated.
  const filingMeta = new Map<string, Record<string, unknown>>();
  {
    const idChunks = chunk(allFileIds, HYDRATE_CHUNK).map((ids) => ids);
    const rows = await pMapChunks(idChunks, (ids) => soda(`${CO_BASE}/${CO_FILING}.json`, {
      $select: "fileid,filingdate,lapsedate,terminationflag",
      $where: `fileid in (${ids.join(",")}) AND filingdate >= '${cutoff}T00:00:00'`
            + ` AND (terminationflag IS NULL OR terminationflag = false)`,
      $limit: String(HYDRATE_CHUNK * 4),
    }), HYDRATE_CONCURRENCY);
    for (const f of rows) { const fid = clean(f.fileid); if (fid) filingMeta.set(fid, f); }
  }
  const liveFileIds = allFileIds.filter((f) => filingMeta.has(f));

  // 3) debtor for the LIVE fileids (concurrent).
  const debtorByFile = new Map<string, Record<string, unknown>>();
  {
    const idChunks = chunk(liveFileIds, HYDRATE_CHUNK);
    const rows = await pMapChunks(idChunks, (ids) => soda(`${CO_BASE}/${CO_DEBTOR}.json`, {
      $select: "fileid,organizationname,lastname,firstname,address1,city,state,zipcode",
      $where: `fileid in (${ids.join(",")})`, $limit: String(HYDRATE_CHUNK * 8),
    }), HYDRATE_CONCURRENCY);
    for (const d of rows) {
      const fid = clean(d.fileid); if (!fid) continue;
      const prev = debtorByFile.get(fid);
      if (!prev || (!clean(prev.organizationname) && clean(d.organizationname))) debtorByFile.set(fid, d);
    }
  }

  // 4) build agent liens (business debtors only) + score.
  const liens: Array<{ rec: FilingRow; debtorKey: string }> = [];
  for (const fid of liveFileIds) {
    const d = debtorByFile.get(fid);
    const debtor = d ? clean(d.organizationname) : null; // business debtor only
    if (!debtor) continue;
    const f = filingMeta.get(fid)!;
    const canon = agentByFile.get(fid)!;
    liens.push({
      debtorKey: `co|${phNorm(debtor)}`,
      rec: {
        state: "CO", filing_no: fid, filed_date: toDate(f.filingdate), lapse_date: toDate(f.lapsedate),
        status: "Active", debtor_name: debtor, debtor_address: d ? clean(d.address1) : null,
        debtor_city: d ? clean(d.city) : null, debtor_state: d ? clean(d.state) : null,
        debtor_zip: d ? clean(d.zipcode) : null, secured_party_raw: canon, filing_class: "agent_masked",
        raw: { source: "CO/ap62-sav4+wffy-3uut+8upq-58vz", agent_canonical: canon },
        source_id: sourceId,
      },
    });
  }
  const namedKeys = await loadNamedKeys(db, "CO");
  const { survivors, tiers } = scoreAndSelect("CO", liens, namedKeys);
  const upserted = await upsertFilings(db, survivors);
  return { tiers, upserted, agent_fileids: allFileIds.length, live_fileids: liveFileIds.length };
}

const HARVESTERS: Record<string, (db: SupabaseClient, src: string | null, a: Agent[]) => Promise<Record<string, unknown>>> = {
  CT: harvestCT, OR: harvestOR, CO: harvestCO,
};

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
  const stateParam = String(payload.state ?? url.searchParams.get("state") ?? "CT").toUpperCase();
  const started = Date.now();

  // Load the agent dictionary once.
  const { data: agentRows, error: aErr } = await db.from("ph_ucc_agents").select("pattern,canonical_agent").eq("active", true);
  if (aErr) return json({ ok: false, error: `load agents failed: ${aErr.message}` }, 500);
  const agents: Agent[] = (agentRows ?? []).map((r: Record<string, unknown>) => ({
    pattern: String(r.pattern).toUpperCase(), canonical: String(r.canonical_agent),
  }));
  if (!agents.length) return json({ ok: false, error: "no active agent patterns in ph_ucc_agents" }, 500);

  const { data: sources } = await db.from("ph_ucc_sources").select("id,state");
  const srcOf = (st: string) => (sources ?? []).find((s: Record<string, unknown>) => s.state === st)?.id ?? null;

  const targets = stateParam === "ALL" ? Object.keys(HARVESTERS) : [stateParam];
  const results: Record<string, unknown> = {};
  let totalUpserted = 0;
  for (const st of targets) {
    if (!HARVESTERS[st]) { results[st] = { skipped: true, reason: `no agent harvester for ${st} (CA/FL via loaders)` }; continue; }
    try {
      const r = await HARVESTERS[st](db, srcOf(st), agents);
      results[st] = r;
      totalUpserted += (r.upserted as number) ?? 0;
    } catch (e) {
      results[st] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Materialize agent_masked leads from everything now stored.
  const { data: rebuilt, error: rbErr } = await db.rpc("ph_ucc_rebuild_masked_leads", { p_min_stack: MIN_STACK });
  if (rbErr) results.rebuild_error = rbErr.message;
  else results.rebuild = Array.isArray(rebuilt) ? rebuilt[0] : rebuilt;

  const anyError = Object.values(results).some((r) => (r as { error?: string }).error) || !!results.rebuild_error;
  return json({
    ok: !anyError, state: stateParam, filings_upserted: totalUpserted,
    elapsed_ms: Date.now() - started, ...results,
  }, anyError ? 207 : 200);
});
