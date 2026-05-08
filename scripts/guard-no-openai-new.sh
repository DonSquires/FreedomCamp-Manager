#!/usr/bin/env sh
set -eu

BASE_REF="${GITHUB_BASE_REF:-main}"

if git rev-parse --verify "origin/${BASE_REF}" >/dev/null 2>&1; then
  RANGE="origin/${BASE_REF}...HEAD"
else
  RANGE="HEAD~1...HEAD"
fi

PATTERN="@openai|from 'openai'|from \"openai\"|require\\('openai'\\)|\"openai\"[[:space:]]*:|OPENAI_API_KEY|OPENAI_BASE_URL"

# Bob policy: OpenAI is permitted only for research/training flows.
# Runtime OpenAI references are allowed only in the Bob worker policy surface.
ALLOWED_OPENAI_PATH_REGEX='^(docs/|scripts/|knowledge_base/|inference-service/scripts/|inference-service/training/|tests/|runpod-worker/(handler\.py|Dockerfile)$)'

# NZ privacy compliance evidence must be updated when introducing new OpenAI usage.
REQUIRED_PRIVACY_DOC='docs/LEGAL_BASIS_REFERENCE.md'

TMP_FILE="$(mktemp)"
OPENAI_HITS_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE" "$OPENAI_HITS_FILE"' EXIT

# Inspect added lines in the full diff and attribute each hit to a file path.
git diff --unified=0 --no-color "$RANGE" > "$TMP_FILE"

awk -v pat="$PATTERN" '
  /^\+\+\+ b\// {
    current_file = substr($0, 7)
    next
  }
  /^\+[^+]/ {
    if (current_file != "" && $0 ~ pat) {
      printf "%s\t%s\n", current_file, $0
    }
  }
' "$TMP_FILE" > "$OPENAI_HITS_FILE"

if [ ! -s "$OPENAI_HITS_FILE" ]; then
  echo "Policy check passed: no new OpenAI references in this diff."
  exit 0
fi

echo "Detected new OpenAI references:"
cat "$OPENAI_HITS_FILE"

violations=0
while IFS=$(printf '\t') read -r file_path hit_line; do
  if ! printf '%s' "$file_path" | grep -Eq "$ALLOWED_OPENAI_PATH_REGEX"; then
    echo "Policy violation: OpenAI reference in non-research/non-training path: $file_path"
    violations=1
  fi
done < "$OPENAI_HITS_FILE"

if [ "$violations" -ne 0 ]; then
  echo "Policy violation: OpenAI usage is only allowed for Bob research/training paths."
  exit 1
fi

# Ensure legal/privacy basis is updated whenever new OpenAI references are introduced.
if ! git diff --name-only "$RANGE" | grep -qx "$REQUIRED_PRIVACY_DOC"; then
  echo "Policy violation: NZ privacy compliance evidence missing."
  echo "Required update: $REQUIRED_PRIVACY_DOC"
  exit 1
fi

echo "Policy check passed: OpenAI references are limited to research/training paths and NZ privacy doc update is present."
