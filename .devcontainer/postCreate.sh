#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[postCreate] $*"
}

ensure_shell_path() {
  local start="# >>> freedomcamp-cli-path >>>"
  local end="# <<< freedomcamp-cli-path <<<"
  local line='export PATH="/workspaces/FreedomCamp-Manager/.runtime/bin:$HOME/.local/bin:$PATH"'

  touch "${HOME}/.bashrc" "${HOME}/.profile"
  for shell_file in "${HOME}/.bashrc" "${HOME}/.profile"; do
    if ! grep -q "$start" "$shell_file"; then
      {
        echo
        echo "$start"
        echo "$line"
        echo "$end"
      } >> "$shell_file"
    fi
  done
}

install_runpodctl() {
  if command -v runpodctl >/dev/null 2>&1; then
    log "runpodctl already installed"
    return 0
  fi

  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) arch="amd64" ;;
  esac

  local target=".runtime/bin/runpodctl"
  local latest_tag
  latest_tag="$(curl -fsSL https://api.github.com/repos/runpod/runpodctl/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^\"]+)".*/\1/')"
  if curl -fsSL "https://github.com/runpod/runpodctl/releases/download/v${latest_tag}/runpodctl-linux-${arch}" -o "$target"; then
    chmod +x "$target"
    log "Installed runpodctl ${latest_tag}"
  else
    log "runpodctl binary install failed; continuing"
  fi
}

install_railway() {
  if command -v railway >/dev/null 2>&1; then
    log "railway already installed"
    return 0
  fi

  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) arch="x86_64" ;;
  esac

  local target=".runtime/bin/railway"
  local latest_tag
  latest_tag="$(curl -fsSL https://api.github.com/repos/railwayapp/cli/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^\"]+)".*/\1/')"
  if curl -fsSL "https://github.com/railwayapp/cli/releases/download/v${latest_tag}/railway-v${latest_tag}-${arch}-unknown-linux-musl.tar.gz" -o /tmp/railway.tgz \
    && tar -xzf /tmp/railway.tgz -C /tmp \
    && cp /tmp/railway "$target"; then
    chmod +x "$target"
    log "Installed railway ${latest_tag}"
  else
    log "railway binary install failed; continuing"
  fi
}

install_ripgrep_and_alias() {
  if ! command -v rg >/dev/null 2>&1; then
    local arch
    arch="$(uname -m)"
    case "$arch" in
      x86_64) arch="x86_64" ;;
      aarch64|arm64) arch="aarch64" ;;
      *) arch="x86_64" ;;
    esac

    local latest_tag
    latest_tag="$(curl -fsSL https://api.github.com/repos/BurntSushi/ripgrep/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^\"]+)".*/\1/')"
    if curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${latest_tag}/ripgrep-${latest_tag}-${arch}-unknown-linux-musl.tar.gz" -o /tmp/rg.tgz \
      && tar -xzf /tmp/rg.tgz -C /tmp \
      && cp "/tmp/ripgrep-${latest_tag}-${arch}-unknown-linux-musl/rg" .runtime/bin/rg; then
      chmod +x .runtime/bin/rg
      log "Installed rg ${latest_tag}"
    else
      log "rg binary install failed; continuing"
    fi
  else
    log "rg already installed"
  fi

  if command -v rg >/dev/null 2>&1 && [[ ! -x .runtime/bin/gr ]]; then
    ln -sf "$(command -v rg)" .runtime/bin/gr
    log "Created gr alias -> rg"
  fi
}

install_browser_test_runtime() {
  if command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
    log "system Chromium already installed"
    return 0
  fi

  if command -v apk >/dev/null 2>&1; then
    log "Installing Alpine browser runtime for Playwright"
    sudo apk update
    sudo apk add --no-cache chromium ttf-freefont
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Debian/Ubuntu browser runtime for Playwright"
    sudo apt-get update
    sudo apt-get install -y chromium-browser fonts-freefont-ttf || \
      sudo apt-get install -y chromium fonts-freefont-ttf
    return 0
  fi

  log "No supported package manager found for installing browser runtime"
}

log "Ensuring project env file exists"
cp -n .env.example .env 2>/dev/null || true
mkdir -p .runtime/bin
ensure_shell_path
install_browser_test_runtime

log "Installing JavaScript dependencies"
npm ci

if [[ -n "${OLLAMA_BASE_URL:-}" && "${OLLAMA_BASE_URL}" != http://127.0.0.1:11434 && "${OLLAMA_BASE_URL}" != http://localhost:11434 ]]; then
  log "Using external Ollama at ${OLLAMA_BASE_URL}; skipping local Ollama install"
else
  if ! command -v ollama >/dev/null 2>&1; then
    log "Installing Ollama"
    curl -fsSL https://ollama.com/install.sh | sh
  else
    log "Ollama already installed"
  fi
fi

log "Installing Python dependencies for Bob"
python3 -m pip install --user --upgrade pip
if ! python3 -m pip install --user onnxruntime-gpu; then
  log "onnxruntime-gpu unavailable in this environment; falling back to onnxruntime"
  python3 -m pip install --user onnxruntime
fi
python3 -m pip install --user runpod runpod-cli requests

log "Installing translator pod Python dependencies"
if ! python3 -m pip install --user faster-whisper ctranslate2 transformers; then
  log "faster-whisper stack install failed; continuing without blocking setup"
fi

if ! command -v runpodctl >/dev/null 2>&1; then
  log "Attempting to install RunPod CLI (runpodctl)"
  install_runpodctl
fi

install_railway
install_ripgrep_and_alias

if ! command -v hpanel >/dev/null 2>&1; then
  log "hpanel CLI is not publicly available via standard package sources; skipping"
fi

log "Preparing local model cache"
mkdir -p models

download_model() {
  local url="$1"
  local target="$2"
  if [[ -z "$url" ]]; then
    return 0
  fi

  if [[ -f "$target" ]]; then
    log "Model already present: $target"
    return 0
  fi

  log "Downloading model to $target"
  curl -fL "$url" -o "$target"
}

download_model "${BOB_VEHICLE_MODEL_URL:-}" "models/vehicle-detection.onnx"
download_model "${BOB_FACE_MODEL_URL:-}" "models/face-detection.onnx"
download_model "${BOB_SMOKE_MODEL_URL:-}" "models/smoke-detection.onnx"

if [[ "${CODESPACES:-}" == "true" ]]; then
  log "Running quick Codespaces Bob credential check"
  if ! node scripts/codespace-bob-doctor.mjs >/tmp/bob-codespaces-doctor.log 2>&1; then
    log "Bob doctor check could not complete. Run: npm run bob:codespaces:doctor"
  else
    if grep -q '^MISS' /tmp/bob-codespaces-doctor.log; then
      log "Some Bob/Supabase secrets are missing in this Codespace. Run: npm run bob:codespaces:doctor"
    fi
  fi
fi

log "Bob Codespaces bootstrap complete"
