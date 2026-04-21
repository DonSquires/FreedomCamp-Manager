#!/bin/bash
set -e

echo "[start] Starting Ollama..."
ollama serve &
OLLAMA_PID=$!

echo "[start] Waiting for Ollama to be ready..."
until curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done
echo "[start] Ollama is ready"

MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
echo "[start] Verifying model $MODEL is available (pre-baked at build time)..."
# Model is pre-baked — pull only if somehow missing
if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
  echo "[start] Model not found, pulling..."
  ollama pull "$MODEL"
fi
echo "[start] Model ready"

echo "[start] Starting Node worker..."
exec python3 handler.py
