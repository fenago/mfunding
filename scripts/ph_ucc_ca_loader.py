#!/usr/bin/env python3
"""PH UCC — California SOS bizfile master-unload loader.

CA is the largest UCC state; the SOS master data unload is a paid one-time file
(weekly deltas free) delivered as 4 pipe-delimited, double-quoted CSVs (~3GB
unzipped) joined on UCC1_NUM:

  Filings.csv          : UCC1_NUM | UCC3_NUM | FILING_DATE | PROCESSED_DATE |
                         ACTION_TYPE | ALT_DESIGNATION_TYPE_ID | FILING_TYPE_ID |
                         LAPSE_DATE | PAGE_COUNT
                         (holds BOTH the UCC1 original — ACTION_TYPE='Lien
                         Financing Stmt', UCC3_NUM=UCC1_NUM — and every UCC3
                         amendment/continuation/termination.)
  Debtors.csv          : UCC1_NUM | ... | ORG_NAME(merchant) | ADDR1 | CITY |
                         STATE | POSTAL_CODE | ...
  SecuredParties.csv   : UCC1_NUM | ... | ORG_NAME(funder) | ...
  FilingAmendments.csv : UCC1_NUM | UCC3_NUM | ACTION_TYPE  (termination detection)

Because the files are GB-scale, the heavy filtering/joins run LOCALLY in DuckDB;
only the matched, fresh, non-terminated positions are pushed to Supabase. The
pipeline mirrors the CO/FL loaders + ph_ucc_rebuild_leads exactly:

  1. Pull the active funder aliases (raw name + canonical + source) from
     ph_ucc_funder_aliases via the management API.
  2. MATCH with descriptor-preserving normalization: strip only corporate-FORM
     suffixes (LLC/INC/CORP/CO/…) but KEEP the descriptor words (FUNDING /
     CAPITAL / FINANCIAL / GROUP / …), then token-boundary phrase match. This is
     the CA precision fix: ph_ucc_norm over-strips "National Funding" to
     "NATIONAL", which then matches every "…NATIONAL ASSOCIATION" bank; keeping
     "FUNDING" makes "NATIONAL FUNDING" specific. (Same problem the FL loader
     solves with a blocklist — see ph_ucc_fl_loader.py.) Aliases whose
     descriptor-preserving form has < 5 alnum chars are dropped as too generic.
     The DB's ph_ucc_rebuild_leads re-confirms every row we insert, so junk kept
     out here can never become a lead.
  3. FRESHNESS: keep only originals (ACTION_TYPE='Lien Financing Stmt') filed
     within WINDOW_DAYS (540, same as CO); drop UCC1s with a Termination not
     reversed by an Erroneous Termination, and drop anything whose effective
     lapse date is in the past. A closed/lapsed lien is a paid-off position, not
     an MCA to poach (the CO all-time-history stale-junk lesson).
  4. INSERT into ph_ucc_filings (state='CA') via jsonb_to_recordset, on conflict
     (dedupe_hash) do nothing; then run ph_ucc_rebuild_leads() and stamp
     ph_ucc_sources. No skip-trace, no GHL load — gates stay off.

USAGE:
  SUPABASE_ACCESS_TOKEN=<mgmt token, in repo .env>  # required unless --dry-run
  python3 scripts/ph_ucc_ca_loader.py --data-dir /path/to/unzipped/csvs
  # or point at the raw zip; it will be unzipped into a temp dir:
  python3 scripts/ph_ucc_ca_loader.py --zip ~/Downloads/DataRequest0x....zip

Requires the DuckDB CLI (`brew install duckdb`). Never commit the raw CA data.
"""
import argparse, json, os, subprocess, sys, tempfile, urllib.request, zipfile
from datetime import date

PROJECT_REF = "ehibjeonqpqskhcvizow"
WINDOW_DAYS = 540
ALIAS_MIN_ALNUM = 5   # descriptor-preserving alias must have >= this many alnum chars


def mgmt_sql(ref, token, query):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def load_dotenv_token():
    tok = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if tok:
        return tok
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env):
        for line in open(env):
            if line.startswith("SUPABASE_ACCESS_TOKEN="):
                return line.split("=", 1)[1].strip()
    return ""


def fetch_aliases(ref, token):
    return mgmt_sql(ref, token,
        "select alias, canonical_name, source from public.ph_ucc_funder_aliases "
        "where active and length(alias_norm) >= 3")


# ── DuckDB filter: descriptor-preserving token-boundary match + freshness ──────
DUCK_SQL = r"""
PRAGMA memory_limit='6GB';
PRAGMA temp_directory='{tmp}/duck_tmp';
PRAGMA threads={threads};

-- Strip corporate-FORM suffixes only; KEEP descriptor words. RE2 \b == PG \y.
CREATE MACRO norm2(s) AS trim(regexp_replace(
  regexp_replace(upper(coalesce(s,'')),
    '\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE)\b', ' ', 'g'),
  '[^A-Z0-9]+', ' ', 'g'));

CREATE TABLE aliases AS
  SELECT alias, canonical_name, source, norm2(alias) AS an
  FROM read_csv('{tmp}/aliases.psv', delim='|', quote='"', header=true, all_varchar=true)
  WHERE length(regexp_replace(norm2(alias), '[^A-Z0-9]', '', 'g')) >= {alias_min};

CREATE VIEW filings    AS SELECT * FROM read_csv('{data}/Filings.csv',          delim='|', quote='"', header=true, all_varchar=true, ignore_errors=true);
CREATE VIEW debtors    AS SELECT * FROM read_csv('{data}/Debtors.csv',          delim='|', quote='"', header=true, all_varchar=true, ignore_errors=true);
CREATE VIEW secured    AS SELECT * FROM read_csv('{data}/SecuredParties.csv',   delim='|', quote='"', header=true, all_varchar=true, ignore_errors=true);
CREATE VIEW amendments AS SELECT * FROM read_csv('{data}/FilingAmendments.csv', delim='|', quote='"', header=true, all_varchar=true, ignore_errors=true);

CREATE TABLE orig AS
  SELECT UCC1_NUM, min(try_cast(substr(FILING_DATE,1,10) AS DATE)) AS filed_date
  FROM filings WHERE ACTION_TYPE = 'Lien Financing Stmt' GROUP BY UCC1_NUM;
CREATE TABLE lapse AS
  SELECT UCC1_NUM, max(try_cast(substr(LAPSE_DATE,1,10) AS DATE)) AS lapse_date
  FROM filings GROUP BY UCC1_NUM;
CREATE TABLE term AS
  SELECT UCC1_NUM FROM amendments WHERE ACTION_TYPE = 'Termination'
  EXCEPT SELECT UCC1_NUM FROM amendments WHERE ACTION_TYPE = 'Erroneous Termination';
CREATE TABLE debtor_pick AS
  SELECT UCC1_NUM,
    arg_min({{name:ORG_NAME, last:LAST_NAME, first:FIRST_NAME, addr:ADDR1, city:CITY, st:STATE, zip:POSTAL_CODE}},
            CASE WHEN nullif(trim(ORG_NAME),'') IS NOT NULL THEN 0 ELSE 1 END) AS deb
  FROM debtors GROUP BY UCC1_NUM;

CREATE TABLE sp_matched AS
  SELECT n.ORG_NAME, a.canonical_name, a.source
  FROM (SELECT DISTINCT ORG_NAME, norm2(ORG_NAME) AS spn FROM secured
        WHERE nullif(trim(ORG_NAME),'') IS NOT NULL) n
  JOIN aliases a ON (' ' || n.spn || ' ') LIKE ('%' || ' ' || a.an || ' ' || '%');
CREATE TABLE sp AS
  SELECT DISTINCT s.UCC1_NUM, s.ORG_NAME AS secured_party_raw, m.canonical_name, m.source
  FROM secured s JOIN sp_matched m ON m.ORG_NAME = s.ORG_NAME;

COPY (
  SELECT DISTINCT
    'CA' AS state, sp.UCC1_NUM AS filing_no,
    o.filed_date::VARCHAR AS filed_date, l.lapse_date::VARCHAR AS lapse_date, 'Active' AS status,
    coalesce(nullif(trim(d.deb.name),''),
             nullif(trim(concat_ws(', ', nullif(trim(d.deb.last),''), nullif(trim(d.deb.first),''))),'')) AS debtor_name,
    nullif(trim(d.deb.addr),'') AS debtor_address, nullif(trim(d.deb.city),'') AS debtor_city,
    nullif(trim(d.deb.st),'') AS debtor_state, nullif(trim(d.deb.zip),'') AS debtor_zip,
    sp.secured_party_raw
  FROM sp
  JOIN orig o ON o.UCC1_NUM = sp.UCC1_NUM
  LEFT JOIN lapse l ON l.UCC1_NUM = sp.UCC1_NUM
  LEFT JOIN debtor_pick d ON d.UCC1_NUM = sp.UCC1_NUM
  WHERE o.filed_date >= (today() - INTERVAL {window} DAY)
    AND sp.UCC1_NUM NOT IN (SELECT UCC1_NUM FROM term)
    AND (l.lapse_date IS NULL OR l.lapse_date >= today())
    AND length(trim(coalesce(nullif(trim(d.deb.name),''),
        nullif(trim(concat_ws(', ', nullif(trim(d.deb.last),''), nullif(trim(d.deb.first),''))),''))) ) > 1
) TO '{tmp}/ca_load.json' (FORMAT JSON, ARRAY true);
"""


def run_duckdb(data_dir, tmp, aliases):
    os.makedirs(os.path.join(tmp, "duck_tmp"), exist_ok=True)
    with open(os.path.join(tmp, "aliases.psv"), "w") as f:
        f.write("alias|canonical_name|source\n")
        for a in aliases:
            f.write(f"{a['alias']}|{a['canonical_name']}|{a['source']}\n")
    sql = DUCK_SQL.format(tmp=tmp, data=data_dir, threads=6,
                          alias_min=ALIAS_MIN_ALNUM, window=WINDOW_DAYS)
    sqlpath = os.path.join(tmp, "filter.sql")
    open(sqlpath, "w").write(sql)
    subprocess.run(["duckdb", ":memory:"], stdin=open(sqlpath), check=True)
    return json.load(open(os.path.join(tmp, "ca_load.json")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", help="dir with the 4 unzipped CSVs")
    ap.add_argument("--zip", help="the raw DataRequest zip (unzipped to a temp dir)")
    ap.add_argument("--project-ref", default=PROJECT_REF)
    ap.add_argument("--batch", type=int, default=1000)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = load_dotenv_token()
    if not token and not args.dry_run:
        sys.exit("SUPABASE_ACCESS_TOKEN not set (in repo .env). Use --dry-run to filter only.")
    ref = args.project_ref
    tmp = tempfile.mkdtemp(prefix="ca_ucc_")

    data_dir = args.data_dir
    if args.zip:
        data_dir = os.path.join(tmp, "csv")
        os.makedirs(data_dir, exist_ok=True)
        print(f"[unzip] {args.zip} -> {data_dir}")
        with zipfile.ZipFile(args.zip) as z:
            z.extractall(data_dir)
    if not data_dir:
        sys.exit("provide --data-dir or --zip")

    aliases = fetch_aliases(ref, token) if token else json.load(
        open(os.path.join(os.path.dirname(__file__), "..", "scratch_aliases.json")))
    print(f"[aliases] {len(aliases)} active")

    recs = run_duckdb(data_dir, tmp, aliases)
    print(f"[emit] filing rows: {len(recs)} "
          f"({len({r['filing_no'] for r in recs})} UCC1, "
          f"{len({r['debtor_name'] for r in recs})} debtors)")
    if args.dry_run:
        print(f"[dry-run] not writing. JSON at {tmp}/ca_load.json"); return

    src = mgmt_sql(ref, token,
        "select id from public.ph_ucc_sources where state='CA' limit 1")[0]["id"]
    cols = ("state text, filing_no text, filed_date text, lapse_date text, status text, "
            "debtor_name text, debtor_address text, debtor_city text, debtor_state text, "
            "debtor_zip text, secured_party_raw text")
    for i in range(0, len(recs), args.batch):
        lit = json.dumps(recs[i:i + args.batch]).replace("'", "''")
        mgmt_sql(ref, token,
            "insert into public.ph_ucc_filings (state,filing_no,filed_date,lapse_date,status,"
            "debtor_name,debtor_address,debtor_city,debtor_state,debtor_zip,secured_party_raw,source_id) "
            "select x.state,x.filing_no,x.filed_date::date,x.lapse_date::date,x.status,x.debtor_name,"
            "x.debtor_address,x.debtor_city,x.debtor_state,x.debtor_zip,x.secured_party_raw,"
            f"'{src}'::uuid from jsonb_to_recordset('{lit}'::jsonb) as x({cols}) "
            "on conflict (dedupe_hash) do nothing")
        print(f"[load] batch {i//args.batch} ok")

    mgmt_sql(ref, token,
        "update public.ph_ucc_sources set status='active', last_pull_at=now(), "
        "last_rows=(select count(*) from public.ph_ucc_filings where state='CA'), "
        "newest_filing_date=(select max(filed_date) from public.ph_ucc_filings where state='CA'), "
        "last_cursor='masterfile' where state='CA'")
    res = mgmt_sql(ref, token, "select * from public.ph_ucc_rebuild_leads()")[0]
    print(f"[rebuild] {res}")
    ca = mgmt_sql(ref, token,
        "select count(*) n, count(*) filter (where stack_depth>=2) stacked, "
        "count(*) filter (where freshness_days<=90) fresh90 "
        "from public.ph_ucc_leads where state='CA'")[0]
    print(f"[ca leads] total={ca['n']} stacked2+={ca['stacked']} fresh<=90d={ca['fresh90']}")


if __name__ == "__main__":
    main()
