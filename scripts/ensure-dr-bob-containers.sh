#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOAD_RUNTIME="false"
WRITE_ENV_FILES="false"
STRICT_REQUIRED="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --load-runtime)
      LOAD_RUNTIME="true"
      shift
      ;;
    --write-env-files)
      WRITE_ENV_FILES="true"
      shift
      ;;
    --strict-required)
      STRICT_REQUIRED="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/ensure-dr-bob-containers.sh [--load-runtime] [--write-env-files] [--strict-required]" >&2
      exit 2
      ;;
  esac
done

log() { echo "[dr-bob-ensure] $*"; }
warn() { echo "[dr-bob-ensure][warn] $*"; }
fail() { echo "[dr-bob-ensure][fail] $*"; }

is_http_url() {
  local value="${1:-}"
  [[ "$value" == http://* || "$value" == https://* ]]
}

pick_first_http_url() {
  local value
  for value in "$@"; do
    if is_http_url "$value"; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
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
  load_env_file "$ROOT_DIR/.runtime/bob.env"
  load_env_file "$ROOT_DIR/.env"
  load_env_file "$ROOT_DIR/.env.local"
  load_env_file "$ROOT_DIR/inference-service/.env"
fi

# Normalize aliases to canonical names.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/load-railway-secrets-from-github-env.sh" --quiet

BOB_URL="${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}"
BOB_KEY="${BOB_INFERENCE_API_KEY:-${INFERENCE_API_KEY:-}}"
CHEAP_ENABLED="${CHEAP_MODE_ENABLED:-true}"
CHEAP_MODEL="${CHEAP_MODE_MODEL:-llama3.1:8b}"
CHEAP_TRANSLATION_MODEL="${CHEAP_MODE_TRANSLATION_MODEL:-$CHEAP_MODEL}"
SENIOR_URL="${SENIOR_ARCHITECT_URL:-${SECONDARY_ASSISTANT_URL:-}}"
SENIOR_KEY="${SENIOR_ARCHITECT_API_KEY:-${SECONDARY_ASSISTANT_API_KEY:-}}"
OLLAMA_URL="${OLLAMA_BASE_URL:-${RUNPOD_GATEWAY_URL:-}}"
RUNPOD_API_URL_VALUE="$(pick_first_http_url \
  "${RUNPOD_API_URL:-}" \
  "${RUNPOD_ENDPOINT_URL:-}" \
  "${RUNPOD_RUNSYNC_URL:-}" \
  "${RUNPOD_SERVERLESS_URL:-}" \
  "${RUNPOD_GATEWAY_URL:-}" \
  "${INFERENCE_SERVICE_URL:-}" \
  "${BOB_SERVICE_URL:-}" \
  || true)"
RUNPOD_API_KEY_VALUE="${RUNPOD_API_KEY:-${RUNPOD_ENDPOINT_API_KEY:-${DR_BOB_API:-${INFERENCE_API_KEY:-${BOB_INFERENCE_API_KEY:-}}}}}"

missing=0

if [[ -z "$BOB_URL" ]]; then
  fail "Missing BOB_SERVICE_URL/INFERENCE_SERVICE_URL"
  missing=1
else
  log "Bob URL is configured"
fi

if [[ -z "$BOB_KEY" ]]; then
  fail "Missing BOB_INFERENCE_API_KEY/INFERENCE_API_KEY"
  missing=1
else
  log "Bob API key is configured"
fi

if [[ -z "$OLLAMA_URL" ]]; then
  warn "OLLAMA_BASE_URL and RUNPOD_GATEWAY_URL are both empty (chat fallback may be heuristic)"
else
  log "Model base URL configured"
fi

if [[ -n "${RUNPOD_API_URL:-}" ]] && ! is_http_url "${RUNPOD_API_URL:-}"; then
  warn "Ignoring malformed RUNPOD_API_URL because it is not an http(s) URL"
fi

if [[ -n "$SENIOR_URL" && -z "$SENIOR_KEY" ]]; then
  fail "SENIOR_ARCHITECT_URL is set but SENIOR_ARCHITECT_API_KEY is missing"
  missing=1
fi
if [[ -z "$SENIOR_URL" && -n "$SENIOR_KEY" ]]; then
  fail "SENIOR_ARCHITECT_API_KEY is set but SENIOR_ARCHITECT_URL is missing"
  missing=1
fi

if [[ "$STRICT_REQUIRED" == "true" && "$missing" -ne 0 ]]; then
  exit 1
fi

if [[ "$WRITE_ENV_FILES" == "true" ]]; then
  mkdir -p "$ROOT_DIR/.runtime/container-env"

  for target in app inference-service proxy-server ptt-server runpod-worker; do
    cat > "$ROOT_DIR/.runtime/container-env/${target}.env" <<EOF
BOB_SERVICE_URL=$BOB_URL
INFERENCE_SERVICE_URL=$BOB_URL
BOB_INFERENCE_API_KEY=$BOB_KEY
INFERENCE_API_KEY=$BOB_KEY
CHEAP_MODE_ENABLED=$CHEAP_ENABLED
CHEAP_MODE_MODEL=$CHEAP_MODEL
CHEAP_MODE_TRANSLATION_MODEL=$CHEAP_TRANSLATION_MODEL
SENIOR_ARCHITECT_URL=$SENIOR_URL
SENIOR_ARCHITECT_API_KEY=$SENIOR_KEY
OLLAMA_BASE_URL=$OLLAMA_URL
RUNPOD_API_URL=$RUNPOD_API_URL_VALUE
RUNPOD_ENDPOINT_URL=$RUNPOD_API_URL_VALUE
RUNPOD_API_KEY=$RUNPOD_API_KEY_VALUE
RUNPOD_ENDPOINT_API_KEY=$RUNPOD_API_KEY_VALUE
EOF
  done

  chmod 600 "$ROOT_DIR/.runtime/container-env"/*.env 2>/dev/null || true
  log "Wrote container env overlays to .runtime/container-env/*.env"
fi

if [[ "$missing" -eq 0 ]]; then
  log "Dr Bob container configuration checks passed"
else
  warn "Dr Bob container configuration has missing values (non-strict mode)"
fi
