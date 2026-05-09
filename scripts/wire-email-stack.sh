#!/usr/bin/env bash
set -euo pipefail

# Push SMTP + relay secrets to Supabase and GitHub from a single env file.
#
# Usage:
#   GH_TOKEN=... SUPABASE_ACCESS_TOKEN=... \
#   ./scripts/wire-email-stack.sh --env-file ops/mta/email-secrets.env.example

ENV_FILE=""
SKIP_GH="false"
SKIP_SUPABASE="false"
DRY_RUN="false"

usage() {
  echo "Usage: $0 --env-file <file> [--skip-gh] [--skip-supabase] [--dry-run]" >&2
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

require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required key: $key" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --skip-gh)
      SKIP_GH="true"
      shift
      ;;
    --skip-supabase)
      SKIP_SUPABASE="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 2
fi

load_env_file "$ENV_FILE"

required=(
  SMTP_HOST
  SMTP_PORT
  SMTP_USERNAME
  SMTP_PASSWORD
  SMTP_FROM_EMAIL
  SMTP_FROM_NAME
  SMTP_REPORTS_FROM_EMAIL
  SMTP_REPORTS_FROM_NAME
  REPORT_EMAIL_RELAY_ONLY
  REPORT_EMAIL_RELAY_TIMEOUT_MS
  PROXY_SERVER_URL
  PROXY_SECRET
)

for key in "${required[@]}"; do
  require_var "$key"
done

# Normalize optional aliases
if [[ -z "${NZSCV_PROXY_SECRET:-}" ]]; then
  export NZSCV_PROXY_SECRET="$PROXY_SECRET"
fi
if [[ -z "${PROXY_SERVER_SECRET:-}" ]]; then
  export PROXY_SERVER_SECRET="$PROXY_SECRET"
fi

echo "Loaded SMTP/relay config from $ENV_FILE"

if [[ "$SKIP_SUPABASE" != "true" ]]; then
  if ! command -v supabase >/dev/null 2>&1; then
    echo "supabase CLI is required for Supabase secret sync" >&2
    exit 2
  fi
  require_var SUPABASE_PROJECT_REF
  if [[ "$DRY_RUN" != "true" ]]; then
    require_var SUPABASE_ACCESS_TOKEN
  fi

  echo "Syncing Supabase secrets for project $SUPABASE_PROJECT_REF"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] would set Supabase SMTP and relay secrets"
  else
    SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" supabase secrets set \
      --project-ref "$SUPABASE_PROJECT_REF" \
      SMTP_HOST="$SMTP_HOST" \
      SMTP_PORT="$SMTP_PORT" \
      SMTP_USERNAME="$SMTP_USERNAME" \
      SMTP_PASSWORD="$SMTP_PASSWORD" \
      SMTP_FROM_EMAIL="$SMTP_FROM_EMAIL" \
      SMTP_FROM_NAME="$SMTP_FROM_NAME" \
      SMTP_REPORTS_FROM_EMAIL="$SMTP_REPORTS_FROM_EMAIL" \
      SMTP_REPORTS_FROM_NAME="$SMTP_REPORTS_FROM_NAME" \
      REPORT_EMAIL_RELAY_ONLY="$REPORT_EMAIL_RELAY_ONLY" \
      REPORT_EMAIL_RELAY_TIMEOUT_MS="$REPORT_EMAIL_RELAY_TIMEOUT_MS" \
      PROXY_SERVER_URL="$PROXY_SERVER_URL" \
      PROXY_SECRET="$PROXY_SECRET" \
      NZSCV_PROXY_SECRET="$NZSCV_PROXY_SECRET" \
      PROXY_SERVER_SECRET="$PROXY_SERVER_SECRET"
  fi
fi

if [[ "$SKIP_GH" != "true" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[dry-run] GitHub CLI not found, skipping GitHub secret writes"
      SKIP_GH="true"
    else
      echo "GitHub CLI is required for GitHub secret sync" >&2
      exit 2
    fi
  fi
fi

if [[ "$SKIP_GH" != "true" ]]; then
  if [[ "$DRY_RUN" != "true" ]]; then
    require_var GH_TOKEN
  fi
  require_var GH_REPO

  echo "Syncing GitHub Actions secrets for $GH_REPO"
  set_gh_secret() {
    local key="$1"
    local val="$2"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[dry-run] would set: $key"
    else
      printf "%s" "$val" | gh secret set "$key" --repo "$GH_REPO" --body - >/dev/null
      echo "set: $key"
    fi
  }

  set_gh_secret SMTP_HOST "$SMTP_HOST"
  set_gh_secret SMTP_PORT "$SMTP_PORT"
  set_gh_secret SMTP_USERNAME "$SMTP_USERNAME"
  set_gh_secret SMTP_PASSWORD "$SMTP_PASSWORD"
  set_gh_secret SMTP_FROM_EMAIL "$SMTP_FROM_EMAIL"
  set_gh_secret SMTP_FROM_NAME "$SMTP_FROM_NAME"
  set_gh_secret SMTP_REPORTS_FROM_EMAIL "$SMTP_REPORTS_FROM_EMAIL"
  set_gh_secret SMTP_REPORTS_FROM_NAME "$SMTP_REPORTS_FROM_NAME"
  set_gh_secret REPORT_EMAIL_RELAY_ONLY "$REPORT_EMAIL_RELAY_ONLY"
  set_gh_secret REPORT_EMAIL_RELAY_TIMEOUT_MS "$REPORT_EMAIL_RELAY_TIMEOUT_MS"
  set_gh_secret PROXY_SERVER_URL "$PROXY_SERVER_URL"
  set_gh_secret PROXY_SECRET "$PROXY_SECRET"
  set_gh_secret NZSCV_PROXY_SECRET "$NZSCV_PROXY_SECRET"
  set_gh_secret PROXY_SERVER_SECRET "$PROXY_SERVER_SECRET"
fi

echo "Email stack secret wiring complete"
