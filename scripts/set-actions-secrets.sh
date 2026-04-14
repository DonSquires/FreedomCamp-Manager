#!/usr/bin/env bash
set -euo pipefail

# Set GitHub Actions secrets from a local env file.
#
# Usage:
#   GH_TOKEN=... ./scripts/set-actions-secrets.sh --repo DonSquires/FreedomCamp-Manager --file .env.actions
#   GH_TOKEN=... ./scripts/set-actions-secrets.sh --repo DonSquires/FreedomCamp-Manager --file .env.actions --env production
#   GH_TOKEN=... ./scripts/set-actions-secrets.sh --repo DonSquires/FreedomCamp-Manager --file .env.actions --dry-run

REPO=""
ENV_FILE=""
ENV_SCOPE=""
DRY_RUN="false"

usage() {
  echo "Usage: $0 --repo <owner/repo> --file <env-file> [--env <environment>] [--dry-run]" >&2
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf "%s" "$s"
}

load_env_file() {
  local file="$1"
  local raw line key val

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="$(trim "$raw")"
    [[ -z "$line" ]] && continue
    [[ "${line:0:1}" == "#" ]] && continue

    if [[ "$line" != *=* ]]; then
      echo "Invalid line in $file (expected KEY=VALUE): $raw" >&2
      exit 2
    fi

    key="${line%%=*}"
    val="${line#*=}"
    key="$(trim "$key")"
    val="$(trim "$val")"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid key in $file: $key" >&2
      exit 2
    fi

    # Accept quoted values without evaluating shell expansions.
    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
      val="${val//\\n/$'\n'}"
      val="${val//\\\"/\"}"
      val="${val//\\\\/\\}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    printf -v "$key" "%s" "$val"
    export "$key"
  done < "$file"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --env)
      ENV_SCOPE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REPO" || -z "$ENV_FILE" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required." >&2
  exit 2
fi

if [[ -z "${GH_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Set GH_TOKEN (or GITHUB_TOKEN) with repo admin permissions before running." >&2
  exit 2
fi

load_env_file "$ENV_FILE"

required=(
  RAILWAY_BOB_TOKEN
  RAILWAY_BOB_SERVICE_ID
  RAILWAY_OLLAMA_SERVICE_ID
  RAILWAY_TOKEN
  RAILWAY_PROXY_SERVICE_ID
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  SUPABASE_ACCESS_TOKEN
  SUPABASE_PROJECT_REF
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_DB_PASSWORD
  INFERENCE_API_KEY
  VERCEL_TOKEN
  VERCEL_ORG_ID
  VERCEL_PROJECT_ID
  BOB_SYNC_PAT
)

optional=(
  RAILWAY_BOB_PROJECT_ID
  RAILWAY_INFERENCE_SERVICE_ID
  OLLAMA_SERVICE_URL
  BOB_SERVICE_URL
  INFERENCE_SERVICE_URL
  PROXY_SERVER_URL
  PTT_SERVER_URL
  FRONTEND_URL
  SYNTHETIC_MONITOR_USER_ID
  BOB_FEEDBACK_SYNC_URL
  BOB_FEEDBACK_SYNC_KEY
  INTEL_FEED_URLS
  INTEL_HMAC_KEY
  INTEL_INGEST_URL
  INTEL_ALLOWED_HOSTS
  INTEL_REGION_ORG_MAP
  INTEL_ENABLE_DB_SYNC
  STATSNZ_API_KEY
  EXPO_TOKEN
  EXPO_PROJECT_ID
  EXPO_PUBLIC_SUPABASE_URL
  EXPO_PUBLIC_SUPABASE_ANON_KEY
  ANDROID_KEYSTORE_BASE64
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_ALIAS
  ANDROID_KEY_PASSWORD
  PTT_PROXY_SECRET
  VITE_SUPABASE_URL_PRODUCTION
  VITE_SUPABASE_ANON_KEY_PRODUCTION
  VITE_INFERENCE_SERVICE_URL_PRODUCTION
  VITE_PROXY_SERVER_URL_PRODUCTION
  VITE_SUPABASE_URL_PREVIEW
  VITE_SUPABASE_ANON_KEY_PREVIEW
  VITE_INFERENCE_SERVICE_URL_PREVIEW
  VITE_PROXY_SERVER_URL_PREVIEW
  API_TEST_BEARER_TOKEN
  API_TEST_EMAIL
  API_TEST_PASSWORD
)

# Compatibility aliases still consumed by some workflows.
aliases=(
  RAILWAY_TOKEN_BOB:RAILWAY_BOB_TOKEN
  RAILWAY_CORE_TOKEN:RAILWAY_TOKEN
  RAILWAY_SERVICE_ID:RAILWAY_BOB_SERVICE_ID
  RAILWAY_PROJECT_ID:RAILWAY_BOB_PROJECT_ID
  BOB_INFERENCE_API_KEY:INFERENCE_API_KEY
  SUPABASE_URL:VITE_SUPABASE_URL
  PROXY_SERVICE_URL:PROXY_SERVER_URL
  NZSCV_PROXY_URL:PROXY_SERVER_URL
  PTT_SERVICE_URL:PTT_SERVER_URL
)

missing=()
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required keys in $ENV_FILE:" >&2
  for key in "${missing[@]}"; do
    echo "  - $key" >&2
  done
  exit 1
fi

set_secret() {
  local key="$1"
  local val="$2"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] would set secret: $key"
    return 0
  fi

  if [[ -n "$ENV_SCOPE" ]]; then
    printf "%s" "$val" | gh secret set "$key" --repo "$REPO" --env "$ENV_SCOPE" --body -
  else
    printf "%s" "$val" | gh secret set "$key" --repo "$REPO" --body -
  fi
  echo "set: $key"
}

echo "Setting required secrets..."
for key in "${required[@]}"; do
  set_secret "$key" "${!key}"
done

echo "Setting optional secrets when present..."
for key in "${optional[@]}"; do
  if [[ -n "${!key:-}" ]]; then
    set_secret "$key" "${!key}"
  else
    echo "skip: $key (not provided)"
  fi
done

echo "Setting compatibility aliases when source values are present..."
for spec in "${aliases[@]}"; do
  alias_key="${spec%%:*}"
  source_key="${spec##*:}"
  if [[ -n "${!source_key:-}" ]]; then
    set_secret "$alias_key" "${!source_key}"
  else
    echo "skip: $alias_key (source $source_key not provided)"
  fi
done

echo "Done."
