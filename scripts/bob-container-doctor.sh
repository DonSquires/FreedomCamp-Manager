#!/usr/bin/env bash
set -euo pipefail

# Bob + RunPod container doctor
# - Loads credentials from local env files (optional)
# - Normalizes alias env names
# - Verifies RunPod auth + ping/chat from this container
# - Optionally verifies Railway token visibility

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOAD_RUNTIME="false"
CHECK_RAILWAY="false"
CHECK_RAILWAY_API="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --load-runtime)
      LOAD_RUNTIME="true"
      shift
      ;;
    --check-railway)
      CHECK_RAILWAY="true"
      shift
      ;;
    --check-railway-api)
      CHECK_RAILWAY_API="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/bob-container-doctor.sh [--load-runtime] [--check-railway] [--check-railway-api]" >&2
      exit 2
      ;;
  esac
done

log() { echo "[bob-doctor] $*"; }
warn() { echo "[bob-doctor][warn] $*"; }
fail() { echo "[bob-doctor][fail] $*"; }

railway_api_probe() {
  local token="$1"
  local label="$2"

  local payload
  payload='{"query":"query Viewer { me { id email name } }"}'

  local http
  http="$(curl -sS -m 20 -o /tmp/railway-api-${label}.json -w '%{http_code}' \
    -X POST 'https://backboard.railway.com/graphql/v2' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token}" \
    --data "$payload" || true)"

  if [[ "$http" != "200" ]]; then
    warn "Railway API probe failed for ${label} token (HTTP $http)"
    cat /tmp/railway-api-"${label}".json 2>/dev/null || true
    return 1
  fi

  local errors
  errors="$(jq -r '.errors | length // 0' /tmp/railway-api-${label}.json 2>/dev/null || echo 0)"
  if [[ "$errors" != "0" ]]; then
    warn "Railway API returned errors for ${label} token"
    jq -r '.errors' /tmp/railway-api-${label}.json 2>/dev/null || cat /tmp/railway-api-"${label}".json
    return 1
  fi

  local viewer_email
  viewer_email="$(jq -r '.data.me.email // "unknown"' /tmp/railway-api-${label}.json 2>/dev/null || echo unknown)"
  log "Railway API OK for ${label} token (viewer=${viewer_email})"
  return 0
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  log "Loading env file: $file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"

      # Strip optional surrounding quotes.
      if [[ "$val" =~ ^\".*\"$ ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:${#val}-2}"
      fi

      export "$key=$val"
    fi
  done < "$file"
}

if [[ "$LOAD_RUNTIME" == "true" ]]; then
  load_env_file "$ROOT_DIR/.runtime/bob-local-credentials.env"
  load_env_file "$ROOT_DIR/.runtime/railway-secrets.env"
  load_env_file "$ROOT_DIR/.env.local"
  load_env_file "$ROOT_DIR/inference-service/.env"
fi

# Normalize aliases to canonical names.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/load-railway-secrets-from-github-env.sh" --quiet

BASE_URL="${RUNPOD_SERVERLESS_URL:-${RUNPOD_URL:-https://api.runpod.ai/v2/apynoxmf9eiyzd/runsync}}"
API_KEY="${RUNPOD_API_KEY:-}"
BASE_URL="${BASE_URL%/}"

if [[ -z "$BASE_URL" || -z "$API_KEY" ]]; then
  fail "Missing RunPod credentials. Need RUNPOD_API_KEY (and optional RUNPOD_SERVERLESS_URL override)."
  exit 1
fi

if [[ "$BASE_URL" != http://* && "$BASE_URL" != https://* ]]; then
  BASE_URL="http://$BASE_URL"
fi

log "Checking RunPod runsync ping"
PING_PAYLOAD='{"input":{"action":"ping"}}'
PING_HTTP="$(curl -sS -m 30 -o /tmp/bob-ping.json -w '%{http_code}' \
  -X POST "$BASE_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -d "$PING_PAYLOAD" || true)"

if [[ "$PING_HTTP" != "200" ]]; then
  fail "RunPod ping failed at $BASE_URL (HTTP $PING_HTTP)"
  cat /tmp/bob-ping.json 2>/dev/null || true
  exit 1
fi

PING_STATUS="$(jq -r '.status // "unknown"' /tmp/bob-ping.json 2>/dev/null || echo unknown)"
PING_MESSAGE="$(jq -r '.output.message // .message // "unknown"' /tmp/bob-ping.json 2>/dev/null || echo unknown)"
log "RunPod ping OK: status=$PING_STATUS message=$PING_MESSAGE"

log "Checking RunPod chat action"
CHAT_PAYLOAD='{"input":{"action":"chat","messages":[{"role":"user","content":"Container doctor ping. Reply with one short line."}]}}'
CHAT_HTTP="$(curl -sS -m 45 -o /tmp/bob-chat.json -w '%{http_code}' \
  -X POST "$BASE_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -d "$CHAT_PAYLOAD" || true)"

if [[ "$CHAT_HTTP" != "200" ]]; then
  fail "RunPod chat action failed at $BASE_URL (HTTP $CHAT_HTTP)"
  cat /tmp/bob-chat.json 2>/dev/null || true
  exit 1
fi

CHAT_PROVIDER="$(jq -r '.output.provider // .provider // "unknown"' /tmp/bob-chat.json 2>/dev/null || echo unknown)"
CHAT_SUCCESS="$(jq -r '.output.success // .success // "unknown"' /tmp/bob-chat.json 2>/dev/null || echo unknown)"
log "Chat OK: provider=$CHAT_PROVIDER success=$CHAT_SUCCESS"

if [[ "$CHECK_RAILWAY" == "true" ]]; then
  if [[ -n "${RAILWAY_BOB_TOKEN:-}" ]]; then
    railway_api_probe "$RAILWAY_BOB_TOKEN" "bob" || true
  else
    warn "RAILWAY_BOB_TOKEN not set; skipping Bob token check."
  fi

  if [[ -n "${RAILWAY_TOKEN:-}" ]]; then
    railway_api_probe "$RAILWAY_TOKEN" "core" || true
  else
    warn "RAILWAY_TOKEN not set; skipping core token check."
  fi
fi

if [[ "$CHECK_RAILWAY_API" == "true" ]]; then
  if [[ -n "${RAILWAY_BOB_TOKEN:-}" ]]; then
    railway_api_probe "$RAILWAY_BOB_TOKEN" "bob" || true
  else
    warn "RAILWAY_BOB_TOKEN not set; skipping Railway API probe for Bob token."
  fi

  if [[ -n "${RAILWAY_TOKEN:-}" ]]; then
    railway_api_probe "$RAILWAY_TOKEN" "core" || true
  else
    warn "RAILWAY_TOKEN not set; skipping Railway API probe for core token."
  fi
fi

log "Doctor checks passed. RunPod endpoint is reachable from this container with current credentials."
