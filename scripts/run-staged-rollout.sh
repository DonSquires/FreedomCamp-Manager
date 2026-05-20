#!/usr/bin/env sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="/tmp/fc_rollout_${STAMP}"
mkdir -p "$LOG_DIR"

# Respect user env if set; default to a stable memory cap for Node subprocesses.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

echo "[rollout] Logs: $LOG_DIR"
echo "[rollout] NODE_OPTIONS: $NODE_OPTIONS"

echo "[rollout] Step 1/5: lint"
npm run lint > "$LOG_DIR/1_lint.log" 2>&1

echo "[rollout] Step 2/5: build"
npm run build > "$LOG_DIR/2_build.log" 2>&1

echo "[rollout] Step 3/5: bundle budget"
node scripts/check-bundle-budget.mjs > "$LOG_DIR/3_budget.log" 2>&1

if [ "${USE_BOB_WRAPPER:-0}" = "1" ]; then
  echo "[rollout] Step 4/5: governance regression (Bob-assisted)"
  BOB_TEST_ABORT_ON_UNHEALTHY=false node scripts/run-test-with-bob-assist.mjs -- \
    npx --no-install playwright test tests/e2e/governance-bob-regression.spec.ts --project=chromium \
    > "$LOG_DIR/4_governance.log" 2>&1

  echo "[rollout] Step 5/5: capability overview (Bob-assisted)"
  BOB_TEST_ABORT_ON_UNHEALTHY=false node scripts/run-test-with-bob-assist.mjs -- \
    npx --no-install playwright test tests/e2e/capability-overview.spec.ts --project=chromium \
    > "$LOG_DIR/5_capability.log" 2>&1
else
  echo "[rollout] Step 4/5: governance regression"
  npx --no-install playwright test tests/e2e/governance-bob-regression.spec.ts --project=chromium --reporter=line \
    > "$LOG_DIR/4_governance.log" 2>&1

  echo "[rollout] Step 5/5: capability overview"
  npx --no-install playwright test tests/e2e/capability-overview.spec.ts --project=chromium --reporter=line \
    > "$LOG_DIR/5_capability.log" 2>&1
fi

echo "[rollout] Complete. Summary:"
echo "  lint:       OK"
echo "  build:      OK"
echo "  budget:     OK"
echo "  governance: OK"
echo "  capability: OK"

echo "[rollout] Tail (build):"
tail -n 5 "$LOG_DIR/2_build.log" || true

echo "[rollout] Tail (capability):"
tail -n 5 "$LOG_DIR/5_capability.log" || true

echo "[rollout] Done"
