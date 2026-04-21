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
echo "[start] Pulling model: $MODEL"
ollama pull "$MODEL"
echo "[start] Model ready"

echo "[start] Starting Node worker..."
exec node handler.js
