#!/bin/bash
set -e

echo "[start] Starting Ollama..."
ollama serve &
OLLAMA_PID=$!

echo "[start] Waiting for Ollama to be ready (HTTP 200 on /api/tags)..."
until curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done
# Brief extra wait for model loading after API is live
sleep 2
echo "[start] Ollama is ready"

MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
echo "[start] Verifying model $MODEL is available (pre-baked at build time)..."
# Model is pre-baked — pull only if somehow missing
if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
  echo "[start] Model not found, pulling..."
  ollama pull "$MODEL"
fi
echo "[start] Warming up model $MODEL (first request loads weights into VRAM)..."
WARMUP_ATTEMPTS=0
until python3 -c "
import requests, sys
try:
    # Prefer /api/chat, fallback to /api/generate for older Ollama builds.
    r = requests.post('http://127.0.0.1:11434/api/chat',
        json={'model': '${MODEL}', 'messages': [{'role':'user','content':'hi'}], 'stream': False},
        timeout=120)
    if r.status_code == 404:
        r = requests.post('http://127.0.0.1:11434/api/generate',
            json={'model': '${MODEL}', 'prompt': 'hi', 'stream': False},
            timeout=120)
    r.raise_for_status()
    data = r.json()
    preview = (data.get('message', {}) or {}).get('content') or data.get('response') or '?'
    print('[start] Warm-up OK:', str(preview)[:40])
    sys.exit(0)
except Exception as e:
    print('[start] Warm-up not ready:', e)
    sys.exit(1)
"; do
  WARMUP_ATTEMPTS=$((WARMUP_ATTEMPTS+1))
  if [ "$WARMUP_ATTEMPTS" -ge 10 ]; then
    echo "[start] WARNING: warm-up did not complete after 10 attempts, starting handler anyway"
    break
  fi
  sleep 5
done
echo "[start] Model warm-up complete"
exec python3 handler.py
