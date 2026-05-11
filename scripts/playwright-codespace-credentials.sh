#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Playwright credential variables from Codespaces TEST_* secrets.
#
# Usage:
#   bash scripts/playwright-codespace-credentials.sh
#   bash scripts/playwright-codespace-credentials.sh bunx playwright test tests/e2e/phase1-radio-*.spec.ts --project=chromium

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_env_if_missing() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="${raw_line%%#*}"
    line="${line%$'\r'}"
    [[ -n "${line//[[:space:]]/}" ]] || continue
    [[ "$line" == *=* ]] || continue

    local key="${line%%=*}"
    local value="${line#*=}"

    key="${key//[$'\t\r\n '] }"
    key="${key// /}"
    [[ -n "$key" ]] || continue

    value="${value#${value%%[![:space:]]*}}"
    value="${value%${value##*[![:space:]]}}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:-1}"
    fi

    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file_path"
}

# Load local env values (without overwriting already injected env vars).
for env_file in .env .env.local .env.playwright.local; do
  if [[ -f "$env_file" ]]; then
    load_env_if_missing "./$env_file"
  fi
done

set_if_missing() {
  local target="$1"
  local source_name="$2"

  if [[ -z "${!target:-}" && -n "${!source_name:-}" ]]; then
    export "$target=${!source_name}"
  fi
}

set_if_missing_chain() {
  local target="$1"
  shift
  if [[ -n "${!target:-}" ]]; then
    return
  fi
  local src
  for src in "$@"; do
    if [[ -n "${!src:-}" ]]; then
      export "$target=${!src}"
      return
    fi
  done
}

set_alias_pair_if_missing() {
  local canonical="$1"
  local legacy="$2"

  if [[ -z "${!canonical:-}" && -n "${!legacy:-}" ]]; then
    export "$canonical=${!legacy}"
  fi

  if [[ -z "${!legacy:-}" && -n "${!canonical:-}" ]]; then
    export "$legacy=${!canonical}"
  fi
}

# Supabase URL fallback from project ref.
if [[ -z "${VITE_SUPABASE_URL:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  export VITE_SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
fi

# Role credential mappings from TEST_*/E2E_* aliases to PLAYWRIGHT_*.
set_if_missing_chain PLAYWRIGHT_MASTER_EMAIL TEST_MASTER_EMAIL E2E_MASTER_EMAIL API_TEST_EMAIL
set_if_missing_chain PLAYWRIGHT_MASTER_PASSWORD TEST_MASTER_PASSWORD E2E_MASTER_PASSWORD API_TEST_PASSWORD
set_if_missing_chain PLAYWRIGHT_GRANDMASTER_EMAIL TEST_GRANDMASTER_EMAIL E2E_GRANDMASTER_EMAIL PLAYWRIGHT_MASTER_EMAIL
set_if_missing_chain PLAYWRIGHT_GRANDMASTER_PASSWORD TEST_GRANDMASTER_PASSWORD E2E_GRANDMASTER_PASSWORD PLAYWRIGHT_MASTER_PASSWORD

set_if_missing PLAYWRIGHT_ADMIN_ORG1_EMAIL TEST_ADMIN_EMAIL
set_if_missing_chain PLAYWRIGHT_ADMIN_ORG1_PASSWORD TEST_ADMIN_PASSWORD TEST_ADMIN_PASWORD

set_if_missing PLAYWRIGHT_ADMIN_ORG2_EMAIL TEST_CLIENT_EMAIL
set_if_missing PLAYWRIGHT_ADMIN_ORG2_PASSWORD TEST_CLIENT_PASSWORD

set_if_missing PLAYWRIGHT_OFFICER_ORG1_EMAIL TEST_OFFICER_EMAIL
set_if_missing PLAYWRIGHT_OFFICER_ORG1_PASSWORD TEST_OFFICER_PASSWORD

set_if_missing PLAYWRIGHT_OFFICER_ORG2_EMAIL TEST_CLIENT_OFFICER_EMAIL
set_if_missing PLAYWRIGHT_OFFICER_ORG2_PASSWORD TEST_CLIENT_OFFICER_PASSWORD

set_if_missing PLAYWRIGHT_CLIENT_VIEWER_EMAIL TEST_CLIENT_EMAIL
set_if_missing PLAYWRIGHT_CLIENT_VIEWER_PASSWORD TEST_CLIENT_PASSWORD

set_if_missing PLAYWRIGHT_CLIENT_STAFF_EMAIL TEST_CLIENT_OFFICER_EMAIL
set_if_missing PLAYWRIGHT_CLIENT_STAFF_PASSWORD TEST_CLIENT_OFFICER_PASSWORD

# Keep canonical role-pair names and legacy aliases synchronized.
set_alias_pair_if_missing PLAYWRIGHT_MASTER_EMAIL PLAYWRIGHT_GRANDMASTER_EMAIL
set_alias_pair_if_missing PLAYWRIGHT_MASTER_PASSWORD PLAYWRIGHT_GRANDMASTER_PASSWORD
set_alias_pair_if_missing PLAYWRIGHT_ADMIN_ORG1_EMAIL PLAYWRIGHT_ADMIN_EMAIL
set_alias_pair_if_missing PLAYWRIGHT_ADMIN_ORG1_PASSWORD PLAYWRIGHT_ADMIN_PASSWORD
set_alias_pair_if_missing PLAYWRIGHT_OFFICER_ORG1_EMAIL PLAYWRIGHT_OFFICER_EMAIL
set_alias_pair_if_missing PLAYWRIGHT_OFFICER_ORG1_PASSWORD PLAYWRIGHT_OFFICER_PASSWORD

# Supabase helpers for tests that read either generic or Playwright-prefixed keys.
set_alias_pair_if_missing PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY
set_alias_pair_if_missing PLAYWRIGHT_SUPABASE_URL VITE_SUPABASE_URL
set_alias_pair_if_missing PLAYWRIGHT_SUPABASE_ANON_KEY VITE_SUPABASE_ANON_KEY

# Control plane URL fallback for radio floor/SFU tests.
set_if_missing_chain PTT_SERVER_URL VITE_PTT_SERVER_URL RADIO_CONTROL_PLANE_URL PTT_API_CODESPACE

# Allow role-shared fallback to satisfy global preflight in shared sandboxes.
if [[ -z "${PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK:-}" ]]; then
  export PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1
fi

print_status() {
  local vars=(
    VITE_SUPABASE_URL
    VITE_SUPABASE_ANON_KEY
    PLAYWRIGHT_SUPABASE_URL
    PLAYWRIGHT_SUPABASE_ANON_KEY
    PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_SERVICE_ROLE_KEY
    PTT_SERVER_URL
    PLAYWRIGHT_MASTER_EMAIL
    PLAYWRIGHT_MASTER_PASSWORD
    PLAYWRIGHT_GRANDMASTER_EMAIL
    PLAYWRIGHT_GRANDMASTER_PASSWORD
    PLAYWRIGHT_ADMIN_ORG1_EMAIL
    PLAYWRIGHT_ADMIN_ORG1_PASSWORD
    PLAYWRIGHT_ADMIN_ORG2_EMAIL
    PLAYWRIGHT_ADMIN_ORG2_PASSWORD
    PLAYWRIGHT_OFFICER_ORG1_EMAIL
    PLAYWRIGHT_OFFICER_ORG1_PASSWORD
    PLAYWRIGHT_OFFICER_ORG2_EMAIL
    PLAYWRIGHT_OFFICER_ORG2_PASSWORD
    PLAYWRIGHT_CLIENT_VIEWER_EMAIL
    PLAYWRIGHT_CLIENT_VIEWER_PASSWORD
    PLAYWRIGHT_CLIENT_STAFF_EMAIL
    PLAYWRIGHT_CLIENT_STAFF_PASSWORD
    PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK
  )

  echo "[playwright-codespace-credentials] variable status"
  local v
  for v in "${vars[@]}"; do
    if [[ -n "${!v:-}" ]]; then
      echo "- ${v}=set"
    else
      echo "- ${v}=missing"
    fi
  done
}

if [[ $# -eq 0 ]]; then
  echo "[playwright-codespace-credentials] status-only mode; pass a command to execute with mapped credentials"
  print_status
  exit 0
fi

print_status
exec "$@"
