#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SPEC_PATH="${1:-tests/e2e/bob-human-emulator.spec.ts}"
PLAYWRIGHT_PROJECT="${PLAYWRIGHT_PROJECT:-chromium-bob}"
DR_RETRY_COUNT="${DR_BOB_RETRY_COUNT:-3}"
DR_MAX_ATTEMPTS="${DR_BOB_MAX_ATTEMPTS:-5}"
DR_RETRY_DELAY_SECONDS="${DR_BOB_RETRY_DELAY_SECONDS:-8}"

printf '[bob-dr] Running Bob Playwright suite (%s, project=%s)\n' "$SPEC_PATH" "$PLAYWRIGHT_PROJECT"
bash scripts/playwright-bob-runtime.sh npx playwright test "$SPEC_PATH" --project="$PLAYWRIGHT_PROJECT" --reporter=line

printf '[bob-dr] Playwright passed; starting Dr Bob review retries (retries=%s, max-attempts=%s)\n' "$DR_RETRY_COUNT" "$DR_MAX_ATTEMPTS"

attempt=1
while [[ "$attempt" -le "$DR_RETRY_COUNT" ]]; do
  printf '[bob-dr] Dr Bob attempt %s/%s\n' "$attempt" "$DR_RETRY_COUNT"

  if node scripts/dr-bob-review.mjs \
    --file "$SPEC_PATH" \
    --type spec \
    --reviewer dr-bob-human-emulator \
    --strict-json true \
    --fail-on-unstructured true \
    --max-attempts "$DR_MAX_ATTEMPTS"; then
    printf '[bob-dr] Dr Bob review completed successfully on attempt %s\n' "$attempt"
    exit 0
  fi

  if [[ "$attempt" -lt "$DR_RETRY_COUNT" ]]; then
    printf '[bob-dr] Dr Bob review returned non-actionable output; retrying in %ss\n' "$DR_RETRY_DELAY_SECONDS"
    sleep "$DR_RETRY_DELAY_SECONDS"
  fi

  attempt=$((attempt + 1))
done

printf '[bob-dr] Dr Bob review did not complete successfully after %s attempts\n' "$DR_RETRY_COUNT"
exit 1
