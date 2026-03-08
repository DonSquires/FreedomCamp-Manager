#!/usr/bin/env sh
set -eu

# Backfill compliance for existing rows in public.observations
# by invoking the recalculate-compliance-v3 edge function.
#
# Required env vars:
#   SUPABASE_URL          e.g. https://<ref>.supabase.co
#   SUPABASE_ANON_KEY     anon/public key for the same project
#   USER_JWT              JWT for an admin/master/admin_officer user
#
# Optional env vars (scope):
#   ORGANIZATION_ID
#   ZONE_ID
#   DATE_FROM             YYYY-MM-DD
#   DATE_TO               YYYY-MM-DD
#
# Usage examples:
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... USER_JWT=... ./scripts/backfill-observations-compliance.sh
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... USER_JWT=... ORGANIZATION_ID=<org-id> ./scripts/backfill-observations-compliance.sh

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
USER_JWT="${USER_JWT:-}"

ORGANIZATION_ID="${ORGANIZATION_ID:-}"
ZONE_ID="${ZONE_ID:-}"
DATE_FROM="${DATE_FROM:-}"
DATE_TO="${DATE_TO:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$USER_JWT" ]; then
  echo "Missing required env vars."
  echo "Required: SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT"
  exit 1
fi

# Build JSON payload safely with jq if available, fallback to shell string.
if command -v jq >/dev/null 2>&1; then
  payload="$(jq -n \
    --arg organization_id "$ORGANIZATION_ID" \
    --arg zone_id "$ZONE_ID" \
    --arg date_from "$DATE_FROM" \
    --arg date_to "$DATE_TO" \
    '{
      organization_id: (if $organization_id == "" then null else $organization_id end),
      zone_id: (if $zone_id == "" then null else $zone_id end),
      date_from: (if $date_from == "" then null else $date_from end),
      date_to: (if $date_to == "" then null else $date_to end)
    } | with_entries(select(.value != null))')"
else
  payload='{}'
  if [ -n "$ORGANIZATION_ID$ZONE_ID$DATE_FROM$DATE_TO" ]; then
    echo "jq is required for scoped payloads. Install jq or run full-scope backfill."
    exit 1
  fi
fi

echo "Starting compliance backfill..."
echo "Endpoint: $SUPABASE_URL/functions/v1/recalculate-compliance-v3"
echo "Payload: $payload"

tmp_resp="$(mktemp)"
trap 'rm -f "$tmp_resp"' EXIT

status="$(curl -sS -o "$tmp_resp" -w "%{http_code}" \
  -X POST "$SUPABASE_URL/functions/v1/recalculate-compliance-v3" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload")"

echo "HTTP_STATUS=$status"
cat "$tmp_resp"
echo

if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
  echo "Backfill failed."
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  processed="$(jq -r '.processed // .observations_processed // "n/a"' "$tmp_resp" 2>/dev/null || echo n/a)"
  changed="$(jq -r '.compliance_changed // "n/a"' "$tmp_resp" 2>/dev/null || echo n/a)"
  created="$(jq -r '.breaches_created // "n/a"' "$tmp_resp" 2>/dev/null || echo n/a)"
  skipped="$(jq -r '.skipped_no_rules // "n/a"' "$tmp_resp" 2>/dev/null || echo n/a)"
  status_txt="$(jq -r '.status // "unknown"' "$tmp_resp" 2>/dev/null || echo unknown)"

  echo "Summary: status=$status_txt processed=$processed compliance_changed=$changed breaches_created=$created skipped_no_rules=$skipped"
fi

echo "Compliance backfill complete."
