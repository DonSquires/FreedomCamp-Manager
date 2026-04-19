#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_FILE=".runtime/bob.env"
USE_ENV_ONLY="false"
ONLY_MISSING="true"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/secure-secret-inject.sh [options]

Options:
  --target <path>     Target env file (default: .runtime/bob.env)
  --use-env           Use current environment values only (no prompts)
  --all               Prompt for all values, even if already present
  -h, --help          Show help

Required keys:
  BOB_SERVICE_URL (or INFERENCE_SERVICE_URL)
  BOB_INFERENCE_API_KEY (or INFERENCE_API_KEY)

Optional keys:
  BOB_ORG_ID
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_FILE="${2:-}"
      shift 2
      ;;
    --use-env)
      USE_ENV_ONLY="true"
      shift
      ;;
    --all)
      ONLY_MISSING="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

mkdir -p "$(dirname "$TARGET_FILE")"

# Load existing known env files as defaults only in interactive mode.
if [[ "$USE_ENV_ONLY" != "true" ]]; then
  set -a
  [[ -f .env ]] && source .env || true
  [[ -f .env.local ]] && source .env.local || true
  [[ -f .env.playwright.local ]] && source .env.playwright.local || true
  [[ -f .runtime/bob-local-credentials.env ]] && source .runtime/bob-local-credentials.env || true
  [[ -f "$TARGET_FILE" ]] && source "$TARGET_FILE" || true
  set +a
fi

BOB_URL_VAL="${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}"
BOB_KEY_VAL="${BOB_INFERENCE_API_KEY:-${INFERENCE_API_KEY:-}}"
BOB_ORG_VAL="${BOB_ORG_ID:-${ORG_ID:-${DEFAULT_ORG_ID:-}}}"
SUPABASE_URL_VAL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SUPABASE_SRK_VAL="${SUPABASE_SERVICE_ROLE_KEY:-}"

prompt_if_needed() {
  local var_name="$1"
  local current_val="$2"
  local prompt_text="$3"
  local secret_mode="$4"

  if [[ "$ONLY_MISSING" == "true" && -n "$current_val" ]]; then
    printf '%s' "$current_val"
    return 0
  fi

  if [[ "$USE_ENV_ONLY" == "true" ]]; then
    printf '%s' "$current_val"
    return 0
  fi

  local input=""
  if [[ "$secret_mode" == "true" ]]; then
    read -r -s -p "$prompt_text" input
    echo
  else
    read -r -p "$prompt_text" input
  fi

  if [[ -n "$input" ]]; then
    printf '%s' "$input"
  else
    printf '%s' "$current_val"
  fi
}

BOB_URL_VAL="$(prompt_if_needed "BOB_SERVICE_URL" "$BOB_URL_VAL" "Bob URL (BOB_SERVICE_URL): " "false")"
BOB_KEY_VAL="$(prompt_if_needed "BOB_INFERENCE_API_KEY" "$BOB_KEY_VAL" "Bob API key (hidden): " "true")"
BOB_ORG_VAL="$(prompt_if_needed "BOB_ORG_ID" "$BOB_ORG_VAL" "Tenant org id (optional): " "false")"
SUPABASE_URL_VAL="$(prompt_if_needed "SUPABASE_URL" "$SUPABASE_URL_VAL" "SUPABASE_URL (optional): " "false")"
SUPABASE_SRK_VAL="$(prompt_if_needed "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SRK_VAL" "SUPABASE_SERVICE_ROLE_KEY (hidden, optional): " "true")"

if [[ -z "$BOB_URL_VAL" || -z "$BOB_KEY_VAL" ]]; then
  echo "Missing required values: BOB_SERVICE_URL and BOB_INFERENCE_API_KEY are required." >&2
  if [[ "$USE_ENV_ONLY" == "true" ]]; then
    echo "Provide them via environment and rerun with --use-env." >&2
  fi
  exit 1
fi

TMP_FILE="$(mktemp)"
cat > "$TMP_FILE" <<EOF
BOB_SERVICE_URL=$BOB_URL_VAL
INFERENCE_SERVICE_URL=$BOB_URL_VAL
BOB_INFERENCE_API_KEY=$BOB_KEY_VAL
INFERENCE_API_KEY=$BOB_KEY_VAL
SUPABASE_URL=$SUPABASE_URL_VAL
VITE_SUPABASE_URL=$SUPABASE_URL_VAL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SRK_VAL
BOB_ORG_ID=$BOB_ORG_VAL
ORG_ID=$BOB_ORG_VAL
DEFAULT_ORG_ID=$BOB_ORG_VAL
EOF

mv "$TMP_FILE" "$TARGET_FILE"
chmod 600 "$TARGET_FILE" || true

echo "Secure injection complete: $TARGET_FILE"
[[ -n "$BOB_URL_VAL" ]] && echo "BOB_SERVICE_URL=SET"
[[ -n "$BOB_KEY_VAL" ]] && echo "BOB_INFERENCE_API_KEY=SET"
if [[ -n "$BOB_ORG_VAL" ]]; then
  echo "BOB_ORG_ID=SET"
else
  echo "BOB_ORG_ID=MISSING"
fi
if [[ -n "$SUPABASE_SRK_VAL" ]]; then
  echo "SUPABASE_SERVICE_ROLE_KEY=SET"
else
  echo "SUPABASE_SERVICE_ROLE_KEY=MISSING"
fi
