#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      if [[ -n "${!key:-}" ]]; then
        continue
      fi
      # Strip optional surrounding quotes to mirror common .env parsing.
      if [[ "$val" =~ ^\".*\"$ ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:${#val}-2}"
      fi
      export "$key=$val"
    fi
  done < "$file"
}

load_env_file .env
load_env_file .env.local
load_env_file .env.playwright.local
load_env_file .runtime/bob.env

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

BASE_URL="${INFERENCE_SERVICE_URL:-${BOB_SERVICE_URL:-}}"
API_KEY="${INFERENCE_API_KEY:-${BOB_INFERENCE_API_KEY:-}}"

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
  local system_prompt="You are Bob, a practical engineering assistant for FieldOps Manager. Return concise, concrete, testable guidance for the exact task."
  local request_timeout="${BOB_COLLAB_TIMEOUT_SEC:-300}"
  curl -sS --max-time "$request_timeout" \
    -X POST "$BASE_URL/chat" \
    -H 'Content-Type: application/json' \
    -H "x-inference-api-key: $API_KEY" \
    -d "{\"message\":$(json_escape "$message"),\"system_prompt\":$(json_escape "$system_prompt")}" \
    | jq -r '.text // .message // .error // "(no response text)"'
}

copilot_restrictions() {
  cat <<'RULES'
Operating restrictions (Copilot-inspired):
- Never fabricate facts, URLs, legal references, or implementation status.
- If uncertain, state unknown clearly and provide the next best verification step.
- Do not claim actions were executed unless they were actually executed.
- Keep recommendations safe, testable, and scoped to the objective.
- For research outputs, prefer authoritative primary sources and include confidence.
RULES
}

detect_research_profile() {
  local objective_lower
  objective_lower=$(tr '[:upper:]' '[:lower:]' <<<"$1")

  if grep -Eqi 'tender|procurement|rfp|rfq|legal|law|act|regulation|compliance' <<<"$objective_lower"; then
    echo "tender_legal"
    return 0
  fi
  if grep -Eqi 'vision|ocr|image|photo|cv|opencv|onnx|inspection' <<<"$objective_lower"; then
    echo "vision"
    return 0
  fi
  if grep -Eqi 'ux|ui|accessibility|human interaction|hci|wcag' <<<"$objective_lower"; then
    echo "ux"
    return 0
  fi
  if grep -Eqi 'coding|typescript|react|frontend|backend|api|architecture|engineering' <<<"$objective_lower"; then
    echo "coding"
    return 0
  fi

  echo "general"
}

allowed_domains_for_profile() {
  local profile="$1"
  case "$profile" in
    tender_legal)
      echo "procurement.govt.nz gets.govt.nz legislation.govt.nz mbie.govt.nz data.govt.nz govt.nz"
      ;;
    vision)
      echo "onnx.ai docs.opencv.org tesseract-ocr.github.io developer.mozilla.org w3.org"
      ;;
    ux)
      echo "nngroup.com interaction-design.org w3.org developer.mozilla.org"
      ;;
    coding)
      echo "react.dev typescriptlang.org developer.mozilla.org w3.org nodejs.org"
      ;;
    *)
      echo "procurement.govt.nz gets.govt.nz legislation.govt.nz mbie.govt.nz react.dev typescriptlang.org developer.mozilla.org w3.org onnx.ai docs.opencv.org tesseract-ocr.github.io nngroup.com interaction-design.org"
      ;;
  esac
}

extract_domains() {
  tr '[:upper:]' '[:lower:]' <<<"$1" \
    | grep -Eo '\b([a-z0-9-]+\.)+[a-z]{2,}\b' \
    | sort -u
}

is_domain_allowed() {
  local domain="$1"
  shift
  local allowed=("$@")
  for candidate in "${allowed[@]}"; do
    if [[ "$domain" == "$candidate" || "$domain" == *".${candidate}" ]]; then
      return 0
    fi
  done
  return 1
}

validate_research_output() {
  local text="$1"
  local profile="$2"
  local strict_allowlist="${3:-true}"
  local lowered
  lowered=$(tr '[:upper:]' '[:lower:]' <<<"$text")
  local allowed_list
  allowed_list="$(allowed_domains_for_profile "$profile")"
  read -r -a allowed_arr <<<"$allowed_list"

  # Basic structure checks
  if ! grep -qi 'objective' <<<"$text"; then
    echo "missing objective section"
    return 1
  fi
  if ! grep -qi 'query\|queries' <<<"$text"; then
    echo "missing search queries"
    return 1
  fi
  if ! grep -qi 'source' <<<"$text"; then
    echo "missing source section"
    return 1
  fi

  # Placeholder / fabricated-pattern checks
  if grep -Eqi '\[insert|\[your|tbd|example\.com|<[^>]+>|lawa \[' <<<"$text"; then
    echo "contains placeholder or fabricated pattern"
    return 1
  fi

  # Require explicit confidence marker
  if ! grep -Eqi 'confidence|[0-9]+/[0-9]+|[0-9]{1,3}%' <<<"$text"; then
    echo "missing confidence rating"
    return 1
  fi

  # If legal statutes are mentioned, require explicit verification marker.
  if grep -Eqi '\b[A-Z][A-Za-z ]+ Act 20[0-9]{2}\b' <<<"$text"; then
    if ! grep -Eqi 'verified statute source\s*:\s*legislation\.govt\.nz|verified on legislation\.govt\.nz' <<<"$lowered"; then
      echo "statute mentioned without legislation.govt.nz verification marker"
      return 1
    fi
  fi

  local domains
  domains=$(extract_domains "$text" || true)
  if [[ -z "$domains" ]]; then
    echo "no cited domains found"
    return 1
  fi

  # Require at least 3 authoritative domains (official + technical standards set).
  local authority_refs=(
    "procurement.govt.nz" "gets.govt.nz" "legislation.govt.nz" "mbie.govt.nz"
    "react.dev" "typescriptlang.org" "w3.org" "developer.mozilla.org"
    "onnx.ai" "docs.opencv.org" "tesseract-ocr.github.io"
    "nngroup.com" "interaction-design.org" "govt.nz"
  )
  local authority_count=0
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    if is_domain_allowed "$d" "${authority_refs[@]}"; then
      authority_count=$((authority_count + 1))
    fi
  done <<<"$domains"

  if [[ "$authority_count" -lt 3 ]]; then
    echo "insufficient authoritative source coverage (<3 domains)"
    return 1
  fi

  # Strict allowlist mode: all cited domains must be in the profile allowlist.
  if [[ "$strict_allowlist" == "true" ]]; then
    local allowed_hits=0
    while IFS= read -r d; do
      [[ -z "$d" ]] && continue
      if is_domain_allowed "$d" "${allowed_arr[@]}"; then
        allowed_hits=$((allowed_hits + 1))
      else
        echo "domain not allowed for profile ${profile}: ${d}"
        return 1
      fi
    done <<<"$domains"

    if [[ "$allowed_hits" -lt 3 ]]; then
      echo "strict allowlist requires at least 3 allowed domains"
      return 1
    fi
  fi

  return 0
}

run_research_with_guard() {
  local objective="$1"
  local profile
  profile="$(detect_research_profile "$objective")"
  local strict_allowlist="${BOB_STRICT_DOMAIN_ALLOWLIST:-true}"
  local allowed_list
  allowed_list="$(allowed_domains_for_profile "$profile")"
  local first
  first=$(call_chat "You are Doctor Bob working with external Copilot. $(copilot_restrictions) Build a web research brief for this objective. Research profile: ${profile}. Return: 1) objective clarification 2) 8-12 high-value search queries 3) authoritative source targets in priority order 4) currentness checks (date/version) 5) conflict-resolution rules when sources disagree 6) evidence table format Bob/Copilot should fill 7) implementation mapping to repo files/tests. IMPORTANT: do not invent URLs, laws, or documents; if uncertain, say unknown and provide a search query instead. Use only verifiable source names and include a confidence rating per source. Use ONLY these allowed source domains for this profile: ${allowed_list}. Include at least 3 allowed domains. If you mention any statute name, add: Verified statute source: legislation.govt.nz. Objective: $objective")

  local reason=""
  if validate_research_output "$first" "$profile" "$strict_allowlist"; then
    echo "$first"
    return 0
  else
    reason=$(validate_research_output "$first" "$profile" "$strict_allowlist" 2>/dev/null || true)
  fi

  echo "⚠️  Research quality gate failed on first pass: ${reason:-invalid format}. Requesting corrected second pass..." >&2

  local second
  second=$(call_chat "You are Doctor Bob. $(copilot_restrictions) Your previous research brief failed validation because: ${reason:-invalid format}. Regenerate the full brief with strict verifiable sourcing. Rules: (a) no placeholder text, (b) no invented organizations or documents, (c) include at least 3 concrete authoritative source domains, (d) include confidence per source, (e) if unknown, explicitly state unknown and provide a search query, (f) any statute mention must include: Verified statute source: legislation.govt.nz, (g) all cited domains must be from this allowlist: ${allowed_list}. Objective: $objective. Previous output to correct: $first")

  local reason2=""
  if validate_research_output "$second" "$profile" "$strict_allowlist"; then
    echo "$second"
    return 0
  else
    reason2=$(validate_research_output "$second" "$profile" "$strict_allowlist" 2>/dev/null || true)
  fi

  echo "❌ Research quality gate failed after second pass: ${reason2:-invalid format}." >&2
  echo "Please refine objective scope and rerun research mode." >&2
  return 2
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
    call_chat "$(copilot_restrictions) User request: $INPUT"
    ;;

  plan)
    call_chat "You are Doctor Bob working with external Copilot. $(copilot_restrictions) Analyze this task and return: 1) risks 2) root cause hypotheses 3) recommended split (Bob-do vs Copilot-do) 4) staged plan 5) verification checklist. Task: $INPUT"
    ;;

  research)
    run_research_with_guard "$INPUT"
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
    call_chat "You are Doctor Bob working with external Copilot. $(copilot_restrictions) Provide a concise engineering plan for this task, then include a one-line suggested code-task objective suitable for /code/task queueing. Task: $INPUT"
    echo
    echo "=== Queueing Bob code task ==="
    queue_code_task "$INPUT" "$TARGET_FILES_RAW" "$PRIORITY"
    ;;

  hybrid-run)
    feed_context_if_available
    echo "=== Doctor Bob analysis ==="
    call_chat "You are Doctor Bob working with external Copilot. $(copilot_restrictions) Provide a concise engineering plan for this task, then include a one-line suggested code-task objective suitable for /code/task queueing. Task: $INPUT"
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
