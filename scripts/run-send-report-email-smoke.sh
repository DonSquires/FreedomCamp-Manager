#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-kxwjcupuxnnbnzcgmkoi}"
BASE_URL="https://${PROJECT_REF}.supabase.co"

keys_json=$(supabase projects api-keys --project-ref "$PROJECT_REF" --output json)
ANON_KEY=$(echo "$keys_json" | jq -r '.[] | select(.id=="anon") | .api_key')
SERVICE_KEY=$(echo "$keys_json" | jq -r '.[] | select(.id=="service_role") | .api_key')

if [[ -z "$ANON_KEY" || "$ANON_KEY" == "null" || -z "$SERVICE_KEY" || "$SERVICE_KEY" == "null" ]]; then
  echo "Failed to resolve project API keys" >&2
  exit 2
fi

stamp=$(date +%s)
TMP_EMAIL="copilot.smtp.test.${stamp}@fcmanager.co.nz"
TMP_PASS="TmpPass!${stamp}Aa"

create_resp=$(curl -sS -X POST "${BASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TMP_EMAIL}\",\"password\":\"${TMP_PASS}\",\"email_confirm\":true}")

TMP_USER_ID=$(echo "$create_resp" | jq -r '.id // empty')
if [[ -z "$TMP_USER_ID" ]]; then
  echo "Temp user creation failed:" >&2
  echo "$create_resp" >&2
  exit 3
fi

auth_resp=$(curl -sS -X POST "${BASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TMP_EMAIL}\",\"password\":\"${TMP_PASS}\"}")

USER_TOKEN=$(echo "$auth_resp" | jq -r '.access_token // empty')
if [[ -z "$USER_TOKEN" ]]; then
  echo "Temp user sign-in failed:" >&2
  echo "$auth_resp" >&2
  curl -sS -X DELETE "${BASE_URL}/auth/v1/admin/users/${TMP_USER_ID}" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" >/dev/null || true
  exit 4
fi

EMAIL_TARGET="${EMAIL_TARGET:-reports@fcmanager.co.nz}"
invoke_resp=$(curl -sS -w "\nHTTP_STATUS:%{http_code}\n" -X POST "${BASE_URL}/functions/v1/send-report-email" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"report_type\":\"compliance\",\"recipient_email\":\"${EMAIL_TARGET}\"}")

status=$(echo "$invoke_resp" | awk -F: '/HTTP_STATUS/{print $2}' | tail -n1)
body=$(echo "$invoke_resp" | sed '/HTTP_STATUS:/d')

echo "send-report-email HTTP status: ${status}"
echo "$body"

cleanup_status=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/auth/v1/admin/users/${TMP_USER_ID}" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}")

echo "temp-user cleanup status: ${cleanup_status}"
