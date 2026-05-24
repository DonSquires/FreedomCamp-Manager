#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_ROOT"

SELF_HEAL_RERUN_FAILED="${BOB_SELF_HEAL_RERUN_FAILED:-true}"
ENABLE_AUTO_REMEDIATION="${BOB_ENABLE_AUTO_REMEDIATION:-false}"

echo "[bob-autonomous] Starting autonomous self-heal cycle in $REPO_ROOT"

echo "[bob-autonomous] Stage: truth sync"
bash scripts/system-check.sh

echo "[bob-autonomous] Stage: runtime monitor"
bash scripts/monitor-bob.sh

echo "[bob-autonomous] Stage: ci self-heal watchdog"
if [[ "$SELF_HEAL_RERUN_FAILED" == "true" ]]; then
  node scripts/run-ci-self-heal-cycle.mjs --rerun-failed=true
else
  node scripts/run-ci-self-heal-cycle.mjs
fi

if [[ "$ENABLE_AUTO_REMEDIATION" == "true" ]]; then
  echo "[bob-autonomous] Stage: auto remediation"
  node scripts/auto-remediation-cycle.mjs
fi

echo "[bob-autonomous] Stage: summarize failures"
node scripts/summarize-failures.mjs

echo "[bob-autonomous] Stage: ingest"
node scripts/auto-ingest.mjs

if [[ "${BOB_REVIEW_ARTIFACTS:-false}" == "true" ]]; then
  if [[ -f "spec.md" || -f "plan.md" ]]; then
    echo "[bob-autonomous] Running artifact review gate"
    node scripts/review-architecture-artifacts.mjs
  else
    echo "[bob-autonomous] Artifact review skipped (no spec.md or plan.md present)"
  fi
fi

echo "[bob-autonomous] Autonomous self-heal cycle completed"