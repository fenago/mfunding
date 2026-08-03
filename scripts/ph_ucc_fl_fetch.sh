#!/usr/bin/env bash
#
# PH UCC — Florida AUTO-FETCH (the "self-updates like CO/OR" path for FL).
#
# floridaucc.com regenerates a FREE full UCC download every business day. The
# /download SPA is gated behind a Terms-of-Use click, BUT the file URL resolves
# from a public, no-auth JSON endpoint (discovered by fl-ucc-loader):
#
#   GET https://publicsearchapi.floridaucc.com/Downloads?downloadType=FULL&fileType=<Filings|Debtors|Secureds>
#     -> {"payload":"<time-limited CloudFront pre-signed .zip URL>"}
#
# The zips are large UNCOMPRESSED (secureds ~626MB / debtors ~691MB), which is why
# this runs on a GitHub Actions runner (no memory/wall-clock limit) rather than in
# an edge function: it downloads + unzips + uploads the plain CSVs to the
# ph-ucc-uploads bucket, then triggers the SAME validated ph-ucc-file-ingest that a
# manual UI upload uses (matched-set-first streaming, funder match, freshness +
# termination filter, idempotent via dedupe_hash). We use the FULL snapshot (not
# the REGULAR daily delta): re-ingesting the full file is self-correcting and the
# dedupe_hash makes it a no-op for unchanged rows — a delta would risk missing
# terminations of already-loaded liens.
#
# Requires (as env / GH secrets):
#   SUPABASE_URL                (public; defaults to the known project URL)
#   SUPABASE_ANON_KEY           (repo secret — already used by the heartbeat)
#   SUPABASE_SERVICE_ROLE_KEY   (repo secret — needed to upload to the private
#                                bucket and to resolve the ingest webhook secret)
#
# Usage: ./scripts/ph_ucc_fl_fetch.sh   (reads .env locally; CI passes env)

set -euo pipefail

# Load .env locally (CI sets these directly).
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(VITE_)?SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)=' "$ENV_FILE" | xargs) || true
fi

URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-https://ehibjeonqpqskhcvizow.supabase.co}}"
ANON="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY:-}}"
SVC="${SUPABASE_SERVICE_ROLE_KEY:-}"
API="https://publicsearchapi.floridaucc.com/Downloads"
BUCKET="ph-ucc-uploads"

[ -n "$ANON" ] || { echo "::error::SUPABASE_ANON_KEY not set"; exit 1; }
[ -n "$SVC" ]  || { echo "::error::SUPABASE_SERVICE_ROLE_KEY not set (needed to upload + trigger ingest)"; exit 1; }

STAMP="$(date -u +%Y%m%d)"
JOBDIR="FL/auto-$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

paths=()
for FT in Filings Debtors Secureds; do
  echo "[resolve] $FT"
  purl=$(curl -sS --max-time 60 "$API?downloadType=FULL&fileType=$FT" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); assert not d.get("notOk"), d; print(d["payload"])')
  [ -n "$purl" ] || { echo "::error::no payload URL for $FT"; exit 1; }
  echo "[download] $FT zip"
  curl -sS --fail --max-time 900 -o "$WORK/$FT.zip" "$purl"
  echo "[unzip] $FT ($(du -h "$WORK/$FT.zip" | cut -f1))"
  unzip -o -q "$WORK/$FT.zip" -d "$WORK/x_$FT"
  csv=$(find "$WORK/x_$FT" -iname '*.csv' | head -1)
  [ -n "$csv" ] || { echo "::error::no CSV inside $FT.zip"; exit 1; }
  base=$(basename "$csv")           # e.g. secureds_full20260729.csv — carries the role hint
  echo "[upload] $base ($(du -h "$csv" | cut -f1)) -> $JOBDIR/$base"
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 1800 -X POST \
    "$URL/storage/v1/object/$BUCKET/$JOBDIR/$base" \
    -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: text/csv" \
    --data-binary "@$csv")
  [ "$code" = "200" ] || { echo "::error::upload $base failed ($code)"; exit 1; }
  paths+=("$JOBDIR/$base")
done

# Resolve the ingest webhook secret (service-role RPC) — never printed.
SECRET=$(curl -sS -X POST "$URL/rest/v1/rpc/get_ghl_config" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" -d '{}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("webhook_secret",""))')
[ -n "$SECRET" ] || { echo "::error::could not resolve ingest webhook secret"; exit 1; }

echo "[ingest] triggering ph-ucc-file-ingest for FL (${#paths[@]} files)"
body=$(python3 -c 'import sys,json; print(json.dumps({"action":"start","state":"FL","storage_paths":sys.argv[1:]}))' "${paths[@]}")
resp=$(curl -sS --max-time 60 -X POST "$URL/functions/v1/ph-ucc-file-ingest?secret=$SECRET" \
  -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "$body")
echo "[ingest] $resp"
job=$(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("job_id",""))' 2>/dev/null || true)
[ -n "$job" ] || { echo "::error::ingest did not start: $resp"; exit 1; }

# Poll the job to completion (self-reinvoking chain does the work).
echo "[poll] job $job"
for _ in $(seq 1 60); do
  sleep 15
  row=$(curl -sS "$URL/rest/v1/ph_ucc_ingest_jobs?id=eq.$job&select=status,message,filings_upserted,leads_upserted,error" \
    -H "apikey: $SVC" -H "Authorization: Bearer $SVC")
  st=$(echo "$row" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["status"] if d else "")')
  echo "[poll] status=$st"
  case "$st" in
    complete) echo "$row"; echo "[done] FL auto-fetch complete"; break ;;
    error)    echo "::error::ingest failed: $row"; exit 1 ;;
  esac
done

# Promote the FL source card to file_autofetch now that a real auto-run succeeded.
curl -sS -o /dev/null -X PATCH "$URL/rest/v1/ph_ucc_sources?state=eq.FL&kind=eq.file" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
  -d '{"fetch_mode":"file_autofetch","cadence":"weekly"}'
echo "[done] FL source promoted to file_autofetch"
