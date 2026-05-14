#!/usr/bin/env bash
set -euo pipefail

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

for env_file in .env .env.local .env.playwright.local; do
  load_env_if_missing "./$env_file"
done

if [[ "${1:-}" == "--status" ]]; then
  export PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=0
  bash scripts/playwright-codespace-credentials.sh
  exit 0
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: bash scripts/playwright-bob-runtime.sh <command ...>"
  echo "Example: bash scripts/playwright-bob-runtime.sh bunx playwright test tests/e2e/phase3-sentient-xo.spec.ts --project=chromium"
  exit 1
fi

export PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=0

if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
fi

if [[ -z "${PLAYWRIGHT_BOB_EMAIL:-}" && -n "${BOB_LOGIN_EMAIL:-}" ]]; then
  export PLAYWRIGHT_BOB_EMAIL="$BOB_LOGIN_EMAIL"
fi

if [[ -z "${PLAYWRIGHT_BOB_PASSWORD:-}" && -n "${BOB_LOGIN_PASSWORD:-}" ]]; then
  export PLAYWRIGHT_BOB_PASSWORD="$BOB_LOGIN_PASSWORD"
fi

if [[ -z "${PLAYWRIGHT_BOB_EMAIL:-}" || -z "${PLAYWRIGHT_BOB_PASSWORD:-}" ]]; then
  echo "[playwright-bob-runtime] Missing Bob credentials. Set BOB_LOGIN_EMAIL/BOB_LOGIN_PASSWORD (or PLAYWRIGHT_BOB_EMAIL/PLAYWRIGHT_BOB_PASSWORD)." >&2
  exit 1
fi

exec bash scripts/playwright-codespace-credentials.sh "$@"