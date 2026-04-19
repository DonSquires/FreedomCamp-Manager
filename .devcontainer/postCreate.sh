#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[postCreate] $*"
}

log "Ensuring project env file exists"
cp -n .env.example .env 2>/dev/null || true

log "Installing JavaScript dependencies"
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install
fi

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
python3 -m pip install --user runpod requests

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
