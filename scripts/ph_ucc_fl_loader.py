#!/usr/bin/env python3
"""PH UCC — Florida full-download loader (floridaucc.com).

Corrects an earlier WRONG research conclusion that FL was privatized with no bulk
file. floridaucc.com/download offers FREE full downloads (regenerated each
business day, plus a smaller daily "regular" delta file). FL is the owner's home
state and a top-3 MCA market, so this is high-value: the data carries both debtor
(merchant) org names + addresses AND secured-party (funder) names — everything the
PH UCC matcher needs.

DATA SHAPE (pipe-delimited CSV, header row, latin-1; join key = Ucc1FilingNumber):
  filings_full  : Ucc1FilingNumber | FilingDate(MM/DD/YYYY) | ... | FilingStatus
                  (Filed / Lapsed / Cancelled) | FilingCancelDate | FilingExpDate | ...
  debtors_full  : Ucc1FilingNumber | DebName | DebNameFormat(C=company,P=person) |
                  DebAddressLine1/2 | DebCity | DebState | DebZipCode | ... | DebOrigParty
  secureds_full : Ucc1FilingNumber | SecName | ... | SecCity | SecStateProvince | ...
  events_full   : UCC3 amendments/continuations/terminations (NOT needed — filing
                  status + FilingExpDate already give us live-vs-lapsed).

PIPELINE (mirrors the CO/CA loaders + ph_ucc_rebuild_leads exactly):
  1. Pull active alias_norms from ph_ucc_funder_aliases (212 as of 2026-08-02).
  2. Apply the FL PRECISION BLOCKLIST (below): bare generic-word aliases whose FL
     matches are demonstrably NON-MCA. Verified against real matched names, e.g.
     NATIONAL matched 13,388 BANK filings (PNC, Huntington, TD, City National…).
     Loading those would inject false MCA positions into a dialer feed. The DB
     rebuild only re-matches rows we insert, so blocking here keeps the banks out
     of ph_ucc_filings entirely.
  3. Freshness discipline (same as CO_WINDOW_DAYS=540): keep only FilingStatus='Filed'
     filed within the last 540 days; drop Lapsed/Cancelled (a closed lien is a
     paid-off position, not an MCA to poach).
  4. Token-boundary match ph_ucc_norm(SecName) vs each alias_norm (faithful port of
     public.ph_ucc_norm + the migration-03 boundary rule).
  5. Join each matched filing to its best debtor (prefer company format, original
     party, longest name) → one ph_ucc_filings row per (filing_no × matched SP).
  6. Bulk-insert into ph_ucc_filings (state='FL') via the Supabase management API
     (runs as postgres, bypasses RLS — no service_role key needed locally), upsert
     the ph_ucc_sources FL row, then call ph_ucc_rebuild_leads() which scores +
     gates every lead (all land at needs_skiptrace; nothing dials — ucc_load_enabled
     stays false). deBanked shell aliases apply automatically via the alias dict.

RESULT of the 20260729 full file (2026-08-02): 5.64M filings → 279,423 fresh-Filed
in 540d → 7,050 MCA-matched filing rows (7,049 distinct filings) → 6,626 distinct FL
debtor leads across 44 real funders; 369 stacked ≥2, 40 ≥3; 931 fresh ≤90d; 1,189
surfaced via deBanked shell/alias mappings. Total ph_ucc_leads 773 → 7,399.

USAGE:
  Download the four *_full.zip from floridaucc.com/download into --downloads dir.
  SUPABASE_ACCESS_TOKEN must be set (management-API token; read from repo .env).
    python scripts/ph_ucc_fl_loader.py --downloads ~/Downloads --project-ref ehibjeonqpqskhcvizow
  Add --dry-run to filter/join + print stats WITHOUT touching the DB.

NAMING LAW: every asset stays ph_ucc_* / state='FL'. Touches no MCA/VCF assets.
Data files are NEVER committed — only this loader.
"""
import argparse, csv, io, json, os, re, sys, urllib.request, zipfile
from datetime import date, datetime

WINDOW_DAYS = 540
csv.field_size_limit(10_000_000)

# FL PRECISION BLOCKLIST — see module docstring. Bare generic-word aliases whose
# FL matches are banks / credit unions / individuals / real-estate / debt-buyers /
# private-credit funds, NOT MCA funders. Kept OUT of the FL load only (the shared
# alias dictionary is untouched so CO/CA/OR are unaffected).
BLOCKLIST = {
    "NATIONAL", "EXPRESS", "VALUE", "VELOCITY", "ROK", "RETAIL", "NETWORK",
    "STRATEGIC", "GRP", "RELIANCE", "INTREPID", "MULLIGAN", "CIRCLE",
    "FINANCING SOLUTIONS", "TANGO", "DIESEL", "FOX", "HEADWAY", "DAVID ALLEN",
    "PEARL",
}

# ── ph_ucc_norm faithful port (KEEP IN SYNC with public.ph_ucc_norm) ──────────
_SUFFIX = re.compile(r'\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT|FUNDING|FUND|CAPITAL|FINANCIAL|FINANCE|GROUP|SERVICING)\b')
_NONALNUM = re.compile(r'[^A-Z0-9]+')
def norm(s: str) -> str:
    s = _NONALNUM.sub(" ", _SUFFIX.sub(" ", (s or "").upper()))
    return s.strip()

def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y").date()
    except ValueError:
        return None

def csv_reader(zpath, member_prefix):
    zf = zipfile.ZipFile(zpath)
    name = next(n for n in zf.namelist() if n.startswith(member_prefix))
    return csv.reader(io.TextIOWrapper(zf.open(name), encoding="latin-1", newline=""),
                      delimiter="|", quotechar='"')

def mgmt_sql(ref, token, query):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def fetch_aliases(ref, token):
    rows = mgmt_sql(ref, token,
        "select distinct alias_norm from public.ph_ucc_funder_aliases "
        "where active and length(alias_norm) >= 3")
    return [r["alias_norm"] for r in rows]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--downloads", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--project-ref", default="ehibjeonqpqskhcvizow")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--batch", type=int, default=700)
    args = ap.parse_args()
    dl, ref = args.downloads, args.project_ref
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token and not args.dry_run:
        sys.exit("SUPABASE_ACCESS_TOKEN not set (needed for the load; use --dry-run to skip)")
    today = date.today()

    aliases = fetch_aliases(ref, token) if token else json.load(open(os.path.join(
        os.path.dirname(__file__), "..", "scratch_aliases.json")))
    aliases = [a for a in aliases if a not in BLOCKLIST]
    padded = [" " + a + " " for a in aliases]
    print(f"[aliases] {len(aliases)} active after FL blocklist ({len(BLOCKLIST)} blocked)")

    # Pass 1: fresh 'Filed' filings within window
    fresh = {}
    r = csv_reader(f"{dl}/filings_full.zip", "filings_full"); h = next(r)
    ci = {c: i for i, c in enumerate(h)}
    for row in r:
        if len(row) <= ci["FilingExpDate"] or row[ci["FilingStatus"]] != "Filed":
            continue
        fd = parse_date(row[ci["FilingDate"]])
        if fd is None or not (0 <= (today - fd).days <= WINDOW_DAYS):
            continue
        exp = parse_date(row[ci["FilingExpDate"]])
        fresh[row[ci["Ucc1FilingNumber"]]] = (fd.isoformat(), exp.isoformat() if exp else None)
    print(f"[pass1] fresh Filed <= {WINDOW_DAYS}d: {len(fresh)}")

    # Pass 2: alias match against fresh set
    matches = {}
    r = csv_reader(f"{dl}/secureds_full.zip", "secureds_full"); h = next(r)
    ci = {c: i for i, c in enumerate(h)}
    for row in r:
        if len(row) <= ci["SecName"]:
            continue
        fn = row[ci["Ucc1FilingNumber"]]
        if fn not in fresh:
            continue
        spn = norm(row[ci["SecName"]])
        if not spn:
            continue
        p = " " + spn + " "
        if any(pa in p for pa in padded):
            raw = row[ci["SecName"]]
            matches.setdefault(fn, [])
            if raw not in matches[fn]:
                matches[fn].append(raw)
    print(f"[pass2] matched filings: {len(matches)}")

    # Pass 3: best debtor per matched filing
    best = {}
    r = csv_reader(f"{dl}/debtors_full.zip", "debtors_full"); h = next(r)
    ci = {c: i for i, c in enumerate(h)}
    for row in r:
        if len(row) <= ci["DebFilingStatus"]:
            continue
        fn = row[ci["Ucc1FilingNumber"]]
        if fn not in matches:
            continue
        name = (row[ci["DebName"]] or "").strip()
        if len(name) < 2:
            continue
        rank = (0 if row[ci["DebNameFormat"]] == "C" else 1,
                0 if row[ci["DebOrigParty"]] == "O" else 1, -len(name))
        if fn not in best or rank < best[fn]["rank"]:
            a1, a2 = (row[ci["DebAddressLine1"]] or "").strip(), (row[ci["DebAddressLine2"]] or "").strip()
            best[fn] = {"rank": rank, "name": name,
                        "addr": (a1 + (" " + a2 if a2 else "")).strip() or None,
                        "city": (row[ci["DebCity"]] or "").strip() or None,
                        "state": (row[ci["DebState"]] or "").strip() or None,
                        "zip": (row[ci["DebZipCode"]] or "").strip() or None,
                        "fmt": row[ci["DebNameFormat"]]}

    recs = []
    for fn, secs in matches.items():
        d = best.get(fn)
        if d is None:
            continue
        fd, exp = fresh[fn]
        for raw in secs:
            recs.append({"state": "FL", "filing_no": fn, "filed_date": fd, "lapse_date": exp,
                         "status": "Filed", "debtor_name": d["name"], "debtor_address": d["addr"],
                         "debtor_city": d["city"], "debtor_state": d["state"], "debtor_zip": d["zip"],
                         "secured_party_raw": raw,
                         "raw": {"source": "floridaucc.com full-download",
                                 "sec_matched": True, "deb_name_format": d["fmt"]}})
    print(f"[emit] filing rows: {len(recs)}")
    if args.dry_run:
        print("[dry-run] not writing to DB"); return

    # Upsert FL source, capture id
    src = mgmt_sql(ref, token,
        "insert into public.ph_ucc_sources (state,name,kind,endpoint,cadence,status,notes) "
        "values ('FL','Florida SOS — floridaucc.com full download','file',"
        "'https://www.floridaucc.com/download','daily','active',"
        "'FREE full downloads (pipe-delimited CSV) regenerated each business day; smaller daily regular delta also offered. Loaded via ph_ucc_fl_loader.py: Filed within 540d, token-boundary alias match with FL generic-word blocklist.') "
        "on conflict (state,name) do update set status='active', cadence='daily', "
        "endpoint=excluded.endpoint, notes=excluded.notes returning id")[0]["id"]

    cols = ("state text, filing_no text, filed_date text, lapse_date text, status text, "
            "debtor_name text, debtor_address text, debtor_city text, debtor_state text, "
            "debtor_zip text, secured_party_raw text, raw jsonb")
    for i in range(0, len(recs), args.batch):
        lit = json.dumps(recs[i:i + args.batch]).replace("'", "''")
        mgmt_sql(ref, token,
            "insert into public.ph_ucc_filings (state,filing_no,filed_date,lapse_date,status,"
            "debtor_name,debtor_address,debtor_city,debtor_state,debtor_zip,secured_party_raw,raw,source_id) "
            "select x.state,x.filing_no,x.filed_date::date,x.lapse_date::date,x.status,x.debtor_name,"
            "x.debtor_address,x.debtor_city,x.debtor_state,x.debtor_zip,x.secured_party_raw,x.raw,"
            f"'{src}'::uuid from jsonb_to_recordset('{lit}'::jsonb) as x({cols}) "
            "on conflict (dedupe_hash) do nothing")
    print(f"[load] inserted up to {len(recs)} FL filing rows (dedupe on conflict)")

    mgmt_sql(ref, token,
        f"update public.ph_ucc_sources set last_rows={len(recs)}, last_pull_at=now(), "
        "last_cursor='fullfile' where state='FL' and name='Florida SOS — floridaucc.com full download'")
    res = mgmt_sql(ref, token, "select * from public.ph_ucc_rebuild_leads()")[0]
    print(f"[rebuild] {res}")

if __name__ == "__main__":
    main()
