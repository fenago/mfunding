// ph-ucc-ingest — pull UCC financing-statement filings from state open-data
// portals into ph_ucc_filings, then rebuild the ranked/gated ph_ucc_leads.
//
// This is the DATA PULL half of the PH UCC List Machine. It NEVER touches GHL,
// never dials, never appends a phone. It only fills ph_ucc_filings from public
// government data and runs the SQL matcher (ph_ucc_rebuild_leads). Everything
// downstream (skip-trace, TCPA scrub, GHL load) is gated elsewhere and OFF by
// default.
//
// SOURCES (verified live 2026-08-02):
//   CO  Socrata — Filing wffy-3uut / Debtor 8upq-58vz / SecuredParty ap62-sav4,
//       joined on fileid. TARGETED: query secured parties matching our funder
//       aliases, then hydrate their filings + debtors. Resumable by alias cursor.
//   OR  Socrata — snfi-f79b "UCC List of Filings Entered Last Month",
//       denormalized (party_type DB/SP). FULL ingest each run (~5.7k rows), then
//       PRE-FILTERED to MCA-funder matches before insert (like CT / the file
//       loaders) — the raw dump is ~99% bank/equipment/tax/ag liens.
//   CT  Socrata — xfev-8smz "UCC Lien Filings (4.0 Revised)", one row per
//       filing×party already carrying BOTH debtor and secured-party name+address.
//       We take ORIG FIN STMT + Active + non-lapsed inside the 540d window (dt_accept
//       is the true origination date; amendments would make an old lien look fresh).
//       ~62k rows in-window → resumable by row offset (ct_cursor), like CO. Rows are
//       PRE-FILTERED to MCA-funder matches (like the CA/FL file loaders) before
//       insert — only ~0.5% match, so we never store the bank/equipment firehose.
//   VA  CKAN — UNUSABLE: the portal's UCC datasets carry filing metadata only,
//       no debtor/secured-party names. Returns a loud skip; ingests nothing.
//   CA  bizfile master unload — awaiting the owner's $100 purchase; loader TODO.
//
// AUTH (mirrors email-verify-sweep): trusted cron via ?secret=<GHL webhook
// secret> + anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin).
// A service-role bearer deliberately fails the role check — use the secret path.
//
// The matcher is the single source of truth for what counts as an MCA position:
// over-fetching in CO's LIKE query is harmless because ph_ucc_rebuild_leads()
// re-confirms every secured party with normalized-contains against the aliases.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const CO_BASE = "https://data.colorado.gov/resource";
const CO_FILING = "wffy-3uut";
const CO_DEBTOR = "8upq-58vz";
const CO_SECURED = "ap62-sav4";
const OR_URL = "https://data.oregon.gov/resource/snfi-f79b.json";
const CT_URL = "https://data.ct.gov/resource/xfev-8smz.json";

// Wall-clock budget: stop starting new per-alias work past this so the function
// returns before the platform kills it. CO is resumable (alias cursor), so a
// truncated run simply continues on the next invocation.
const BUDGET_MS = 55_000;          // stop STARTING new alias terms past this
const PAGE = 1000;                 // Socrata max page
const CO_MAX_PER_TERM = 4000;      // cap a single funder's secured-party pull
const CO_MAX_FILES_PER_RUN = 6000; // cap fileids collected per run so hydration fits the wall
const CHUNK = 150;                 // fileid IN-list chunk size
// CO carries filings back to the 1960s. The product edge is FRESH positions and a
// TERMINATED lien is a closed (paid-off) position — not an MCA to poach. So we keep
// only non-terminated filings inside a rolling window. 540d (~18mo) keeps enough
// history for a meaningful stack-depth signal without dialing ancient dead liens.
const CO_WINDOW_DAYS = 540;
// CT: same freshness policy as CO. dt_accept (origination date) inside a rolling
// 540d window, Active + non-lapsed only. Resumable by row offset per invocation.
const CT_WINDOW_DAYS = 540;
const CT_MAX_ROWS_PER_RUN = 60_000; // safety cap on rows collected per invocation

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fire a self-reinvocation (cron/secret path only) so a multi-invocation chain
// finishes from a single cron fire — one instance can't process every CO alias
// term (or every CT page) inside the wall clock, so it hands the next cursor to a
// child. Terminates naturally when the state stops returning a next_cursor.
function selfReinvoke(secret: string, body: Record<string, unknown>): void {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ph-ucc-ingest?secret=${encodeURIComponent(secret)}`;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
    body: JSON.stringify(body),
  }).then(() => {}).catch((e) => console.error("[ph-ucc-ingest] self-reinvoke failed:", e));
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

// ── Socrata / CKAN fetch helpers ────────────────────────────────────────────
async function soda(dataset: string, base: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${base}/${dataset}.json?${qs}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SODA ${dataset} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
async function sodaUrl(url: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SODA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

function toDate(s: string | null | undefined): string | null {
  if (!s) return null;
  // Socrata floating timestamps ("2026-06-30T00:00:00.000") or "M/D/YYYY ..."
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}
const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

type FilingRow = {
  state: string; filing_no: string; filed_date: string | null; lapse_date: string | null;
  status: string | null; debtor_name: string | null; debtor_address: string | null;
  debtor_city: string | null; debtor_state: string | null; debtor_zip: string | null;
  secured_party_raw: string | null; raw: Record<string, unknown>; source_id: string | null;
};

async function upsertFilings(db: SupabaseClient, rows: FilingRow[]): Promise<number> {
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

// ── PRE-FILTER: keep ONLY MCA-funder-matched filings ─────────────────────────
// Discards the ~99% bank/equipment/auto/tax/ag firehose BEFORE it lands in
// ph_ucc_filings (like the CA/FL file loaders), so we neither store nor re-read
// (weekly egress) rows we never turn into leads. The match is delegated to the
// public.ph_ucc_match_secured_parties() rpc, which runs the EXACT predicate of
// ph_ucc_rebuild_leads (active alias, alias_norm>=3, trgm+token-boundary LIKE,
// AND NOT ph_ucc_is_depository). Delegating (vs. re-implementing the norm+guard
// in TS) guarantees the ingest's notion of "matched" can never diverge from the
// rebuild's, so we never drop a filing the rebuild would have kept.
//
// SAFE FOR API/Socrata STATES ONLY (CT, OR): non-matches are discarded, so if the
// alias dictionary changes later we could no longer re-match rows we never kept —
// acceptable because the free data.ct.gov / data.oregon.gov endpoints are always
// re-pullable. NOT applied to paid FILE states (CA/FL) whose master unloads can't
// be cheaply re-fetched — those loaders keep their own local pre-filter.
async function keepFunderMatches(db: SupabaseClient, rows: FilingRow[]): Promise<FilingRow[]> {
  if (!rows.length) return rows;
  const distinctSp = Array.from(
    new Set(rows.map((r) => r.secured_party_raw).filter((s): s is string => !!s)),
  );
  const keep = new Set<string>();
  for (let i = 0; i < distinctSp.length; i += 2000) { // chunk the array arg
    const slice = distinctSp.slice(i, i + 2000);
    const { data, error } = await db.rpc("ph_ucc_match_secured_parties", { p_parties: slice });
    if (error) throw new Error(`ph_ucc_match_secured_parties failed: ${error.message}`);
    for (const row of (data ?? []) as string[]) keep.add(row);
  }
  return rows.filter((r) => r.secured_party_raw && keep.has(r.secured_party_raw));
}

// ── OREGON: full ingest of the "last month" denormalized dataset ─────────────
async function ingestOR(db: SupabaseClient, sourceId: string | null) {
  const byFile = new Map<string, { db: any[]; sp: any[] }>();
  let offset = 0;
  let fetched = 0;
  for (;;) {
    const rows = await sodaUrl(OR_URL, { $limit: String(PAGE), $offset: String(offset), $order: "file_number" });
    if (!rows.length) break;
    fetched += rows.length;
    for (const r of rows) {
      const fn = clean(r.file_number) ?? clean(r.original_file_number);
      if (!fn) continue;
      const g = byFile.get(fn) ?? { db: [], sp: [] };
      if ((r.party_type ?? "").toUpperCase() === "SP") g.sp.push(r);
      else if ((r.party_type ?? "").toUpperCase() === "DB") g.db.push(r);
      byFile.set(fn, g);
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  const out: FilingRow[] = [];
  for (const [fn, g] of byFile) {
    if (!g.sp.length) continue; // no secured party → nothing to match
    const d = g.db[0]; // primary debtor
    for (const sp of g.sp) {
      out.push({
        state: "OR",
        filing_no: fn,
        filed_date: toDate(sp.filing_date ?? d?.filing_date),
        lapse_date: toDate(sp.lapse_date ?? d?.lapse_date),
        status: clean(sp.lien_type) ? `${clean(sp.lien_type)}` : null,
        debtor_name: d ? clean(d.entity) : null,
        debtor_address: d ? clean(d.mail_addr_1) : null,
        debtor_city: d ? clean(d.city_descr) : null,
        debtor_state: d ? clean(d.st_cd_txt) : null,
        debtor_zip: d ? clean(d.zip_code_txt) : null,
        secured_party_raw: clean(sp.entity),
        raw: { source: "OR/snfi-f79b", secured_party: sp, debtors: g.db },
        source_id: sourceId,
      });
    }
  }
  // Pre-filter to MCA-funder matches only (OR's "last month" dump is ~99% bank/
  // equipment/tax/ag liens — SNAP-ON, KUBOTA, IRS, DEERE, etc. — never leads).
  const candidates = out.length;
  const matched = await keepFunderMatches(db, out);
  const upserted = await upsertFilings(db, matched);
  return {
    fetched, files: byFile.size, candidates, filing_rows: matched.length,
    discarded: candidates - matched.length, upserted, newest: maxFiled(matched),
  };
}

// Newest filed_date across a batch of rows (ISO date string) or null.
function maxFiled(rows: FilingRow[]): string | null {
  let m: string | null = null;
  for (const r of rows) if (r.filed_date && (!m || r.filed_date > m)) m = r.filed_date;
  return m;
}

// Accurate newest filed_date for a state from the DB (survives CO's chunk chain).
async function newestFor(db: SupabaseClient, state: string): Promise<string | null> {
  const { data } = await db.from("ph_ucc_filings")
    .select("filed_date").eq("state", state)
    .order("filed_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return (data?.filed_date as string | null) ?? null;
}

// Total filings HELD for a state (the meaningful "rows ingested" for the source
// card — a per-invocation count would show only CO's last chunk).
async function filingsHeld(db: SupabaseClient, state: string): Promise<number> {
  const { count } = await db.from("ph_ucc_filings")
    .select("id", { count: "exact", head: true }).eq("state", state);
  return count ?? 0;
}

// ── COLORADO: targeted secured-party ingest, resumable by alias cursor ──────
async function ingestCO(
  db: SupabaseClient, sourceId: string | null, startCursor: number, started: number,
) {
  // Distinct, safe LIKE terms from active aliases (≥4 alnum chars to avoid junk).
  const { data: aliasRows, error: aErr } = await db
    .from("ph_ucc_funder_aliases").select("alias").eq("active", true);
  if (aErr) throw new Error(`load aliases failed: ${aErr.message}`);
  const terms = Array.from(new Set(
    (aliasRows ?? [])
      .map((r: any) => (r.alias ?? "").toUpperCase().replace(/[^A-Z0-9 &.\-]/g, " ").replace(/\s+/g, " ").trim())
      .filter((t: string) => t.replace(/[^A-Z0-9]/g, "").length >= 4),
  )).sort();

  // 1) Collect matched (fileid → secured party names) for a slice of terms.
  const spByFile = new Map<string, Set<string>>();
  let cursor = startCursor;
  let termsRun = 0;
  let budgetHit = false;
  for (; cursor < terms.length; cursor++) {
    if (Date.now() - started > BUDGET_MS) { budgetHit = true; break; }
    if (spByFile.size >= CO_MAX_FILES_PER_RUN) { budgetHit = true; break; }
    const term = terms[cursor].replace(/'/g, "''");
    let off = 0;
    for (;;) {
      const rows = await soda(CO_SECURED, CO_BASE, {
        $select: "fileid,organizationname",
        $where: `upper(organizationname) like '%${term}%' AND fileid IS NOT NULL`,
        $limit: String(PAGE), $offset: String(off),
      });
      for (const r of rows) {
        const fid = clean(r.fileid);
        if (!fid) continue;
        const set = spByFile.get(fid) ?? new Set<string>();
        if (clean(r.organizationname)) set.add(clean(r.organizationname)!);
        spByFile.set(fid, set);
      }
      off += rows.length;
      if (rows.length < PAGE || off >= CO_MAX_PER_TERM) break;
    }
    termsRun++;
  }

  const fileIds = Array.from(spByFile.keys());
  const cutoff = new Date(Date.now() - CO_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  // 2) Hydrate filings (dates/status) + debtors for those fileids, chunked.
  //    Filings query drops terminated + out-of-window at the source; a fileid with
  //    no surviving filing is dropped in the emit step below.
  const filingMeta = new Map<string, any>();
  const debtorByFile = new Map<string, any>();
  for (let i = 0; i < fileIds.length; i += CHUNK) {
    const ids = fileIds.slice(i, i + CHUNK);
    const inList = ids.join(",");
    const [fils, debs] = await Promise.all([
      soda(CO_FILING, CO_BASE, {
        $select: "fileid,filingdate,lapsedate,filingtype,transactiontype,terminationflag",
        $where: `fileid in (${inList}) AND filingdate >= '${cutoff}T00:00:00'`
              + ` AND (terminationflag IS NULL OR terminationflag = false)`,
        $limit: String(CHUNK * 4),
      }),
      soda(CO_DEBTOR, CO_BASE, {
        $select: "fileid,organizationname,lastname,firstname,address1,city,state,zipcode,recordstatus",
        $where: `fileid in (${inList})`, $limit: String(CHUNK * 8),
      }),
    ]);
    for (const f of fils) if (clean(f.fileid)) filingMeta.set(clean(f.fileid)!, f);
    for (const d of debs) {
      const fid = clean(d.fileid);
      if (!fid) continue;
      // prefer an organization debtor; else keep first seen
      const prev = debtorByFile.get(fid);
      if (!prev || (!clean(prev.organizationname) && clean(d.organizationname))) debtorByFile.set(fid, d);
    }
  }

  // 3) Build normalized filing rows (one per fileid × secured party).
  const out: FilingRow[] = [];
  for (const [fid, sps] of spByFile) {
    const f = filingMeta.get(fid);
    if (!f) continue; // terminated or outside the freshness window → not a live position
    const d = debtorByFile.get(fid);
    const debtorName = d
      ? (clean(d.organizationname) ??
         ([clean(d.lastname), clean(d.firstname)].filter(Boolean).join(", ") || null))
      : null;
    for (const sp of sps) {
      out.push({
        state: "CO",
        filing_no: fid,
        filed_date: toDate(f?.filingdate),
        lapse_date: toDate(f?.lapsedate),
        status: f?.terminationflag === true || f?.terminationflag === "true" ? "Terminated" : "Active",
        debtor_name: debtorName,
        debtor_address: d ? clean(d.address1) : null,
        debtor_city: d ? clean(d.city) : null,
        debtor_state: d ? clean(d.state) : null,
        debtor_zip: d ? clean(d.zipcode) : null,
        secured_party_raw: sp,
        raw: { source: "CO/ap62-sav4", filing: f ?? null, debtor: d ?? null },
        source_id: sourceId,
      });
    }
  }
  const upserted = await upsertFilings(db, out);
  const nextCursor = budgetHit ? cursor : null; // null = finished all terms
  return {
    terms_total: terms.length, terms_run: termsRun, next_cursor: nextCursor,
    matched_files: fileIds.length, kept_after_window: out.length ? new Set(out.map((r) => r.filing_no)).size : 0,
    filing_rows: out.length, upserted, window_days: CO_WINDOW_DAYS, newest: maxFiled(out),
  };
}

// ── CONNECTICUT: full-window ingest of the revised UCC dataset, resumable ────
// One row per filing×party already carries debtor + secured party, so there is
// no join (unlike CO) and no last-month scoping (unlike OR) — just page the
// ORIG-FIN-STMT / Active / non-lapsed slice inside the 540d window, newest first.
async function ingestCT(
  db: SupabaseClient, sourceId: string | null, startOffset: number, started: number,
) {
  const cutoff = new Date(Date.now() - CT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // Freshness/quality gate at the source: originating statements only (dt_accept =
  // true origination date), still Active, not yet lapsed.
  const where =
    `lien_status='Active' AND cd_flng_type='ORIG FIN STMT'`
    + ` AND dt_accept > '${cutoff}T00:00:00'`
    + ` AND (dt_lapse IS NULL OR dt_lapse >= '${today}T00:00:00')`;

  let offset = startOffset;
  let fetched = 0;
  let budgetHit = false;
  const out: FilingRow[] = [];
  // A lien with co-debtors emits several rows sharing (state|filing_no|secured_party),
  // which collide on the generated dedupe_hash and blow up a single upsert batch
  // ("ON CONFLICT ... cannot affect row a second time"). Collapse to the first row
  // per key (mirrors dedupe_hash = lower(state|filing_no|coalesce(secured_party,''))).
  const seen = new Set<string>();
  for (;;) {
    if (Date.now() - started > BUDGET_MS) { budgetHit = true; break; }
    if (out.length >= CT_MAX_ROWS_PER_RUN) { budgetHit = true; break; }
    const rows = await sodaUrl(CT_URL, {
      $select: "id_lien_flng_nbr,id_ucc_flng_nbr,lien_status,cd_flng_type,"
        + "debtor_nm_bus,debtor_nm_last,debtor_nm_first,debtor_ad_str1,debtor_ad_city,debtor_ad_state,debtor_ad_zip,"
        + "sec_party_nm_bus,sec_party_nm_last,sec_party_nm_first,dt_accept,dt_lapse",
      $where: where,
      $order: "dt_accept DESC, id_ucc_flng_nbr", // stable tiebreaker for offset paging
      $limit: String(PAGE), $offset: String(offset),
    });
    if (!rows.length) break;
    fetched += rows.length;
    for (const r of rows) {
      const debtor = clean(r.debtor_nm_bus)
        ?? ([clean(r.debtor_nm_last), clean(r.debtor_nm_first)].filter(Boolean).join(", ") || null);
      const sp = clean(r.sec_party_nm_bus)
        ?? ([clean(r.sec_party_nm_last), clean(r.sec_party_nm_first)].filter(Boolean).join(", ") || null);
      const filingNo = clean(r.id_lien_flng_nbr) ?? clean(r.id_ucc_flng_nbr); // lien no collapses amendments
      if (!sp || !filingNo) continue; // no secured party or no key → nothing to match
      const key = `ct|${filingNo}|${sp}`.toLowerCase();
      if (seen.has(key)) continue; // co-debtor dup on same lien+party
      seen.add(key);
      out.push({
        state: "CT",
        filing_no: filingNo,
        filed_date: toDate(r.dt_accept),
        lapse_date: toDate(r.dt_lapse),
        status: clean(r.lien_status),
        debtor_name: debtor,
        debtor_address: clean(r.debtor_ad_str1),
        debtor_city: clean(r.debtor_ad_city),
        debtor_state: clean(r.debtor_ad_state),
        debtor_zip: clean(r.debtor_ad_zip),
        secured_party_raw: sp,
        raw: { source: "CT/xfev-8smz", row: r },
        source_id: sourceId,
      });
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  // Pre-filter to MCA-funder matches only (see keepFunderMatches) — CT's Socrata
  // firehose is ~99.5% bank/equipment/auto/ag liens we never turn into leads.
  const candidates = out.length;
  const matched = await keepFunderMatches(db, out);
  const upserted = await upsertFilings(db, matched);
  const nextOffset = budgetHit ? offset : null; // null = window exhausted
  return {
    fetched, candidates, filing_rows: matched.length, discarded: candidates - matched.length,
    upserted, next_cursor: nextOffset, window_days: CT_WINDOW_DAYS, newest: maxFiled(matched),
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

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* GET/cron */ }
  const stateParam = String(payload.state ?? url.searchParams.get("state") ?? "ALL").toUpperCase();
  const coCursor = Number(payload.co_cursor ?? url.searchParams.get("co_cursor") ?? 0) || 0;
  const ctCursor = Number(payload.ct_cursor ?? url.searchParams.get("ct_cursor") ?? 0) || 0;
  const started = Date.now();

  // Resolve source rows once.
  const { data: sources } = await db.from("ph_ucc_sources").select("id,state,status,name");
  const srcOf = (st: string) => (sources ?? []).find((s: any) => s.state === st) ?? null;

  const results: Record<string, unknown> = {};
  const want = (st: string) => stateParam === "ALL" || stateParam === st;

  try {
    if (want("OR")) {
      const s = srcOf("OR");
      const r = await ingestOR(db, s?.id ?? null);
      results.OR = r;
      if (s) await db.from("ph_ucc_sources").update({
        last_pull_at: new Date().toISOString(), last_rows: await filingsHeld(db, "OR"), status: "active",
        newest_filing_date: await newestFor(db, "OR"),
        notes: `Last run ${new Date().toISOString()}: +${r.upserted} filing-rows from ${r.files} files.`,
      }).eq("id", s.id);
    }

    if (want("CO")) {
      const s = srcOf("CO");
      const r = await ingestCO(db, s?.id ?? null, coCursor, started);
      results.CO = r;
      if (s) await db.from("ph_ucc_sources").update({
        last_pull_at: new Date().toISOString(), last_rows: await filingsHeld(db, "CO"),
        last_cursor: r.next_cursor === null ? null : String(r.next_cursor), status: "active",
        newest_filing_date: await newestFor(db, "CO"),
        notes: `Last run ${new Date().toISOString()}: +${r.upserted} filing-rows; terms ${r.terms_run}/${r.terms_total}${r.next_cursor !== null ? ` (RESUME at co_cursor=${r.next_cursor})` : " (complete, ≤" + CO_WINDOW_DAYS + "d window)"}.`,
      }).eq("id", s.id);
    }

    if (want("CT")) {
      const s = srcOf("CT");
      const r = await ingestCT(db, s?.id ?? null, ctCursor, started);
      results.CT = r;
      if (s) await db.from("ph_ucc_sources").update({
        last_pull_at: new Date().toISOString(), last_rows: await filingsHeld(db, "CT"),
        last_cursor: r.next_cursor === null ? null : String(r.next_cursor), status: "active",
        newest_filing_date: await newestFor(db, "CT"),
        notes: `Last run ${new Date().toISOString()}: +${r.upserted} filing-rows (${r.fetched} fetched)${r.next_cursor !== null ? ` (RESUME at ct_cursor=${r.next_cursor})` : ` (complete, ≤${CT_WINDOW_DAYS}d window)`}.`,
      }).eq("id", s.id);
    }

    if (want("VA")) {
      // LOUD, honest skip — the source genuinely lacks party names.
      results.VA = {
        skipped: true, ingested: 0, status: "unusable",
        reason: "Virginia SCC open data (odgavaprod.ogopendata.com) exposes only filing-details (322 rows of amendment metadata) and lien-details (471k rows of filing metadata: IFS/file number, dates, lien/filing type, status). NEITHER carries debtor names or secured-party names, so MCA-position matching is impossible from this source. A paid/scraped source (cis.scc.virginia.gov) would be required.",
      };
    }

    if (want("CA")) {
      results.CA = {
        skipped: true, ingested: 0, status: "awaiting_purchase",
        reason: "California requires the $100 bizfile master data unload (weekly deltas free). Loader is a documented TODO; awaiting the owner's purchased file. Format per bpd.cdn.sos.ca.gov/ucc/ucc-fee-schedule.pdf.",
      };
    }

    // Rebuild leads from whatever is now in ph_ucc_filings.
    const { data: rebuilt, error: rbErr } = await db.rpc("ph_ucc_rebuild_leads");
    if (rbErr) results.matcher_error = rbErr.message;
    else results.matcher = Array.isArray(rebuilt) ? rebuilt[0] : rebuilt;

    // Continue CO's chain automatically on the cron/secret path.
    const coNext = (results.CO as { next_cursor?: number | null } | undefined)?.next_cursor;
    if (providedSecret && want("CO") && coNext !== null && coNext !== undefined) {
      selfReinvoke(providedSecret, { state: "CO", co_cursor: coNext });
      results.self_reinvoked_co_cursor = coNext;
    }

    // Continue CT's page chain automatically on the cron/secret path.
    const ctNext = (results.CT as { next_cursor?: number | null } | undefined)?.next_cursor;
    if (providedSecret && want("CT") && ctNext !== null && ctNext !== undefined) {
      selfReinvoke(providedSecret, { state: "CT", ct_cursor: ctNext });
      results.self_reinvoked_ct_cursor = ctNext;
    }

    // Top-level rows_ingested for the dashboard's "+N rows" toast (sums states run).
    const rowsIngested =
      ((results.OR as { upserted?: number } | undefined)?.upserted ?? 0) +
      ((results.CO as { upserted?: number } | undefined)?.upserted ?? 0) +
      ((results.CT as { upserted?: number } | undefined)?.upserted ?? 0);

    return json({ ok: true, state: stateParam, rows_ingested: rowsIngested, elapsed_ms: Date.now() - started, ...results });
  } catch (e) {
    console.error("[ph-ucc-ingest] FAILED", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), partial: results }, 500);
  }
});
