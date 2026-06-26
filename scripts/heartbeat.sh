#!/usr/bin/env bash
#
# Manual heartbeat for the FREE-tier "CAI3303Demo" Supabase project.
# Pings the REST API to keep the database from auto-pausing (or to nudge it).
# The scheduled version of this runs twice a day via
# .github/workflows/supabase-heartbeat.yml.
#
# Usage:
#   ./scripts/heartbeat.sh
#
# Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env (or the
# environment). Falls back to the known public project URL.

set -euo pipefail

# Load .env if present (only the two vars we need).
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^VITE_SUPABASE_(URL|ANON_KEY)=' "$ENV_FILE" | xargs) || true
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-https://ehibjeonqpqskhcvizow.supabase.co}"
SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Error: VITE_SUPABASE_ANON_KEY is not set (check .env)." >&2
  exit 1
fi

echo "Pinging ${SUPABASE_URL} ..."
# Query a real table so the request reaches Postgres (the /rest/v1/ root is
# gateway-gated and 401s without touching the DB).
status=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  "${SUPABASE_URL}/rest/v1/lenders?select=id&limit=1")

echo "HTTP status: ${status}"
case "$status" in
  2*|3*) echo "Supabase is awake." ;;
  *)     echo "Unexpected status — project may be paused or still coming up." >&2; exit 1 ;;
esac
