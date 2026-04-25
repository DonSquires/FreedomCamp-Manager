#!/usr/bin/env sh
set -eu

BASE_REF="${GITHUB_BASE_REF:-main}"

if git rev-parse --verify "origin/${BASE_REF}" >/dev/null 2>&1; then
  RANGE="origin/${BASE_REF}...HEAD"
else
  RANGE="HEAD~1...HEAD"
fi

PATTERN="openai|@openai|from 'openai'|from \"openai\"|require\\('openai'\\)|OPENAI_API_KEY"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

# Inspect only added lines in code/workflow/config paths and ignore docs/data markdown churn.
git diff --unified=0 --no-color "$RANGE" -- \
  . \
  ':(exclude)docs/**' \
  ':(exclude)data/**' \
  ':(exclude)**/*.md' \
  ':(exclude)shared/api/**' \
  ':(exclude)scripts/guard-no-openai-new.sh' \
  > "$TMP_FILE"

if grep -E "^\+[^+]" "$TMP_FILE" | grep -Ein "$PATTERN" >/dev/null 2>&1; then
  echo "Policy violation: New OpenAI references were introduced in this diff."
  echo "Detected lines:"
  grep -E "^\+[^+]" "$TMP_FILE" | grep -Ein "$PATTERN" || true
  exit 1
fi

echo "Policy check passed: no new OpenAI references in this diff."
