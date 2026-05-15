#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

set -a
[[ -f .env ]] && source .env || true
[[ -f .env.local ]] && source .env.local || true
[[ -f .env.playwright.local ]] && source .env.playwright.local || true
[[ -f .runtime/bob.env ]] && source .runtime/bob.env || true
set +a

export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-1}"
export PLAYWRIGHT_SKIP_ROLE_ASSERTIONS="${PLAYWRIGHT_SKIP_ROLE_ASSERTIONS:-1}"

BUN_BIN="${BOB_BUN_BIN:-/workspaces/.bun/bin/bun}"
BUNX_BIN="${BOB_BUNX_BIN:-/workspaces/.bun/bin/bunx}"

if [[ ! -x "${BUN_BIN}" ]]; then
  BUN_BIN=""
fi

if [[ ! -x "${BUNX_BIN}" ]]; then
  BUNX_BIN=""
fi

vercel_cmd() {
  if command -v vercel >/dev/null 2>&1; then
    vercel "$@"
    return 0
  fi

  if [[ -n "${BUNX_BIN}" ]]; then
    "${BUNX_BIN}" vercel "$@"
    return 0
  fi

  if [[ -n "${BUN_BIN}" ]]; then
    "${BUN_BIN}" x vercel "$@"
    return 0
  fi

  echo "Unable to find vercel, bunx, or bun. Set BOB_BUN_BIN/BOB_BUNX_BIN if your install lives elsewhere."
  exit 127
}

playwright_cmd() {
  if [[ -n "${BUNX_BIN}" ]]; then
    "${BUNX_BIN}" playwright "$@"
    return 0
  fi

  if [[ -n "${BUN_BIN}" ]]; then
    "${BUN_BIN}" x playwright "$@"
    return 0
  fi

  echo "Unable to find playwright via bunx or bun. Set BOB_BUN_BIN/BOB_BUNX_BIN if your install lives elsewhere."
  exit 127
}

usage() {
  cat <<'EOF'
Usage: bash scripts/bob-web-shell.sh <setup|dev|test|full|chat|help> [args...]

Commands:
  setup  Install repo deps and Playwright browser binaries.
  dev    Start the Vercel emulator on localhost.
  test   Run a Bob-focused Playwright slice or the files you pass in.
  full   Run the broader Bob operational E2E set.
  chat   Send a question to Bob via the existing collaboration bridge.
EOF
}

run_setup() {
  if [[ -z "${BUN_BIN}" ]]; then
    echo "Unable to find Bun at /workspaces/.bun/bin/bun. Set BOB_BUN_BIN to the correct path."
    exit 127
  fi

  "${BUN_BIN}" install
  "${BUN_BIN}" run install:playwright
}

run_dev() {
  local host="${BOB_WEB_HOST:-0.0.0.0}"
  local port="${BOB_WEB_PORT:-3000}"
  vercel_cmd dev --listen "${host}:${port}"
}

run_chat() {
  shift || true
  if [[ $# -eq 0 ]]; then
    echo "Usage: bash scripts/bob-web-shell.sh chat \"your question\""
    exit 2
  fi

  if [[ -z "${BUN_BIN}" ]]; then
    echo "Unable to find Bun at /workspaces/.bun/bin/bun. Set BOB_BUN_BIN to the correct path."
    exit 127
  fi

  "${BUN_BIN}" run bob:collab -- ask "$*"
}

run_test() {
  shift || true
  if [[ $# -eq 0 ]]; then
    set -- \
      tests/e2e/bob-human-emulator.spec.ts \
      tests/e2e/phase1-director-roster-gate.spec.ts \
      tests/e2e/module-route-access-admin-operations-bob.spec.ts \
      tests/e2e/noise-e2e.spec.ts \
      tests/e2e/asset-management-scan.spec.ts \
      tests/e2e/live-officer-active-visible.spec.ts \
      tests/e2e/phase-c1-site-guard.spec.ts \
      tests/e2e/ptt-enterprise-validation.spec.ts
  fi

  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS}" \
  PLAYWRIGHT_SKIP_ROLE_ASSERTIONS="${PLAYWRIGHT_SKIP_ROLE_ASSERTIONS}" \
    playwright_cmd test "$@" --project=chromium --workers="${BOB_WEB_WORKERS:-1}"
}

run_full() {
  shift || true
  if [[ $# -gt 0 ]]; then
    run_test "$@"
    return 0
  fi

  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS}" \
  PLAYWRIGHT_SKIP_ROLE_ASSERTIONS="${PLAYWRIGHT_SKIP_ROLE_ASSERTIONS}" \
    playwright_cmd test \
      tests/e2e/bob-human-emulator.spec.ts \
      tests/e2e/phase1-director-roster-gate.spec.ts \
      tests/e2e/module-route-access-admin-operations-bob.spec.ts \
      tests/e2e/noise-e2e.spec.ts \
      tests/e2e/phase-b1-patrol-and-respond.spec.ts \
      tests/e2e/phase-b2-dispatch-command.spec.ts \
      tests/e2e/phase-b4-enforcement-timeline.spec.ts \
      tests/e2e/asset-management-scan.spec.ts \
      tests/e2e/phase-c1-site-guard.spec.ts \
      tests/e2e/live-officer-active-visible.spec.ts \
      tests/e2e/phase4-operations-map-emergency-banner.spec.ts \
      tests/e2e/ptt-enterprise-validation.spec.ts \
      tests/e2e/phase3-sentient-xo.spec.ts \
      tests/e2e/phase4-admirals-bridge.spec.ts \
      --project=chromium --workers="${BOB_WEB_WORKERS:-1}"
}

command="${1:-help}"
case "${command}" in
  setup)
    run_setup
    ;;
  dev)
    run_dev
    ;;
  test)
    run_test "$@"
    ;;
  full)
    run_full "$@"
    ;;
  chat)
    run_chat "$@"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac