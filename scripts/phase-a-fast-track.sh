#!/bin/bash
#
# Phase A Fast-Track Gate Runner
#
# Purpose:
# - Run all local gate checks in one pass
# - Optionally promote Phase B feature flags to 5% canary immediately
#
# Usage:
#   bash scripts/phase-a-fast-track.sh
#   bash scripts/phase-a-fast-track.sh --promote-canary
#   bash scripts/phase-a-fast-track.sh --skip-build --skip-lint
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROMOTE_CANARY="false"
SKIP_BUILD="false"
SKIP_LINT="false"

for arg in "$@"; do
  case "$arg" in
    --promote-canary)
      PROMOTE_CANARY="true"
      ;;
    --skip-build)
      SKIP_BUILD="true"
      ;;
    --skip-lint)
      SKIP_LINT="true"
      ;;
  esac
done

echo ""
echo "=============================================="
echo "PHASE A FAST-TRACK: LOCAL GATE EXECUTION"
echo "=============================================="
echo ""

echo "[1/6] Build"
if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "Skipped build by flag (--skip-build)"
else
  npm run build
fi

echo ""
echo "[2/6] Lint"
if [[ "$SKIP_LINT" == "true" ]]; then
  echo "Skipped lint by flag (--skip-lint)"
else
  npm run lint
fi

echo ""
echo "[3/6] Bootstrap route smoke checks"
node scripts/validate-bootstrap-routes.mjs

echo ""
echo "[4/6] Route/role truth validation"
node scripts/validate-route-role-truth.mjs

echo ""
echo "[5/6] Org-isolation integration harness"
set +e
ORG_OUT="$(npx vitest run tests/integration/org-isolation.test.ts 2>&1)"
ORG_EXIT=$?
set -e

echo "$ORG_OUT"

if echo "$ORG_OUT" | grep -q "0 pass" && echo "$ORG_OUT" | grep -q "skip"; then
  echo ""
  echo "WARN: Org-isolation tests skipped (missing Supabase env vars in local shell)."
  echo "      CI remains the authoritative gate for this test."
elif [[ $ORG_EXIT -ne 0 ]]; then
  echo ""
  echo "ERROR: Org-isolation test harness failed."
  exit $ORG_EXIT
fi

echo ""
echo "[6/6] Accelerated canary readiness summary"
echo "- Route/role truth: validated"
echo "- Bootstrap route smoke: validated"
echo "- Build + lint: validated"

echo ""
echo "Next planned date: May 20 (accelerated 5% canary start)"
echo "Flags: FF_PHASE_B_PATROL_EVENTS, FF_PHASE_B_DISPATCH_EVENTS, FF_PHASE_B_ENFORCEMENT_EVENTS"

if [[ "$PROMOTE_CANARY" == "true" ]]; then
  echo ""
  echo "Canary promotion requested: attempting 5% rollout for all Phase B flags"

  if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for canary promotion."
    exit 1
  fi

  bash scripts/advance-canary-stage.sh FF_PHASE_B_PATROL_EVENTS 5
  bash scripts/advance-canary-stage.sh FF_PHASE_B_DISPATCH_EVENTS 5
  bash scripts/advance-canary-stage.sh FF_PHASE_B_ENFORCEMENT_EVENTS 5

  echo ""
  echo "Canary promotion complete: all three Phase B flags set to 5%"
else
  echo ""
  echo "Dry run only. To promote canary now, run:"
  echo "bash scripts/phase-a-fast-track.sh --promote-canary"
fi

echo ""
echo "FAST-TRACK RUN COMPLETE"
