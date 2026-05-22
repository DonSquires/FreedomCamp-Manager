#!/usr/bin/env bash
set -euo pipefail

# Pod-focused Bob supervisor launcher.
# Uses pod-mode smoke checks against inference-service /health and optionally
# runs periodic pod-native self-tests.

cd /workspaces/FreedomCamp-Manager

export PATH="$HOME/.local/bin:$PATH"

if [[ -f ./.runtime/bob.env ]]; then
  set -a
  source ./.runtime/bob.env
  set +a
fi

if [[ -f ./.env ]]; then
  set -a
  source ./.env
  set +a
fi

# Defaults for Pod mode
export BOB_SUPERVISOR_MODE="${BOB_SUPERVISOR_MODE:-pod}"
export INFERENCE_SERVICE_URL="${INFERENCE_SERVICE_URL:-http://127.0.0.1:3000}"
export BOB_SUPERVISOR_ACTIVITY_FILE="${BOB_SUPERVISOR_ACTIVITY_FILE:-.runtime/runpod-bob-activity.touch}"
export BOB_SUPERVISOR_STATE_FILE="${BOB_SUPERVISOR_STATE_FILE:-.runtime/runpod-bob-supervisor-state.json}"
export BOB_SUPERVISOR_INTERVAL_MS="${BOB_SUPERVISOR_INTERVAL_MS:-60000}"
export BOB_SUPERVISOR_FAILURE_THRESHOLD="${BOB_SUPERVISOR_FAILURE_THRESHOLD:-3}"
export BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS="${BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS:-1800000}"
export BOB_SUPERVISOR_SELF_TEST_INTERVAL_MS="${BOB_SUPERVISOR_SELF_TEST_INTERVAL_MS:-900000}"

if [[ -z "${BOB_SUPERVISOR_SELF_TEST_CMD:-}" ]]; then
  export BOB_SUPERVISOR_SELF_TEST_CMD="node scripts/trigger-bob-pod-self-test.mjs --skipExecutor=false"
fi

mkdir -p .runtime

echo "Starting Bob Pod supervisor"
echo "- mode: ${BOB_SUPERVISOR_MODE}"
echo "- inference url: ${INFERENCE_SERVICE_URL}"
echo "- interval: ${BOB_SUPERVISOR_INTERVAL_MS}ms"
echo "- failure threshold: ${BOB_SUPERVISOR_FAILURE_THRESHOLD}"
echo "- self-test command: ${BOB_SUPERVISOR_SELF_TEST_CMD}"
echo "- self-test interval: ${BOB_SUPERVISOR_SELF_TEST_INTERVAL_MS}ms"

exec node scripts/runpod-bob-supervisor.mjs "$@"
