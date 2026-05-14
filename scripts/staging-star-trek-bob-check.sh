#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "[staging-star-trek-bob-check] $*"; }
warn() { echo "[staging-star-trek-bob-check][warn] $*"; }

run_with_bun() {
  bash scripts/use-bun.sh "$@"
}

find_runnable_chromium() {
  local candidates=(
    "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/home/vscode/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome"
    "/home/vscode/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    [[ -x "$candidate" ]] || continue
    if "$candidate" --version >/tmp/staging-chromium-version.txt 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

run_browser_suite() {
  local chromium_path="$1"
  log "Chromium runtime detected: $chromium_path"
  log "Chromium version: $(cat /tmp/staging-chromium-version.txt | head -n 1)"

  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$chromium_path" \
    run_with_bun bash scripts/playwright-bob-runtime.sh \
    bunx playwright test \
    tests/e2e/phase3-sentient-xo.spec.ts \
    tests/e2e/phase4-admirals-bridge.spec.ts \
    --project=chromium --workers=1 --reporter=line
}

run_non_browser_fallback() {
  warn "Chromium is unavailable in this container. Running non-browser fallback checks."

  run_with_bun bun run bob:doctor:any-container
  run_with_bun bash scripts/playwright-codespace-credentials.sh
  run_with_bun bun scripts/check-staging-doc.mjs
  run_with_bun bun run ops:audit:time-restrictions
  run_with_bun bun run build:split

  log "Fallback checks completed successfully."
  log "To enable browser E2E in this container, install native chromium (root required): apk add --no-cache chromium"
}

main() {
  local chromium_path=""
  if chromium_path="$(find_runnable_chromium)"; then
    run_browser_suite "$chromium_path"
  else
    run_non_browser_fallback
  fi
}

main "$@"
