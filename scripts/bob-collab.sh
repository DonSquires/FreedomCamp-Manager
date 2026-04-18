#!/usr/bin/env bash
set -euo pipefail

# Copilot <-> Bob collaboration helper.
# Modes:
#   ask      - Ask Bob a direct question via /chat
#   plan     - Ask Bob for analysis + implementation plan
#   research - Ask Bob for a web-research brief + implementation mapping
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
  bun run bob:collab -- research "topic or task statement"
  bun run bob:collab -- queue "build task" "file1,file2" [priority]
  bun run bob:collab -- hybrid "task" "file1,file2" [priority]
  bun run bob:collab -- queue-run "build task" "file1,file2" [priority]
  bun run bob:collab -- hybrid-run "task" "file1,file2" [priority]

Examples:
  bun run bob:collab -- ask "What are top risks in AdminPortal state flow?"
  bun run bob:collab -- plan "Design a staged fix plan for PTT auth drift"
  bun run bob:collab -- research "Find current NZ procurement guidance for council tenders and map to tender response sections"
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

feed_context_if_available() {
  if [[ "${BOB_SKIP_FEED_CONTEXT:-false}" == "true" ]]; then
    return 0
  fi

  if [[ ! -f "scripts/bob-feed-build-context.mjs" ]]; then
    return 0
  fi

  local focus="general"
  if echo "$INPUT" | grep -qi 'tender'; then
    focus="tender-e2e"
  fi

  echo "=== Feeding Bob build context ==="
  if ! node scripts/bob-feed-build-context.mjs --focus "$focus" --note "$INPUT"; then
    echo "⚠️  Bob context feed failed; continuing with requested action." >&2
  fi
}

case "$MODE" in
  ask)
    call_chat "$INPUT"
    ;;

  plan)
    call_chat "You are Doctor Bob working with external Copilot. Analyze this task and return: 1) risks 2) root cause hypotheses 3) recommended split (Bob-do vs Copilot-do) 4) staged plan 5) verification checklist. Task: $INPUT"
    ;;

  research)
    call_chat "You are Doctor Bob working with external Copilot. Build a web research brief for this objective. Return: 1) objective clarification 2) 8-12 high-value search queries 3) authoritative source targets in priority order 4) currentness checks (date/version) 5) conflict-resolution rules when sources disagree 6) evidence table format Bob/Copilot should fill 7) implementation mapping to repo files/tests. IMPORTANT: do not invent URLs, laws, or documents; if uncertain, say unknown and provide a search query instead. Use only verifiable source names and include a confidence rating per source. Objective: $INPUT"
    ;;

  queue)
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    ;;

  queue-run)
    feed_context_if_available
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
    feed_context_if_available
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
