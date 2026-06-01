#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MASTER_EMAIL="don.squires@firstsecurity.co.nz"
GRANDMASTER_EMAIL="squires.don@live.com"
PASSWORD="${PLAYWRIGHT_TWO_LOGIN_PASSWORD:-${TWO_LOGIN_PASSWORD:-}}"
BASE_URL="${PLAYWRIGHT_BASE_URL:-https://fcmanager.co.nz}"

if [[ -z "$PASSWORD" ]]; then
  echo "[two-login-visual] missing password: set PLAYWRIGHT_TWO_LOGIN_PASSWORD or TWO_LOGIN_PASSWORD" >&2
  exit 2
fi

echo "[two-login-visual] running visual + data-population probe against $BASE_URL"
PLAYWRIGHT_BASE_URL="$BASE_URL" \
PLAYWRIGHT_MASTER_EMAIL="$MASTER_EMAIL" \
PLAYWRIGHT_MASTER_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_PASSWORD="$PASSWORD" \
PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL="$GRANDMASTER_EMAIL" \
PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD="$PASSWORD" \
PLAYWRIGHT_HARDWIRE_AUTOMATION_CREDENTIALS=0 \
BOB_USER_REQUEST_MODE=1 \
bash scripts/playwright-codespace-credentials.sh \
  npx playwright test tests/e2e/two-login-data-population.spec.ts --project=chromium --workers=1 --reporter=line

echo "[two-login-visual] complete"
echo "[two-login-visual] artifacts: artifacts/data-population/*.json and *.png"
