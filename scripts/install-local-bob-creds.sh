#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROMPT_MISSING="false"
PROMPT_SERVICE_ROLE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-missing)
      PROMPT_MISSING="true"
      shift
      ;;
    --prompt-service-role)
      PROMPT_SERVICE_ROLE="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/install-local-bob-creds.sh [--prompt-missing] [--prompt-service-role]" >&2
      exit 2
      ;;
  esac
done

set -a
[[ -f .env ]] && source .env || true
[[ -f .env.local ]] && source .env.local || true
[[ -f .env.playwright.local ]] && source .env.playwright.local || true
[[ -f .runtime/bob-local-credentials.env ]] && source .runtime/bob-local-credentials.env || true
set +a

BOB_URL="${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}"
BOB_KEY="${BOB_INFERENCE_API_KEY:-${INFERENCE_API_KEY:-}}"
ORG_ID_VAL="${BOB_ORG_ID:-${ORG_ID:-${DEFAULT_ORG_ID:-}}}"
SUPABASE_URL_VAL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SUPABASE_SERVICE_ROLE_VAL="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ "$PROMPT_MISSING" == "true" ]]; then
  if [[ -z "$BOB_URL" ]]; then
    read -r -p "Enter Bob URL (BOB_SERVICE_URL / INFERENCE_SERVICE_URL): " BOB_URL
  fi

  if [[ -z "$BOB_KEY" ]]; then
    read -r -s -p "Enter Bob API key (BOB_INFERENCE_API_KEY / INFERENCE_API_KEY): " BOB_KEY
    echo
  fi

  if [[ -z "$ORG_ID_VAL" ]]; then
    read -r -p "Enter tenant org id (optional, BOB_ORG_ID): " ORG_ID_VAL
  fi

  if [[ -z "$SUPABASE_URL_VAL" ]]; then
    read -r -p "Enter SUPABASE_URL (optional): " SUPABASE_URL_VAL
  fi
fi

if [[ "$PROMPT_SERVICE_ROLE" == "true" && -z "$SUPABASE_SERVICE_ROLE_VAL" ]]; then
  read -r -s -p "Enter SUPABASE_SERVICE_ROLE_KEY (optional, no echo): " SUPABASE_SERVICE_ROLE_VAL
  echo
fi

if [[ -z "$BOB_URL" || -z "$BOB_KEY" ]]; then
  echo "Missing Bob URL/key sources. Expected one of:" >&2
  echo "  - .runtime/bob-local-credentials.env" >&2
  echo "  - .env/.env.local with BOB_SERVICE_URL + BOB_INFERENCE_API_KEY" >&2
  exit 1
fi

mkdir -p .runtime
TARGET_FILE=".runtime/bob.env"

cat > "$TARGET_FILE" <<EOF
BOB_SERVICE_URL=$BOB_URL
INFERENCE_SERVICE_URL=$BOB_URL
BOB_INFERENCE_API_KEY=$BOB_KEY
INFERENCE_API_KEY=$BOB_KEY
SUPABASE_URL=$SUPABASE_URL_VAL
VITE_SUPABASE_URL=$SUPABASE_URL_VAL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_VAL
BOB_ORG_ID=$ORG_ID_VAL
ORG_ID=$ORG_ID_VAL
DEFAULT_ORG_ID=$ORG_ID_VAL
EOF

chmod 600 "$TARGET_FILE" || true

echo "Installed local Bob credentials at $TARGET_FILE"
if [[ -n "$ORG_ID_VAL" ]]; then
  echo "Org context: SET"
else
  echo "Org context: MISSING (set BOB_ORG_ID/ORG_ID if required for tenant-scoped calls)"
fi
if [[ -n "$SUPABASE_SERVICE_ROLE_VAL" ]]; then
  echo "Supabase service role: SET"
else
  echo "Supabase service role: MISSING (required for admin scripts only)"
fi
