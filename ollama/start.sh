#!/bin/sh
# Ollama Railway entrypoint — starts the daemon, waits for it to be ready,
# then optionally pre-pulls the configured model.
#
# Why: Ollama defers model downloads until the first API call. Without this
# script the first /api/chat after a fresh deploy may block for several
# minutes while llama3.1:8b (~4.7 GB) downloads, causing Bob's circuit
# breaker to trip (3 failures -> 60 s cooldown) and degrading AI chat.
#
# OLLAMA_MODEL env var controls which model is pulled (default: llama3.1:8b).
# Set it on the Railway service to switch models without rebuilding the image.
# OLLAMA_PREPULL_MODE controls pull behavior: background (default), blocking, off.

set -e

MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
MAX_WAIT=120   # seconds to wait for daemon to become ready
PREPULL_MODE="${OLLAMA_PREPULL_MODE:-background}"

# ── 1. Start Ollama daemon in the background ──────────────────────────────────
echo "🚀 Starting Ollama daemon..."
ollama serve &
OLLAMA_PID=$!

# ── 2. Poll /api/tags until the daemon responds ───────────────────────────────
echo "⏳ Waiting for Ollama daemon (up to ${MAX_WAIT}s)..."
elapsed=0
until ollama list >/dev/null 2>&1; do
  if [ $elapsed -ge $MAX_WAIT ]; then
    echo "❌ Ollama daemon did not start within ${MAX_WAIT}s"
    echo "  Possible causes:"
    echo "    - Container ran out of memory (check Railway service RAM allocation)"
    echo "    - OLLAMA_HOST is not set to 0.0.0.0:11434 (check Railway service variables)"
    echo "    - The ollama binary failed to start (check Railway build logs)"
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "✅ Ollama daemon is ready (${elapsed}s elapsed)"

# ── 3. Check whether the model is already present ─────────────────────────────
MODEL_BASE="${MODEL%%:*}"   # strip tag for partial-name matching
if ollama list 2>/dev/null | grep -q "${MODEL_BASE}"; then
  echo "✅ Model '${MODEL}' is already available — skipping pull"
else
  if [ "${PREPULL_MODE}" = "off" ]; then
    echo "⏭️  Pre-pull disabled (OLLAMA_PREPULL_MODE=off)"
  elif [ "${PREPULL_MODE}" = "blocking" ]; then
    echo "📦 Pulling model '${MODEL}' in blocking mode (may take several minutes)..."
    ollama pull "${MODEL}" && echo "✅ Model pull complete" || {
      echo "⚠️  Model pull failed — service will attempt pull on first request"
    }
  else
    echo "📦 Starting background model pull for '${MODEL}' (non-blocking startup)..."
    (
      ollama pull "${MODEL}" && echo "✅ Background model pull complete" || {
        echo "⚠️  Background model pull failed — service will attempt pull on first request"
      }
    ) &
  fi
fi

# ── 4. Hand off to the daemon process ─────────────────────────────────────────
echo "🎯 Ollama ready. Waiting on daemon PID ${OLLAMA_PID}..."
wait "${OLLAMA_PID}"
