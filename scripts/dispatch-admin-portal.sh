#!/usr/bin/env sh
set -eu

# Trigger deploy-admin-portal in merge_all.yml using repository_dispatch.
# Usage: ./scripts/dispatch-admin-portal.sh [preview|production]

PORTAL_ENVIRONMENT="${1:-preview}"
case "$PORTAL_ENVIRONMENT" in
  preview|production) ;;
  *)
    echo "Invalid environment: '$PORTAL_ENVIRONMENT' (expected preview or production)" >&2
    exit 1
    ;;
esac

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "Missing GH_TOKEN or GITHUB_TOKEN in environment." >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-DonSquires/FreedomCamp-Manager}"
API_URL="${GITHUB_API_URL:-https://api.github.com}"
ENDPOINT="$API_URL/repos/$REPO/dispatches"
BODY=$(printf '{"event_type":"merge-all-dispatch","client_payload":{"job":"deploy-admin-portal","portal_environment":"%s"}}' "$PORTAL_ENVIRONMENT")

HTTP_CODE=$(curl -sS -o /tmp/dispatch-admin-portal-response.json -w "%{http_code}" \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $TOKEN" \
  "$ENDPOINT" \
  -d "$BODY")

if [ "$HTTP_CODE" != "204" ]; then
  echo "Dispatch failed (HTTP $HTTP_CODE)." >&2
  cat /tmp/dispatch-admin-portal-response.json >&2
  exit 1
fi

echo "Dispatch accepted for '$PORTAL_ENVIRONMENT'."
echo "Check runs: https://github.com/$REPO/actions/workflows/merge_all.yml"
