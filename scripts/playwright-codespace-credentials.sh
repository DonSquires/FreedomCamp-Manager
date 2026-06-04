#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Playwright credential variables from Codespaces TEST_* secrets.
#
# Usage:
#   bash scripts/playwright-codespace-credentials.sh
#   bash scripts/playwright-codespace-credentials.sh npx playwright test tests/e2e/phase1-radio-*.spec.ts --project=chromium

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

set_pair_from_profile() {
  local email_target="$1"
  local password_target="$2"
  local email_source="$3"
  local password_source="$4"
  local email_fallback="${5:-}"
  local password_fallback="${6:-}"

  local resolved_email="${!email_source:-}"
  local resolved_password="${!password_source:-}"

  if [[ -z "$resolved_email" && -n "$email_fallback" ]]; then
    resolved_email="${!email_fallback:-}"
  fi

  if [[ -z "$resolved_password" && -n "$password_fallback" ]]; then
    resolved_password="${!password_fallback:-}"
  fi

  if [[ -z "$resolved_email" || -z "$resolved_password" ]]; then
    local email_sources="$email_source"
    local password_sources="$password_source"
    if [[ -n "$email_fallback" ]]; then
      email_sources+="|$email_fallback"
    fi
    if [[ -n "$password_fallback" ]]; then
      password_sources+="|$password_fallback"
    fi
    echo "[playwright-codespace-credentials] profile is missing required vars: ${email_sources}/${password_sources}" >&2
    exit 2
  fi

  export "$email_target=$resolved_email"
  export "$password_target=$resolved_password"
}

apply_login_profile() {
  local profile="${TEST_LOGIN_PROFILE:-}"
  [[ -n "$profile" ]] || return 0

  case "$profile" in
    master)
      set_pair_from_profile PLAYWRIGHT_MASTER_EMAIL PLAYWRIGHT_MASTER_PASSWORD TEST_LOGIN_MASTER_EMAIL TEST_LOGIN_MASTER_PASSWORD TEST_MASTER_EMAIL TEST_MASTER_PASSWORD
      ;;
    admin_org1)
      set_pair_from_profile PLAYWRIGHT_ADMIN_ORG1_EMAIL PLAYWRIGHT_ADMIN_ORG1_PASSWORD TEST_LOGIN_ADMIN_ORG1_EMAIL TEST_LOGIN_ADMIN_ORG1_PASSWORD PLAYWRIGHT_ADMIN_ORG1_EMAIL PLAYWRIGHT_ADMIN_ORG1_PASSWORD
      ;;
    admin_org2)
      set_pair_from_profile PLAYWRIGHT_ADMIN_ORG2_EMAIL PLAYWRIGHT_ADMIN_ORG2_PASSWORD TEST_LOGIN_ADMIN_ORG2_EMAIL TEST_LOGIN_ADMIN_ORG2_PASSWORD PLAYWRIGHT_ADMIN_ORG2_EMAIL PLAYWRIGHT_ADMIN_ORG2_PASSWORD
      ;;
    officer_org1)
      set_pair_from_profile PLAYWRIGHT_OFFICER_ORG1_EMAIL PLAYWRIGHT_OFFICER_ORG1_PASSWORD TEST_LOGIN_OFFICER_ORG1_EMAIL TEST_LOGIN_OFFICER_ORG1_PASSWORD PLAYWRIGHT_OFFICER_ORG1_EMAIL PLAYWRIGHT_OFFICER_ORG1_PASSWORD
      ;;
    client_viewer)
      set_pair_from_profile PLAYWRIGHT_CLIENT_VIEWER_EMAIL PLAYWRIGHT_CLIENT_VIEWER_PASSWORD TEST_LOGIN_CLIENT_VIEWER_EMAIL TEST_LOGIN_CLIENT_VIEWER_PASSWORD PLAYWRIGHT_CLIENT_VIEWER_EMAIL PLAYWRIGHT_CLIENT_VIEWER_PASSWORD
      ;;
    client_staff)
      set_pair_from_profile PLAYWRIGHT_CLIENT_STAFF_EMAIL PLAYWRIGHT_CLIENT_STAFF_PASSWORD TEST_LOGIN_CLIENT_STAFF_EMAIL TEST_LOGIN_CLIENT_STAFF_PASSWORD PLAYWRIGHT_CLIENT_STAFF_EMAIL PLAYWRIGHT_CLIENT_STAFF_PASSWORD
      ;;
    bob_admin_officer)
      set_pair_from_profile PLAYWRIGHT_BOB_EMAIL PLAYWRIGHT_BOB_PASSWORD TEST_LOGIN_BOB_ADMIN_OFFICER_EMAIL TEST_LOGIN_BOB_ADMIN_OFFICER_PASSWORD PLAYWRIGHT_BOB_EMAIL PLAYWRIGHT_BOB_PASSWORD
      export BOB_LOGIN_EMAIL="$PLAYWRIGHT_BOB_EMAIL"
      export BOB_LOGIN_PASSWORD="$PLAYWRIGHT_BOB_PASSWORD"
      ;;
    bob_grand_master)
      set_pair_from_profile PLAYWRIGHT_BOB_EMAIL PLAYWRIGHT_BOB_PASSWORD TEST_LOGIN_BOB_GRAND_MASTER_EMAIL TEST_LOGIN_BOB_GRAND_MASTER_PASSWORD PLAYWRIGHT_BOB_EMAIL PLAYWRIGHT_BOB_PASSWORD
      export BOB_LOGIN_EMAIL="$PLAYWRIGHT_BOB_EMAIL"
      export BOB_LOGIN_PASSWORD="$PLAYWRIGHT_BOB_PASSWORD"
      ;;
    *)
      echo "[playwright-codespace-credentials] invalid TEST_LOGIN_PROFILE=$profile" >&2
      echo "Valid profiles: master, admin_org1, admin_org2, officer_org1, client_viewer, client_staff, bob_admin_officer, bob_grand_master" >&2
      exit 2
      ;;
  esac

  echo "[playwright-codespace-credentials] applied TEST_LOGIN_PROFILE=$profile"
}

# Supabase URL fallback from project ref.
if [[ -z "${VITE_SUPABASE_URL:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  export VITE_SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
fi

# Browser executable fallback for Alpine/devcontainer Playwright runs.
# This only pins the runtime binary path; it does not alter test logic/assertions.
set_if_missing PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH CHROMIUM_PATH
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  if [[ -x "/usr/bin/chromium" ]]; then
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/usr/bin/chromium"
  elif [[ -x "/usr/bin/chromium-browser" ]]; then
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/usr/bin/chromium-browser"
  fi
fi

# Shared fallback account used by auth helpers in tests/e2e/auth.ts.
set_if_missing PLAYWRIGHT_OWNER_EMAIL TEST_OWNER_EMAIL
set_if_missing PLAYWRIGHT_OWNER_PASSWORD TEST_OWNER_PASSWORD

# Role credential mappings from TEST_* to PLAYWRIGHT_*.
set_if_missing_chain PLAYWRIGHT_MASTER_EMAIL TEST_LOGIN_MASTER_EMAIL TEST_MASTER_EMAIL
set_if_missing_chain PLAYWRIGHT_MASTER_PASSWORD TEST_LOGIN_MASTER_PASSWORD TEST_MASTER_PASSWORD

set_if_missing_chain PLAYWRIGHT_ADMIN_ORG1_EMAIL TEST_LOGIN_ADMIN_ORG1_EMAIL TEST_ADMIN_ORG1_EMAIL TEST_ADMIN_EMAIL
set_if_missing_chain PLAYWRIGHT_ADMIN_ORG1_PASSWORD TEST_LOGIN_ADMIN_ORG1_PASSWORD TEST_ADMIN_ORG1_PASSWORD TEST_ADMIN_PASSWORD TEST_ADMIN_PASWORD

set_if_missing_chain PLAYWRIGHT_ADMIN_ORG2_EMAIL TEST_LOGIN_ADMIN_ORG2_EMAIL TEST_ADMIN_ORG2_EMAIL
set_if_missing_chain PLAYWRIGHT_ADMIN_ORG2_PASSWORD TEST_LOGIN_ADMIN_ORG2_PASSWORD TEST_ADMIN_ORG2_PASSWORD

set_if_missing_chain PLAYWRIGHT_OFFICER_ORG1_EMAIL TEST_LOGIN_OFFICER_ORG1_EMAIL TEST_OFFICER_ORG1_EMAIL TEST_OFFICER_EMAIL
set_if_missing_chain PLAYWRIGHT_OFFICER_ORG1_PASSWORD TEST_LOGIN_OFFICER_ORG1_PASSWORD TEST_OFFICER_ORG1_PASSWORD TEST_OFFICER_PASSWORD

set_if_missing_chain PLAYWRIGHT_OFFICER_ORG2_EMAIL TEST_OFFICER_ORG2_EMAIL TEST_CLIENT_OFFICER_EMAIL
set_if_missing_chain PLAYWRIGHT_OFFICER_ORG2_PASSWORD TEST_OFFICER_ORG2_PASSWORD TEST_CLIENT_OFFICER_PASSWORD

set_if_missing_chain PLAYWRIGHT_CLIENT_VIEWER_EMAIL TEST_LOGIN_CLIENT_VIEWER_EMAIL TEST_CLIENT_VIEWER_EMAIL TEST_CLIENT_EMAIL
set_if_missing_chain PLAYWRIGHT_CLIENT_VIEWER_PASSWORD TEST_LOGIN_CLIENT_VIEWER_PASSWORD TEST_CLIENT_VIEWER_PASSWORD TEST_CLIENT_PASSWORD

set_if_missing_chain PLAYWRIGHT_CLIENT_STAFF_EMAIL TEST_LOGIN_CLIENT_STAFF_EMAIL TEST_CLIENT_STAFF_EMAIL
set_if_missing_chain PLAYWRIGHT_CLIENT_STAFF_PASSWORD TEST_LOGIN_CLIENT_STAFF_PASSWORD TEST_CLIENT_STAFF_PASSWORD

# Organization alignment defaults for role-assertion checks in tests/e2e/auth.ts.
# Keep all role personas aligned with the canonical Iron Eagle org unless explicitly overridden.
set_if_missing_chain PLAYWRIGHT_TEST_ORG_NAME TEST_ORG_NAME TEST_ORGANIZATION_NAME E2E_TEST_ORG_NAME PLAYWRIGHT_DEFAULT_TEST_ORG_NAME
if [[ -z "${PLAYWRIGHT_TEST_ORG_NAME:-}" ]]; then
  export PLAYWRIGHT_TEST_ORG_NAME="Iron Eagle Security Limited"
fi
set_if_missing PLAYWRIGHT_ADMIN_ORG1_NAME PLAYWRIGHT_TEST_ORG_NAME
set_if_missing PLAYWRIGHT_ADMIN_ORG2_NAME PLAYWRIGHT_TEST_ORG_NAME
set_if_missing PLAYWRIGHT_OFFICER_ORG1_NAME PLAYWRIGHT_TEST_ORG_NAME
set_if_missing PLAYWRIGHT_CLIENT_VIEWER_NAME PLAYWRIGHT_TEST_ORG_NAME
set_if_missing PLAYWRIGHT_CLIENT_STAFF_NAME PLAYWRIGHT_TEST_ORG_NAME
set_if_missing BOB_LOGIN_ORG_NAME PLAYWRIGHT_TEST_ORG_NAME

set_if_missing_chain PLAYWRIGHT_BOB_EMAIL BOB_LOGIN_EMAIL TEST_BOB_EMAIL
set_if_missing_chain PLAYWRIGHT_BOB_PASSWORD BOB_LOGIN_PASSWORD TEST_BOB_PASSWORD

# Dedicated Bob persona slots used by strict e2e preflight checks.
set_if_missing_chain PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL TEST_LOGIN_BOB_ADMIN_OFFICER_EMAIL TEST_BOB_ADMIN_OFFICER_EMAIL
set_if_missing_chain PLAYWRIGHT_BOB_ADMIN_OFFICER_PASSWORD TEST_LOGIN_BOB_ADMIN_OFFICER_PASSWORD TEST_BOB_ADMIN_OFFICER_PASSWORD
set_if_missing_chain PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL TEST_LOGIN_BOB_GRAND_MASTER_EMAIL TEST_BOB_GRAND_MASTER_EMAIL PLAYWRIGHT_BOB_EMAIL
set_if_missing_chain PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD TEST_LOGIN_BOB_GRAND_MASTER_PASSWORD TEST_BOB_GRAND_MASTER_PASSWORD PLAYWRIGHT_BOB_PASSWORD
set_alias_pair_if_missing PLAYWRIGHT_BOB_EMAIL BOB_LOGIN_EMAIL
set_alias_pair_if_missing PLAYWRIGHT_BOB_PASSWORD BOB_LOGIN_PASSWORD

# Optional explicit profile selection so role-sensitive tests always use the
# intended privilege pair (for example bob_admin_officer vs bob_grand_master).
# Apply this before API_TEST and alias sync so all derived aliases stay coherent.
apply_login_profile

is_user_request_job=0
request_signal="${BOB_REQUEST_SOURCE:-}${JOB_REQUEST_SOURCE:-}${HEAL_ERROR_MESSAGE:-}${BOB_JOB_INTENT:-}${BOB_USER_REQUEST_MODE:-}"
request_signal="${request_signal,,}"
if [[ "$request_signal" == *"manual_user_instruction"* || "$request_signal" == *"user_request"* || "$request_signal" == "1" ]]; then
  is_user_request_job=1
fi

# Hardwire automation credentials for non-user-request jobs.
if [[ "$is_user_request_job" -eq 0 ]]; then
  # Default to disabled so role-specific personas are preserved unless explicitly enabled.
  hardwire_enabled="${PLAYWRIGHT_HARDWIRE_AUTOMATION_CREDENTIALS:-${BOB_HARDWIRE_AUTOMATION_CREDENTIALS:-0}}"
  hardwire_enabled="${hardwire_enabled,,}"

  if [[ "$hardwire_enabled" == "1" || "$hardwire_enabled" == "true" ]]; then
    master_email="${PLAYWRIGHT_MASTER_EMAIL:-${E2E_MASTER_EMAIL:-${BOB_LOGIN_EMAIL:-${PLAYWRIGHT_BOB_EMAIL:-${PLAYWRIGHT_ADMIN_ORG1_EMAIL:-${PLAYWRIGHT_ADMIN_EMAIL:-}}}}}}"
    master_password="${PLAYWRIGHT_MASTER_PASSWORD:-${E2E_MASTER_PASSWORD:-${BOB_LOGIN_PASSWORD:-${PLAYWRIGHT_BOB_PASSWORD:-${PLAYWRIGHT_ADMIN_ORG1_PASSWORD:-${PLAYWRIGHT_ADMIN_PASSWORD:-}}}}}}"

    if [[ -n "$master_email" && -n "$master_password" ]]; then
      export PLAYWRIGHT_MASTER_EMAIL="$master_email"
      export PLAYWRIGHT_MASTER_PASSWORD="$master_password"

      export PLAYWRIGHT_ADMIN_ORG1_EMAIL="$master_email"
      export PLAYWRIGHT_ADMIN_ORG1_PASSWORD="$master_password"
      export PLAYWRIGHT_ADMIN_ORG2_EMAIL="$master_email"
      export PLAYWRIGHT_ADMIN_ORG2_PASSWORD="$master_password"
      export PLAYWRIGHT_OFFICER_ORG1_EMAIL="$master_email"
      export PLAYWRIGHT_OFFICER_ORG1_PASSWORD="$master_password"
      export PLAYWRIGHT_CLIENT_VIEWER_EMAIL="$master_email"
      export PLAYWRIGHT_CLIENT_VIEWER_PASSWORD="$master_password"
      export PLAYWRIGHT_CLIENT_STAFF_EMAIL="$master_email"
      export PLAYWRIGHT_CLIENT_STAFF_PASSWORD="$master_password"
      export PLAYWRIGHT_BOB_EMAIL="$master_email"
      export PLAYWRIGHT_BOB_PASSWORD="$master_password"
      export BOB_LOGIN_EMAIL="$master_email"
      export BOB_LOGIN_PASSWORD="$master_password"

      export API_TEST_EMAIL="$master_email"
      export API_TEST_PASSWORD="$master_password"
      export PLAYWRIGHT_LIVE_EMAIL="$master_email"
      export PLAYWRIGHT_LIVE_PASSWORD="$master_password"
    fi
  fi
fi

# API/live credential aliases used by auth helpers in tests/e2e/auth.ts.
# Prefer owner credentials first because they are typically the most stable shared account.
set_if_missing_chain API_TEST_EMAIL TEST_OWNER_EMAIL TEST_ADMIN_EMAIL PLAYWRIGHT_ADMIN_ORG1_EMAIL PLAYWRIGHT_ADMIN_EMAIL
set_if_missing_chain API_TEST_PASSWORD TEST_OWNER_PASSWORD TEST_ADMIN_PASSWORD TEST_ADMIN_PASWORD PLAYWRIGHT_ADMIN_ORG1_PASSWORD PLAYWRIGHT_ADMIN_PASSWORD
set_if_missing_chain PLAYWRIGHT_LIVE_EMAIL API_TEST_EMAIL PLAYWRIGHT_ADMIN_ORG1_EMAIL PLAYWRIGHT_ADMIN_EMAIL
set_if_missing_chain PLAYWRIGHT_LIVE_PASSWORD API_TEST_PASSWORD PLAYWRIGHT_ADMIN_ORG1_PASSWORD PLAYWRIGHT_ADMIN_PASSWORD

# If API_TEST_* was pre-exported from TEST_ADMIN_* in a prior shell, prefer the
# owner pair when available so live auth bootstrap remains stable.
if [[ -n "${TEST_OWNER_EMAIL:-}" && -n "${TEST_OWNER_PASSWORD:-}" ]]; then
  if [[ "${API_TEST_EMAIL:-}" == "${TEST_ADMIN_EMAIL:-}" || "${PLAYWRIGHT_LIVE_EMAIL:-}" == "${TEST_ADMIN_EMAIL:-}" ]]; then
    export API_TEST_EMAIL="$TEST_OWNER_EMAIL"
    export API_TEST_PASSWORD="$TEST_OWNER_PASSWORD"
    export PLAYWRIGHT_LIVE_EMAIL="$TEST_OWNER_EMAIL"
    export PLAYWRIGHT_LIVE_PASSWORD="$TEST_OWNER_PASSWORD"
  fi
fi

# Keep canonical role-pair names and legacy aliases synchronized.
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
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    PLAYWRIGHT_MASTER_EMAIL
    PLAYWRIGHT_MASTER_PASSWORD
    PLAYWRIGHT_ADMIN_ORG1_EMAIL
    PLAYWRIGHT_ADMIN_ORG1_PASSWORD
    PLAYWRIGHT_ADMIN_ORG2_EMAIL
    PLAYWRIGHT_ADMIN_ORG2_PASSWORD
    PLAYWRIGHT_OFFICER_ORG1_EMAIL
    PLAYWRIGHT_OFFICER_ORG1_PASSWORD
    PLAYWRIGHT_OFFICER_ORG2_EMAIL
    PLAYWRIGHT_OFFICER_ORG2_PASSWORD
    PLAYWRIGHT_BOB_EMAIL
    PLAYWRIGHT_BOB_PASSWORD
    PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL
    PLAYWRIGHT_BOB_ADMIN_OFFICER_PASSWORD
    PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL
    PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD
    PLAYWRIGHT_CLIENT_VIEWER_EMAIL
    PLAYWRIGHT_CLIENT_VIEWER_PASSWORD
    PLAYWRIGHT_CLIENT_STAFF_EMAIL
    PLAYWRIGHT_CLIENT_STAFF_PASSWORD
    TEST_LOGIN_PROFILE
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
