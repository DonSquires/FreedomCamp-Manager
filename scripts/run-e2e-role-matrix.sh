#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

profiles=(
  master
  admin_org1
  admin_org2
  officer_org1
  client_viewer
  client_staff
  bob_admin_officer
  bob_grand_master
)

# Optional explicit test target; defaults to role smoke suite.
test_target=("${@:-tests/e2e/role-matrix-smoke.spec.ts}")
failed=()

for profile in "${profiles[@]}"; do
  echo
  echo "===== ROLE PROFILE: $profile ====="
  if ! TEST_LOGIN_PROFILE="$profile" \
    BOB_USER_REQUEST_MODE=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-/usr/bin/chromium}" \
    bash scripts/playwright-codespace-credentials.sh \
      node scripts/validate-e2e-persona-roles.mjs --slot "$profile"; then
    failed+=("preflight:$profile")
    continue
  fi

  if ! TEST_LOGIN_PROFILE="$profile" \
    BOB_USER_REQUEST_MODE=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-/usr/bin/chromium}" \
    bash scripts/playwright-codespace-credentials.sh \
      npx playwright test "${test_target[@]}" --project=chromium --workers=1 --reporter=line; then
    failed+=("test:$profile")
  fi
done

echo
echo "===== ROLE MATRIX SUMMARY ====="
if [[ ${#failed[@]} -eq 0 ]]; then
  echo "ALL_ROLE_PROFILES_PASSED"
  exit 0
fi

echo "FAILED_ENTRIES: ${failed[*]}"
exit 1
