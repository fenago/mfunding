#!/usr/bin/env bash
#
# PH UCC — Florida AUTO-FETCH (the "self-updates like CO/OR" path for FL).
#
# floridaucc.com regenerates a FREE full UCC download every business day. The
# /download SPA is gated behind a Terms click, BUT the file URL resolves from a
# public, no-auth JSON endpoint (found by fl-ucc-loader):
#
#   GET https://publicsearchapi.floridaucc.com/Downloads?downloadType=FULL&fileType=<Filings|Debtors|Secureds>
#     -> {"payload":"<time-limited CloudFront pre-signed .zip URL>"}
#
# WHY THIS SHAPE (honest architecture): the uncompressed files are 600MB+
# (debtors 691MB / secureds 626MB), and:
#   • an edge function can't unzip/hold them (and you can't byte-resume through zip
#     decompression), and
#   • Supabase's single-POST storage upload REJECTS large bodies (a 321MB POST
#     returns HTTP 400), so the "upload to bucket then stream-ingest" path is not
#     usable for a server-side cron at this size.
# So auto-fetch runs on a GitHub runner and reuses the ALREADY-VALIDATED
# scripts/ph_ucc_fl_loader.py: it filters locally (ph_ucc_norm + the FL generic-word
# BLOCKLIST + FilingStatus='Filed' freshness within 540d + best-debtor pick) and
# pushes ONLY the ~7k matched rows to ph_ucc_filings via the management API, then
# runs ph_ucc_rebuild_leads(). No giant upload; identical precision to a UI upload;
# idempotent via dedupe_hash so a daily re-run never doubles or lets banks in.
# We use the FULL snapshot, NOT the REGULAR delta: REGULAR needs a &fileDate that
# must match FL's generation calendar (recent dates 400 with "not available yet"),
# which would make an unattended cron flaky; FULL is always available + self-correcting.
#
# Requires (env / GH secrets):
#   SUPABASE_ACCESS_TOKEN  (management-API token — the loader pushes with it)
# Usage: ./scripts/ph_ucc_fl_fetch.sh   (reads .env locally; CI passes env)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^SUPABASE_ACCESS_TOKEN=' "$ENV_FILE" | xargs) || true
fi
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "::error::SUPABASE_ACCESS_TOKEN not set (needed to push filtered rows)"; exit 1; }

API="https://publicsearchapi.floridaucc.com/Downloads"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Download the three FULL zips with the exact names ph_ucc_fl_loader.py expects
# (it reads <dir>/<name>_full.zip and finds the member starting with "<name>_full").
# Plain case-mapping (no associative arrays — macOS ships bash 3.2, which lacks them).
for FT in Filings Debtors Secureds; do
  case "$FT" in
    Filings)  nm=filings_full ;;
    Debtors)  nm=debtors_full ;;
    Secureds) nm=secureds_full ;;
  esac
  echo "[resolve] $FT"
  purl=$(curl -sS --max-time 60 "$API?downloadType=FULL&fileType=$FT" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); assert not d.get("notOk"), d; print(d["payload"])')
  [ -n "$purl" ] || { echo "::error::no payload URL for $FT"; exit 1; }
  out="$WORK/${nm}.zip"
  echo "[download] $FT -> $(basename "$out")"
  curl -sS --fail --max-time 1200 -o "$out" "$purl"
  echo "[download] $(du -h "$out" | cut -f1)"
done

echo "[loader] running ph_ucc_fl_loader.py on the fetched files"
python3 "$HERE/ph_ucc_fl_loader.py" --downloads "$WORK"

# Promote the FL source card to auto-fetch (the loader already stamped last_rows /
# last_pull_at). Uses the management API so no service-role key is needed here.
curl -sS -o /dev/null -X POST "https://api.supabase.com/v1/projects/ehibjeonqpqskhcvizow/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"update public.ph_ucc_sources set fetch_mode='\''file_autofetch'\'', cadence='\''daily'\'' where state='\''FL'\'' and kind='\''file'\''"}'
echo "[done] FL auto-fetch complete; source promoted to file_autofetch (daily)"
