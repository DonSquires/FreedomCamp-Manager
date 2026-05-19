#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-qwen2.5:7b}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

echo "[build] Starting ollama serve for model bake..."
ollama serve >/tmp/ollama-build.log 2>&1 &
OLLAMA_PID=$!

cleanup() {
  kill "$OLLAMA_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[build] Waiting for Ollama API..."
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[build] Pulling model: ${MODEL}"
ollama pull "${MODEL}"

echo "[build] Baked model list:"
ollama list || true
