#!/usr/bin/env bash
set -euo pipefail

set -a
[[ -f .env ]] && source .env || true
[[ -f .env.local ]] && source .env.local || true
[[ -f .env.playwright.local ]] && source .env.playwright.local || true
[[ -f .runtime/bob.env ]] && source .runtime/bob.env || true
set +a

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage:
  bash scripts/ptt-team-train-loop.sh "<objective>" [artifact-file]

Examples:
  bash scripts/ptt-team-train-loop.sh "Harden PTT reconnect and secure transport" docs/PTT_ENTERPRISE_STACK_FIT_AND_BUILD.md
USAGE
  exit 0
fi

if [[ $# -lt 1 ]]; then
  cat <<'USAGE'
Usage:
  bash scripts/ptt-team-train-loop.sh "<objective>" [artifact-file]

Examples:
  bash scripts/ptt-team-train-loop.sh "Harden PTT reconnect and secure transport" docs/PTT_ENTERPRISE_STACK_FIT_AND_BUILD.md
USAGE
  exit 1
fi

OBJECTIVE="$1"
ARTIFACT_FILE="${2:-docs/PTT_ENTERPRISE_STACK_FIT_AND_BUILD.md}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="tools/ptt-team-training/${STAMP}"
mkdir -p "$RUN_DIR"

printf '%s\n' "$OBJECTIVE" > "$RUN_DIR/objective.txt"
printf '%s\n' "$ARTIFACT_FILE" > "$RUN_DIR/artifact.txt"

echo "[1/4] Bob plan generation"
if npm run -s bob:collab -- plan "$OBJECTIVE" > "$RUN_DIR/bob-plan.txt" 2>&1; then
  echo "Bob plan complete: $RUN_DIR/bob-plan.txt"
else
  echo "Bob plan failed; see: $RUN_DIR/bob-plan.txt"
fi

echo "[2/4] Dr Bob adversarial review"
if node scripts/dr-bob-review.mjs --file "$ARTIFACT_FILE" > "$RUN_DIR/dr-bob-review.txt" 2>&1; then
  echo "Dr Bob review complete: $RUN_DIR/dr-bob-review.txt"
else
  echo "Dr Bob review reported blockers; see: $RUN_DIR/dr-bob-review.txt"
fi

echo "[3/4] Human Test engine run"
if node scripts/human-test-engine.mjs --skip-ui true --skip-multimodal true --out "$RUN_DIR/human-test" > "$RUN_DIR/human-test.log" 2>&1; then
  echo "Human Test run complete: $RUN_DIR/human-test.log"
else
  echo "Human Test found issues or infra blockers; see: $RUN_DIR/human-test.log"
fi

echo "[4/4] Create correction protocol scaffold"
cat > "$RUN_DIR/correction-protocol.md" <<'EOF'
# PTT Team Correction Protocol

Use this file to retrain Bob, Dr Bob, and Human Test after each run.

## Rule

If any team member is wrong, log the mistake and the corrected approach before the next implementation pass.

## Correction Entries

### Entry Template

1. Agent: Bob | Dr Bob | Human Test
2. Wrong Output:
3. Root Cause:
4. Correct Method:
5. Repo Evidence:
6. Guardrail Added:
7. Verification Step:

### Checklist

1. Convert each blocker into a concrete code or config task.
2. Add a test or diagnostic that would catch the same mistake next time.
3. Update architecture docs if a pattern changed.
4. Re-run Dr Bob and Human Test after fixes.
EOF

echo "Training loop artifact bundle created: $RUN_DIR"
