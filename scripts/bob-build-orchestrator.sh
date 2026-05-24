#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_BOOTSTRAP=0

for arg in "$@"; do
  case "$arg" in
    --skip-bootstrap)
      SKIP_BOOTSTRAP=1
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: bash scripts/bob-build-orchestrator.sh [--skip-bootstrap]"
      exit 2
      ;;
  esac
done

declare -a PASSED_GATES=()
declare -a FAILED_GATES=()

run_gate() {
  local gate_name="$1"
  shift

  echo
  echo "=== ${gate_name} ==="
  echo "+ $*"

  if "$@"; then
    PASSED_GATES+=("$gate_name")
    echo "PASS: ${gate_name}"
  else
    local exit_code=$?
    FAILED_GATES+=("${gate_name} (exit ${exit_code})")
    echo "FAIL: ${gate_name} (exit ${exit_code})"
    print_summary
    exit "$exit_code"
  fi
}

print_summary() {
  echo
  echo "=============================="
  echo "Build status summary"
  echo "=============================="

  if [[ ${#PASSED_GATES[@]} -eq 0 ]]; then
    echo "PASS: none"
  else
    for gate in "${PASSED_GATES[@]}"; do
      echo "PASS: ${gate}"
    done
  fi

  if [[ ${#FAILED_GATES[@]} -eq 0 ]]; then
    echo "FAIL: none"
  else
    for gate in "${FAILED_GATES[@]}"; do
      echo "FAIL: ${gate}"
    done
  fi

  echo
  if [[ ${#FAILED_GATES[@]} -eq 0 ]]; then
    echo "Next action: proceed to targeted Playwright diagnosis for any remaining runtime assertions."
  else
    echo "Next action: fix the first failed gate above, then rerun this orchestrator."
  fi
}

echo "Bob build orchestrator starting in $ROOT_DIR"
echo "Execution mode: app/Bob-driven only (no GitHub Actions dependency)."

REQUIRED_ENV=(
  "VITE_SUPABASE_URL"
  "VITE_SUPABASE_ANON_KEY"
)

echo
echo "=== Environment preflight ==="
for key in "${REQUIRED_ENV[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: ${key}"
    echo "Set required env vars before running orchestration."
    exit 3
  fi
done
echo "PASS: environment preflight"

run_gate "Truth sync: system check" node scripts/system-check.mjs
run_gate "Truth sync: broadcast protocol" node scripts/broadcast-truth-protocol.mjs
run_gate "Core build" npm run build
run_gate "Route contract" node scripts/check-route-contract-artifact.mjs
run_gate "Route/role truth" node scripts/validate-route-role-truth.mjs

if [[ "$SKIP_BOOTSTRAP" -eq 0 ]]; then
  run_gate "Manual chain bootstrap" node scripts/bootstrap-manual-chain.mjs
else
  echo
  echo "SKIP: Manual chain bootstrap (--skip-bootstrap provided)"
fi

run_gate "Final build recheck" npm run build
run_gate "Final route contract recheck" node scripts/check-route-contract-artifact.mjs

print_summary
echo "Orchestration completed successfully."
