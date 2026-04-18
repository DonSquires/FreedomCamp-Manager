#!/usr/bin/env bash
set -euo pipefail

# Copilot <-> Bob collaboration helper.
# Modes:
#   ask      - Ask Bob a direct question via /chat
#   plan     - Ask Bob for analysis + implementation plan
#   queue    - Queue a coding task for Bob via /code/task
#   hybrid   - Ask Bob for plan, then queue task in one command
#   queue-run  - Queue a coding task, then trigger ops-bob-code-task workflow
#   hybrid-run - Ask Bob for plan, queue task, then trigger workflow
#
# Required env vars:
#   BOB_SERVICE_URL (or INFERENCE_SERVICE_URL)
#   BOB_INFERENCE_API_KEY (or INFERENCE_API_KEY)

MODE="${1:-}"
INPUT="${2:-}"
TARGET_FILES_RAW="${3:-}"
PRIORITY="${4:-high}"

# Allow queue/hybrid usage without target files, e.g.
#   bob-collab.sh queue "task" high
if [[ "$MODE" == "queue" || "$MODE" == "hybrid" || "$MODE" == "queue-run" || "$MODE" == "hybrid-run" ]]; then
  if [[ -z "${4:-}" && ( "$TARGET_FILES_RAW" == "high" || "$TARGET_FILES_RAW" == "normal" ) ]]; then
    PRIORITY="$TARGET_FILES_RAW"
    TARGET_FILES_RAW=""
  fi
fi

BASE_URL="${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}"
API_KEY="${BOB_INFERENCE_API_KEY:-${INFERENCE_API_KEY:-}}"

if [[ -z "$MODE" || -z "$INPUT" ]]; then
  cat <<'USAGE'
Usage:
  bun run bob:collab -- ask "question"
  bun run bob:collab -- plan "task or problem statement"
  bun run bob:collab -- queue "build task" "file1,file2" [priority]
  bun run bob:collab -- hybrid "task" "file1,file2" [priority]
  bun run bob:collab -- queue-run "build task" "file1,file2" [priority]
  bun run bob:collab -- hybrid-run "task" "file1,file2" [priority]

Examples:
  bun run bob:collab -- ask "What are top risks in AdminPortal state flow?"
  bun run bob:collab -- plan "Design a staged fix plan for PTT auth drift"
  bun run bob:collab -- queue "Fix accessibility issues in AdminHub" "src/pages/AdminHub.tsx" high
  bun run bob:collab -- hybrid "Review and improve officer assignment UX" "src/pages/AdminPortal.tsx,src/pages/AdminHub.tsx" high
  bun run bob:collab -- queue-run "Fix tender e2e validation flow" "src/pages/TenderWorkspaceDetail.tsx" high
USAGE
  exit 1
fi

if [[ -z "$BASE_URL" || -z "$API_KEY" ]]; then
  echo "Missing Bob connection env vars. Set either:"
  echo "  BOB_SERVICE_URL + BOB_INFERENCE_API_KEY"
  echo "or"
  echo "  INFERENCE_SERVICE_URL + INFERENCE_API_KEY"
  exit 1
fi

BASE_URL="${BASE_URL%/}"
if [[ "$BASE_URL" != http://* && "$BASE_URL" != https://* ]]; then
  BASE_URL="https://$BASE_URL"
fi

json_escape() {
  jq -Rs . <<<"$1"
}

to_json_file_array() {
  local csv="$1"
  if [[ -z "$csv" ]]; then
    echo '[]'
    return
  fi

  # Trim whitespace around comma-separated values and drop empties.
  awk -v RS=',' '{ gsub(/^[ \t\n\r]+|[ \t\n\r]+$/, "", $0); if (length($0) > 0) print $0 }' <<<"$csv" \
    | jq -R . \
    | jq -s .
}

call_chat() {
  local message="$1"
  curl -sS --max-time 120 \
    -X POST "$BASE_URL/chat" \
    -H 'Content-Type: application/json' \
    -H "x-inference-api-key: $API_KEY" \
    -d "{\"message\":$(json_escape "$message")}" \
    | jq -r '.text // .message // .error // "(no response text)"'
}

queue_code_task() {
  local task="$1"
  local files_csv="$2"
  local priority="$3"
  local files_json
  files_json="$(to_json_file_array "$files_csv")"

  local payload
  payload=$(jq -n \
    --arg task "$task" \
    --arg priority "$priority" \
    --argjson target_files "$files_json" \
    --arg requested_by "copilot-bob-collab" \
    '{task: $task, priority: (if $priority == "high" then "high" else "normal" end), target_files: $target_files, requested_by: $requested_by}')

  curl -sS --max-time 60 \
    -X POST "$BASE_URL/code/task" \
    -H 'Content-Type: application/json' \
    -H "x-inference-api-key: $API_KEY" \
    -d "$payload" \
    | jq
}

trigger_bob_code_task_workflow() {
  local limit="${1:-1}"

  if ! command -v gh >/dev/null 2>&1; then
    echo "⚠️  GitHub CLI (gh) is not installed; task is queued but workflow was not triggered." >&2
    return 0
  fi

  if ! gh auth status >/dev/null 2>&1 && [[ -z "${GH_TOKEN:-}" ]]; then
    echo "⚠️  gh is not authenticated and GH_TOKEN is not set; task is queued but workflow was not triggered." >&2
    return 0
  fi

  gh workflow run ops-bob-code-task.yml -f limit="$limit" >/dev/null

  echo "=== Triggered ops-bob-code-task workflow ==="
  gh run list --workflow ops-bob-code-task.yml --limit 1 --json databaseId,status,conclusion,createdAt | jq
}

case "$MODE" in
  ask)
    call_chat "$INPUT"
    ;;

  plan)
    call_chat "You are Doctor Bob working with external Copilot. Analyze this task and return: 1) risks 2) root cause hypotheses 3) recommended split (Bob-do vs Copilot-do) 4) staged plan 5) verification checklist. Task: $INPUT"
    ;;

  queue)
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    ;;

  queue-run)
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    echo
    trigger_bob_code_task_workflow 1
    ;;

  hybrid)
    echo "=== Doctor Bob analysis ==="
    call_chat "You are Doctor Bob working with external Copilot. Provide a concise engineering plan for this task, then include a one-line suggested code-task objective suitable for /code/task queueing. Task: $INPUT"
    echo
    echo "=== Queueing Bob code task ==="
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    ;;

  hybrid-run)
    echo "=== Doctor Bob analysis ==="
    call_chat "You are Doctor Bob working with external Copilot. Provide a concise engineering plan for this task, then include a one-line suggested code-task objective suitable for /code/task queueing. Task: $INPUT"
    echo
    echo "=== Queueing Bob code task ==="
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    echo
    trigger_bob_code_task_workflow 1
    ;;

  *)
    echo "Unknown mode: $MODE"
    exit 1
    ;;
esac
