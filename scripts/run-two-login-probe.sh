#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MASTER_EMAIL="don.squires@firstsecurity.co.nz"
GRANDMASTER_EMAIL="squires.don@live.com"
PASSWORD="${PLAYWRIGHT_TWO_LOGIN_PASSWORD:-${TWO_LOGIN_PASSWORD:-}}"
BASE_URL="${PLAYWRIGHT_BASE_URL:-https://fcmanager.co.nz}"

if [[ -z "$PASSWORD" ]]; then
  echo "[two-login-probe] missing password: set PLAYWRIGHT_TWO_LOGIN_PASSWORD or TWO_LOGIN_PASSWORD" >&2
  exit 2
fi

echo "[two-login-probe] validating persona slots for master + bob_grand_master"
PLAYWRIGHT_MASTER_EMAIL="$MASTER_EMAIL" \
PLAYWRIGHT_MASTER_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD="$PASSWORD" \
BOB_USER_REQUEST_MODE=1 \
bash scripts/playwright-codespace-credentials.sh node scripts/validate-e2e-persona-roles.mjs --slot master

PLAYWRIGHT_MASTER_EMAIL="$MASTER_EMAIL" \
PLAYWRIGHT_MASTER_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD="$PASSWORD" \
BOB_USER_REQUEST_MODE=1 \
bash scripts/playwright-codespace-credentials.sh node scripts/validate-e2e-persona-roles.mjs --slot bob_grand_master

echo "[two-login-probe] running landing data probe against $BASE_URL"
PLAYWRIGHT_BASE_URL="$BASE_URL" \
PLAYWRIGHT_MASTER_EMAIL="$MASTER_EMAIL" \
PLAYWRIGHT_MASTER_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD="$PASSWORD" \
BOB_USER_REQUEST_MODE=1 \
bash scripts/playwright-codespace-credentials.sh \
  npx playwright test tests/e2e/_landing_blocker_probe.spec.ts --project=chromium --workers=1 --reporter=line

echo "[two-login-probe] complete"
echo "[two-login-probe] artifact: artifacts/landing-shots/landing-blocker-probe.json"
