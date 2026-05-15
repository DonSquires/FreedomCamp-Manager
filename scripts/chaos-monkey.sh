#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MOCK_PORT="${MOCK_RUNPOD_PORT:-8085}"
MOCK_PID=""

cleanup() {
  if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Bob infrastructure resilience checks..."

node "$ROOT_DIR/scripts/mock-runpod-graphql.mjs" &
MOCK_PID="$!"

ATTEMPTS=0
until curl -fsS "http://127.0.0.1:${MOCK_PORT}/test/verify-scaling-assert" >/dev/null 2>&1 || [ "$ATTEMPTS" -ge 20 ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done

QUERY_RESPONSE="$(curl -fsS "http://127.0.0.1:${MOCK_PORT}/graphql" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query GPU_Workers { myself { serverlessEndpoints { id workerCount status } } }"}')"

echo "$QUERY_RESPONSE" | grep -q 'ACTIVE'
echo "PASS RunPod worker query returned ACTIVE status"

curl -fsS "http://127.0.0.1:${MOCK_PORT}/graphql" \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation SaveTemplate($templateId: String!, $minWorkers: Int!) { saveServerlessTemplate(input: { templateId: $templateId, minWorkers: $minWorkers }) { id minWorkers maxWorkers } }","variables":{"templateId":"tpl-ironeagle-v2","minWorkers":5}}' >/dev/null

ASSERT_RESPONSE="$(curl -fsS "http://127.0.0.1:${MOCK_PORT}/test/verify-scaling-assert")"
echo "$ASSERT_RESPONSE" | grep -q '"passed":true'
echo "PASS RunPod autoscale mutation captured by Bob chaos harness"

echo "PASS Bob chaos checks complete"