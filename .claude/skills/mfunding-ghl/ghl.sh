#!/usr/bin/env bash
# MFunding GHL API helper. Authenticated request against the MFunding
# GoHighLevel sub-account. Credentials are read from the PROJECT .env
# (GHL_API_KEY + GHL_LOCATION_ID) — never from the global ~/.claude/skills/ghl
# skill (which points at a DIFFERENT account, OSP).
#
# Usage:
#   ghl.sh GET  "/contacts/?locationId=$LOC&limit=20"
#   ghl.sh POST "/contacts/" '{"locationId":"...","firstName":"Jane"}'
#   ghl.sh PUT  "/contacts/<id>" '{"firstName":"Janet"}'
#   ghl.sh DELETE "/contacts/<id>"
#
# $LOC is exported for convenience so you can interpolate it in paths/bodies.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Load MFunding GHL creds from the project .env (gitignored). Single source of
# truth — same values stored in the Supabase vault. Read line-by-line (robust
# against comments/quotes; avoids fragile process substitution).
if [ -f "$PROJECT_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      GHL_API_KEY=*|GHL_LOCATION_ID=*|GHL_API_BASE=*|GHL_API_VERSION=*)
        export "${line%%=*}=${line#*=}" ;;
    esac
  done < "$PROJECT_ROOT/.env"
fi

GHL_PIT="${GHL_API_KEY:?GHL_API_KEY missing from $PROJECT_ROOT/.env}"
GHL_LOCATION_ID="${GHL_LOCATION_ID:?GHL_LOCATION_ID missing from $PROJECT_ROOT/.env}"
GHL_API_BASE="${GHL_API_BASE:-https://services.leadconnectorhq.com}"
GHL_API_VERSION="${GHL_API_VERSION:-2021-07-28}"
LOC="$GHL_LOCATION_ID"; export LOC

METHOD="${1:?method required (GET/POST/PUT/DELETE)}"
PATH_AND_QUERY="${2:?path required, e.g. /contacts/?locationId=...}"
BODY="${3:-}"

URL="${GHL_API_BASE%/}${PATH_AND_QUERY}"

ARGS=(-sS -w '\nHTTP_STATUS:%{http_code}\n' -X "$METHOD" "$URL"
  -H "Authorization: Bearer ${GHL_PIT}"
  -H "Version: ${GHL_API_VERSION}"
  -H "Accept: application/json")

if [[ -n "$BODY" ]]; then
  ARGS+=(-H "Content-Type: application/json" --data "$BODY")
fi

curl "${ARGS[@]}"
