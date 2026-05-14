#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "[staging-tooling] $*"; }
warn() { echo "[staging-tooling][warn] $*"; }

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    log "bun already available: $(bun --version)"
    return
  fi

  if [[ -x "/workspaces/.bun/bin/bun" ]]; then
    export PATH="/workspaces/.bun/bin:$PATH"
    log "bun found at /workspaces/.bun/bin/bun: $(bun --version)"
    return
  fi

  log "installing bun to /workspaces/.bun"
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/workspaces/.bun bash
  export PATH="/workspaces/.bun/bin:$PATH"
  log "bun installed: $(bun --version)"
}

ensure_node_musl() {
  local node_bin="/workspaces/.local/node/bin/node"
  if [[ -x "$node_bin" ]]; then
    export PATH="/workspaces/.local/node/bin:$PATH"
    log "node already available: $(node -v)"
    log "npm already available: $(npm -v)"
    return
  fi

  log "installing musl node/npm to /workspaces/.local/node"
  rm -rf /workspaces/.local/node
  mkdir -p /workspaces/.local/node
  curl -fsSL "https://unofficial-builds.nodejs.org/download/release/v20.19.2/node-v20.19.2-linux-x64-musl.tar.xz" -o /tmp/node-v20.19.2-linux-x64-musl.tar.xz
  tar -xJf /tmp/node-v20.19.2-linux-x64-musl.tar.xz -C /workspaces/.local/node --strip-components=1
  export PATH="/workspaces/.local/node/bin:$PATH"
  log "node installed: $(node -v)"
  log "npm installed: $(npm -v)"
}

ensure_playwright_chromium_bundle() {
  log "installing Playwright chromium bundle"
  bash scripts/use-bun.sh bunx playwright install chromium
}

check_chromium_runtime() {
  local candidates=(
    "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/home/vscode/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome"
    "/home/vscode/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell"
  )

  local found_any="false"
  local runnable=""
  for path in "${candidates[@]}"; do
    [[ -n "$path" ]] || continue
    [[ -x "$path" ]] || continue
    found_any="true"
    if "$path" --version >/tmp/staging-chromium-version.txt 2>&1; then
      runnable="$path"
      break
    fi
  done

  if [[ -n "$runnable" ]]; then
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$runnable"
    log "chromium runtime OK: $runnable"
    log "version: $(cat /tmp/staging-chromium-version.txt | head -n 1)"
    return
  fi

  if [[ "$found_any" == "true" ]]; then
    warn "chromium binaries exist but are not runnable on this host (likely libc/runtime mismatch)."
  else
    warn "no chromium binary found."
  fi
  warn "If you have root access in this container, install native chromium: apk add --no-cache chromium"
}

run_bob_doctor() {
  log "running Bob container doctor"
  bash scripts/use-bun.sh bun run bob:doctor:any-container
}

main() {
  ensure_bun
  ensure_node_musl
  ensure_playwright_chromium_bundle
  check_chromium_runtime
  run_bob_doctor
  log "tooling bootstrap complete"
}

main "$@"
