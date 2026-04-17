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
# OLLAMA_EXTRA_MODELS is optional and defaults to empty to keep the baseline
# memory footprint low enough for a single 24 GB Railway replica.
# OLLAMA_PREPULL_MODE controls pull behavior: background (default), blocking, off.
# OLLAMA_PULL_DELAY_SECONDS inserts a pause between model pulls so download and
# load activity ramps up more gradually on constrained Railway instances.
# Note: This script also acts as a push-trigger anchor for Railway deploy workflow runs.

set -e

MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
EXTRA_MODELS="${OLLAMA_EXTRA_MODELS:-}"
MAX_WAIT=120   # seconds to wait for daemon to become ready
PREPULL_MODE="${OLLAMA_PREPULL_MODE:-background}"
PULL_DELAY_SECONDS="${OLLAMA_PULL_DELAY_SECONDS:-20}"
PORT="${PORT:-11434}"
export OLLAMA_HOST="0.0.0.0:${PORT}"

echo "🌐 Binding Ollama to ${OLLAMA_HOST}"

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
    echo "    - OLLAMA_HOST/PORT mismatch (expected ${OLLAMA_HOST})"
    echo "    - The ollama binary failed to start (check Railway build logs)"
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "✅ Ollama daemon is ready (${elapsed}s elapsed)"

# ── 3. Check whether the configured models are already present ────────────────
MODELS_TO_PULL="${MODEL}"
if [ -n "${EXTRA_MODELS}" ]; then
  MODELS_TO_PULL="${MODELS_TO_PULL},${EXTRA_MODELS}"
fi

pull_model_if_needed() {
  target="$1"
  target_base="${target%%:*}"  # strip tag for partial-name matching
  if ollama list 2>/dev/null | grep -q "${target_base}"; then
    echo "✅ Model '${target}' is already available — skipping pull"
    return 0
  fi

  if [ "${PREPULL_MODE}" = "off" ]; then
    echo "⏭️  Pre-pull disabled (OLLAMA_PREPULL_MODE=off) for '${target}'"
    return 0
  fi

  if [ "${PREPULL_MODE}" = "blocking" ]; then
    echo "📦 Pulling model '${target}' in blocking mode (may take several minutes)..."
    ollama pull "${target}" && echo "✅ Model pull complete: ${target}" || {
      echo "⚠️  Model pull failed for '${target}' — service will attempt pull on first request"
    }
  else
    echo "📦 Starting background model pull for '${target}' (non-blocking startup)..."
    (
      ollama pull "${target}" && echo "✅ Background model pull complete: ${target}" || {
        echo "⚠️  Background model pull failed for '${target}' — service will attempt pull on first request"
      }
    ) &
  fi
}

sleep_between_pulls() {
  if [ "${PULL_DELAY_SECONDS}" -gt 0 ] 2>/dev/null; then
    echo "⏳ Waiting ${PULL_DELAY_SECONDS}s before the next model pull..."
    sleep "${PULL_DELAY_SECONDS}"
  fi
}

pull_models_sequentially() {
  first=1
  for target in $(echo "${MODELS_TO_PULL}" | tr ',' '\n' | sed '/^\s*$/d' | awk '{$1=$1};1'); do
    if [ "$first" -eq 0 ]; then
      sleep_between_pulls
    fi
    pull_model_if_needed "${target}"
    first=0
  done
}

echo "🧠 Model preload set: ${MODELS_TO_PULL}"
if [ "${PREPULL_MODE}" = "background" ]; then
  echo "📦 Starting sequential background preload worker (delay=${PULL_DELAY_SECONDS}s)"
  pull_models_sequentially &
else
  pull_models_sequentially
fi

# ── 4. Hand off to the daemon process ─────────────────────────────────────────
echo "🎯 Ollama ready. Waiting on daemon PID ${OLLAMA_PID}..."
wait "${OLLAMA_PID}"
