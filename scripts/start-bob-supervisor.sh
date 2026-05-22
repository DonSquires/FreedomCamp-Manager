#!/usr/bin/env bash
set -euo pipefail

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

export BOB_SUPERVISOR_ACTIVITY_FILE="${BOB_SUPERVISOR_ACTIVITY_FILE:-.runtime/runpod-bob-activity.touch}"
export BOB_SUPERVISOR_STATE_FILE="${BOB_SUPERVISOR_STATE_FILE:-.runtime/runpod-bob-supervisor-state.json}"
export BOB_SUPERVISOR_INTERVAL_MS="${BOB_SUPERVISOR_INTERVAL_MS:-60000}"
export BOB_SUPERVISOR_FAILURE_THRESHOLD="${BOB_SUPERVISOR_FAILURE_THRESHOLD:-3}"
export BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS="${BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS:-1800000}"

mkdir -p .runtime

echo "Starting Bob supervisor"
echo "- endpoint: ${INFERENCE_SERVICE_URL:-<missing>}"
echo "- interval: ${BOB_SUPERVISOR_INTERVAL_MS}ms"
echo "- failure threshold: ${BOB_SUPERVISOR_FAILURE_THRESHOLD}"
echo "- activity file: ${BOB_SUPERVISOR_ACTIVITY_FILE}"
echo "- state file: ${BOB_SUPERVISOR_STATE_FILE}"

exec node scripts/runpod-bob-supervisor.mjs "$@"