#!/usr/bin/env bash
set -euo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"

echo "[start] Starting Ollama..."
ollama serve >/tmp/ollama-runtime.log 2>&1 &
OLLAMA_PID=$!

shutdown() {
  kill "$OLLAMA_PID" >/dev/null 2>&1 || true
}
trap shutdown EXIT INT TERM

echo "[start] Waiting for Ollama to be ready (HTTP 200 on /api/tags)..."
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  echo "[start] ERROR: Ollama failed to become ready"
  exit 1
fi

if ! ollama list | grep -q "${OLLAMA_MODEL:-qwen2.5:7b}"; then
  echo "[start] Model ${OLLAMA_MODEL:-qwen2.5:7b} not found locally; pulling at runtime..."
  ollama pull "${OLLAMA_MODEL:-qwen2.5:7b}"
fi

echo "[start] Launching FieldOps worker..."
exec python3 -u /app/handler.py
