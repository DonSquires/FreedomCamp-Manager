#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_ROOT"

echo "[bob-autonomous] Starting autonomous learning cycle in $REPO_ROOT"

bash scripts/system-check.sh
bash scripts/monitor-bob.sh
node scripts/summarize-failures.mjs
node scripts/auto-ingest.mjs

if [[ "${BOB_REVIEW_ARTIFACTS:-false}" == "true" ]]; then
  if [[ -f "spec.md" || -f "plan.md" ]]; then
    echo "[bob-autonomous] Running artifact review gate"
    node scripts/review-architecture-artifacts.mjs
  else
    echo "[bob-autonomous] Artifact review skipped (no spec.md or plan.md present)"
  fi
fi

echo "[bob-autonomous] Autonomous learning cycle completed"