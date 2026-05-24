#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_ROOT"

SELF_HEAL_RERUN_FAILED="${BOB_SELF_HEAL_RERUN_FAILED:-true}"
ENABLE_AUTO_REMEDIATION="${BOB_ENABLE_AUTO_REMEDIATION:-false}"
ENABLE_BUG_CLOSEOUT="${BOB_ENABLE_BUG_CLOSEOUT:-true}"
BUG_CLOSEOUT_RETENTION_HOURS="${BOB_BUG_CLOSEOUT_RETENTION_HOURS:-24}"

update_bug_stage() {
  local stage="$1"
  local status="$2"
  local note="$3"

  if [[ "$ENABLE_BUG_CLOSEOUT" != "true" ]]; then
    return 0
  fi

  node scripts/bob-bug-closeout.mjs --mode stage --stage "$stage" --status "$status" --note "$note" || true
}

closeout_after_remediation() {
  if [[ "$ENABLE_BUG_CLOSEOUT" != "true" ]]; then
    return 0
  fi

  node scripts/bob-bug-closeout.mjs --mode closeout --note "Resolved by successful autonomous remediation cycle" || true
}

retention_cleanup() {
  if [[ "$ENABLE_BUG_CLOSEOUT" != "true" ]]; then
    return 0
  fi

  node scripts/bob-bug-closeout.mjs --mode retention --hours "$BUG_CLOSEOUT_RETENTION_HOURS" || true
}

echo "[bob-autonomous] Starting autonomous self-heal cycle in $REPO_ROOT"

echo "[bob-autonomous] Stage: truth sync"
bash scripts/system-check.sh
update_bug_stage "truth-sync" "acknowledged" "Truth sync completed"

echo "[bob-autonomous] Stage: runtime monitor"
bash scripts/monitor-bob.sh
update_bug_stage "runtime-monitor" "investigating" "Runtime monitor completed"

echo "[bob-autonomous] Stage: ci self-heal watchdog"
if [[ "$SELF_HEAL_RERUN_FAILED" == "true" ]]; then
  node scripts/run-ci-self-heal-cycle.mjs --rerun-failed=true
else
  node scripts/run-ci-self-heal-cycle.mjs
fi
update_bug_stage "ci-self-heal-watchdog" "in_progress" "CI self-heal watchdog completed"

if [[ "$ENABLE_AUTO_REMEDIATION" == "true" ]]; then
  echo "[bob-autonomous] Stage: auto remediation"
  node scripts/auto-remediation-cycle.mjs
  closeout_after_remediation
fi

echo "[bob-autonomous] Stage: summarize failures"
node scripts/summarize-failures.mjs
update_bug_stage "summarize-failures" "in_progress" "Failure summary completed"

echo "[bob-autonomous] Stage: ingest"
node scripts/auto-ingest.mjs
update_bug_stage "ingest" "in_progress" "Ingest stage completed"

retention_cleanup

if [[ "${BOB_REVIEW_ARTIFACTS:-false}" == "true" ]]; then
  if [[ -f "spec.md" || -f "plan.md" ]]; then
    echo "[bob-autonomous] Running artifact review gate"
    node scripts/review-architecture-artifacts.mjs
  else
    echo "[bob-autonomous] Artifact review skipped (no spec.md or plan.md present)"
  fi
fi

echo "[bob-autonomous] Autonomous self-heal cycle completed"