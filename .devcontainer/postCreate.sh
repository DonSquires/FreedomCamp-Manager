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

if ! command -v ollama >/dev/null 2>&1; then
  log "Installing Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
else
  log "Ollama already installed"
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

log "Bob Codespaces bootstrap complete"
