#!/usr/bin/env sh
set -eu

# Verify Supabase edge wiring for inference + ALPR pipeline.
# Usage:
#   SUPABASE_URL="https://<project-ref>.supabase.co" ./scripts/verify-supabase-pipeline.sh
# Optional auth (if endpoints require it):
#   SUPABASE_KEY="<anon-or-service-or-pat>" ./scripts/verify-supabase-pipeline.sh
# Optional tuning:
#   TIMEOUT=30 ./scripts/verify-supabase-pipeline.sh

if [ "${SUPABASE_URL:-}" = "" ]; then
  echo "ERROR: SUPABASE_URL is required"
  echo "Example: SUPABASE_URL=https://xbfnlzmpumthnjmtqufp.supabase.co ./scripts/verify-supabase-pipeline.sh"
  exit 1
fi

TIMEOUT="${TIMEOUT:-30}"
SUPABASE_KEY="${SUPABASE_KEY:-}"

call_edge() {
  endpoint="$1"
  body="$2"

  if [ -n "$SUPABASE_KEY" ]; then
    curl -sS -m "$TIMEOUT" -X POST "$SUPABASE_URL/functions/v1/$endpoint" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "apikey: $SUPABASE_KEY" \
      -d "$body" \
      -w "\nHTTP_STATUS=%{http_code}\n"
  else
    curl -sS -m "$TIMEOUT" -X POST "$SUPABASE_URL/functions/v1/$endpoint" \
      -H "Content-Type: application/json" \
      -d "$body" \
      -w "\nHTTP_STATUS=%{http_code}\n"
  fi
}

echo "== Supabase Edge Pipeline Verification =="
echo "SUPABASE_URL: $SUPABASE_URL"
echo "TIMEOUT: ${TIMEOUT}s"
if [ -n "$SUPABASE_KEY" ]; then
  echo "SUPABASE_KEY: provided"
else
  echo "SUPABASE_KEY: not provided"
fi
echo

echo "[1/2] check-railway-health"
health_resp="$(call_edge "check-railway-health" '{}')"
echo "$health_resp"

if command -v jq >/dev/null 2>&1; then
  health_json="$(echo "$health_resp" | sed '/^HTTP_STATUS=/d')"
  proxy_status="$(echo "$health_json" | jq -r '.proxy.status // "unknown"' 2>/dev/null || echo unknown)"
  infer_status="$(echo "$health_json" | jq -r '.inference.status // "unknown"' 2>/dev/null || echo unknown)"
  echo "summary: proxy=$proxy_status inference=$infer_status"
fi

echo

echo "[2/2] alpr-process smoke test (non-mutating)"
alpr_body='{"observation_id":"00000000-0000-0000-0000-000000000000","photo_url":"https://images.unsplash.com/photo-1493238792000-8113da705763?w=1200"}'
alpr_resp="$(call_edge "alpr-process" "$alpr_body")"
echo "$alpr_resp"

if command -v jq >/dev/null 2>&1; then
  alpr_json="$(echo "$alpr_resp" | sed '/^HTTP_STATUS=/d')"
  alpr_success="$(echo "$alpr_json" | jq -r '.success // false' 2>/dev/null || echo false)"
  alpr_error="$(echo "$alpr_json" | jq -r '.error // "none"' 2>/dev/null || echo none)"
  echo "summary: success=$alpr_success error=$alpr_error"
fi

echo
echo "Done."
