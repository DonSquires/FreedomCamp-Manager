#!/usr/bin/env bash
set -euo pipefail

QUIET=0
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
fi

log() {
  if [[ "$QUIET" -eq 0 ]]; then
    echo "[bob-tools-bootstrap] $*"
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_with_apk() {
  if ! has_cmd apk; then
    return 1
  fi

  if has_cmd sudo; then
    sudo apk add --no-cache "$@"
    return 0
  fi

  apk add --no-cache "$@"
}

if ! has_cmd node || ! has_cmd npm || ! has_cmd npx; then
  log "Installing Node.js and npm..."
  install_with_apk nodejs npm || true
fi

if ! has_cmd chromium && [[ ! -x "/usr/bin/chromium" ]]; then
  log "Installing system Chromium..."
  install_with_apk chromium || true
fi

if has_cmd npx; then
  log "Ensuring Playwright Chromium browser binaries are installed..."
  npx playwright install chromium >/dev/null 2>&1 || true
fi

if ! has_cmd node || ! has_cmd npm || ! has_cmd npx; then
  echo "[bob-tools-bootstrap] ERROR: node/npm/npx are still unavailable after bootstrap." >&2
  exit 1
fi

if ! has_cmd chromium && [[ ! -x "/usr/bin/chromium" ]]; then
  echo "[bob-tools-bootstrap] ERROR: system Chromium is unavailable after bootstrap." >&2
  exit 1
fi

log "Bootstrap complete."
