#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOCK_DIR="${BOB_ENRICH_LOCK_DIR:-tmp/locks/bob-enrich.lock}"

mkdir -p "$(dirname "$LOCK_DIR")"
if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
else
  existing_pid=""
  if [[ -f "$LOCK_DIR/pid" ]]; then
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi

  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "[bob-enrich] another enrichment run is active (pid=$existing_pid); skipping"
    exit 0
  fi

  rm -rf "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR" 2>/dev/null || {
    echo "[bob-enrich] unable to acquire lock"
    exit 3
  }
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
fi

RUN_ID="$(date -u '+%Y%m%dT%H%M%SZ')"
LOG_DIR="${BOB_ENRICH_LOG_DIR:-logs/bob-enrich}"
RUN_DIR="${LOG_DIR}/${RUN_ID}"
SUMMARY_FILE="${RUN_DIR}/summary.md"
JSON_SUMMARY_FILE="${RUN_DIR}/summary.json"

SUMMARY_WINDOW_HOURS="${BOB_SUMMARY_WINDOW_HOURS:-24}"
MAX_RETRIES="${BOB_ENRICH_MAX_RETRIES:-2}"
ENABLE_TRAINING_REFRESH="${BOB_ENABLE_TRAINING_REFRESH:-true}"
STRICT_MODULE_GROUNDING="${BOB_STRICT_MODULE_GROUNDING:-true}"
ENABLE_LIVE_MONITOR_ONE_SHOT="${BOB_ENABLE_LIVE_MONITOR_ONE_SHOT:-true}"

mkdir -p "$RUN_DIR"

status_system_check="pending"
status_monitor_pre="pending"
status_failure_summary_pre="pending"
status_auto_ingest="pending"
status_module_grounding="pending"
status_training_refresh="skipped"
status_monitor_loop="pending"
status_failure_summary_post="pending"
status_dr_bob_escalation="skipped"

echo "[bob-enrich] run id: ${RUN_ID}"
echo "[bob-enrich] run dir: ${RUN_DIR}"

run_step() {
  local step_name="$1"
  local command="$2"
  local retries="${3:-$MAX_RETRIES}"

  local attempt=1
  while true; do
    local log_file="${RUN_DIR}/${step_name}.attempt${attempt}.log"
    echo "[bob-enrich] ${step_name}: attempt ${attempt}/${retries}" | tee -a "$SUMMARY_FILE"

    if bash -lc "$command" >"$log_file" 2>&1; then
      echo "[bob-enrich] ${step_name}: success" | tee -a "$SUMMARY_FILE"
      return 0
    fi

    echo "[bob-enrich] ${step_name}: failed (see ${log_file})" | tee -a "$SUMMARY_FILE"
    if [[ "$attempt" -ge "$retries" ]]; then
      return 1
    fi
    attempt=$((attempt + 1))
  done
}

parse_repeated_hallucinations() {
  node -e "
const fs = require('fs');
const p = process.argv[1];
try {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(j.repeatedHallucinations) ? j.repeatedHallucinations : [];
  process.stdout.write(String(arr.length));
} catch {
  process.stdout.write('0');
}
" "${ROOT_DIR}/data/bob-failure-summary.json"
}

# 1) System truth and runtime baseline
if run_step "system-check" "bash scripts/system-check.sh"; then
  status_system_check="success"
else
  status_system_check="failed"
fi

# 2) Pre-enrichment monitor sweep
if run_step "monitor-pre" "bash scripts/monitor-bob.sh"; then
  status_monitor_pre="success"
else
  status_monitor_pre="failed"
fi

# 3) Failure summary before enrichment
if run_step "failure-summary-pre" "node scripts/summarize-failures.mjs --hours ${SUMMARY_WINDOW_HOURS}"; then
  status_failure_summary_pre="success"
else
  status_failure_summary_pre="failed"
fi

# 4) Ingest all canonical workspace storage/context into brain dump
if run_step "auto-ingest" "node scripts/auto-ingest.mjs"; then
  status_auto_ingest="success"
else
  status_auto_ingest="failed"
fi

# 5) Drift gate: route/module grounding report + validation
if run_step "module-grounding-report" "node scripts/generate-module-grounding-report.mjs"; then
  if [[ "$STRICT_MODULE_GROUNDING" == "true" ]]; then
    if run_step "module-grounding-validate" "node scripts/validate-module-grounding.mjs --strict"; then
      status_module_grounding="success"
    else
      status_module_grounding="failed"
    fi
  else
    if run_step "module-grounding-validate" "node scripts/validate-module-grounding.mjs"; then
      status_module_grounding="warn"
    else
      status_module_grounding="failed"
    fi
  fi
else
  status_module_grounding="failed"
fi

# 6) Optional Bob refresh for remote inference ingestion when credentials are present
if [[ "$ENABLE_TRAINING_REFRESH" == "true" ]]; then
  if [[ -n "${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}" && -n "${BOB_INFERENCE_API_KEY:-${INFERENCE_API_KEY:-${VITE_INFERENCE_API_KEY:-}}}" ]]; then
    if run_step "training-refresh" "node scripts/bob-training-refresh-all.mjs"; then
      status_training_refresh="success"
    else
      status_training_refresh="failed"
    fi
  else
    status_training_refresh="skipped"
    echo "[bob-enrich] training-refresh: skipped (missing Bob endpoint/api key env)" | tee -a "$SUMMARY_FILE"
  fi
fi

# 7) One-shot live monitor loop for post-ingest watch
if [[ "$ENABLE_LIVE_MONITOR_ONE_SHOT" == "true" ]]; then
  if run_step "monitor-loop-one-shot" "BOB_MONITOR_ONE_SHOT=true bash scripts/bob-live-monitor-loop.sh"; then
    status_monitor_loop="success"
  else
    status_monitor_loop="failed"
  fi
else
  status_monitor_loop="skipped"
fi

# 8) Failure summary after enrichment
if run_step "failure-summary-post" "node scripts/summarize-failures.mjs --hours ${SUMMARY_WINDOW_HOURS}"; then
  status_failure_summary_post="success"
else
  status_failure_summary_post="failed"
fi

# 9) Auto-correct escalation when repeated hallucination patterns exist
repeated_count="$(parse_repeated_hallucinations)"
if [[ "${repeated_count}" =~ ^[0-9]+$ ]] && [[ "$repeated_count" -ge 1 ]]; then
  if run_step "dr-bob-escalation" "node scripts/dr-bob-review.mjs --file docs/BOB_FAILURE_SUMMARY.md --type plan --strict-json true --max-attempts 4 --self-heal-basic true" 1; then
    status_dr_bob_escalation="success"
  else
    status_dr_bob_escalation="failed"
  fi
fi

# 10) Write machine-readable summary
node - <<EOF >"$JSON_SUMMARY_FILE"
const payload = {
  runId: "${RUN_ID}",
  generatedAt: new Date().toISOString(),
  runDir: "${RUN_DIR}",
  statuses: {
    system_check: "${status_system_check}",
    monitor_pre: "${status_monitor_pre}",
    failure_summary_pre: "${status_failure_summary_pre}",
    auto_ingest: "${status_auto_ingest}",
    module_grounding: "${status_module_grounding}",
    training_refresh: "${status_training_refresh}",
    monitor_loop: "${status_monitor_loop}",
    failure_summary_post: "${status_failure_summary_post}",
    dr_bob_escalation: "${status_dr_bob_escalation}",
  },
  repeatedHallucinationCount: Number("${repeated_count}") || 0,
};
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
EOF

{
  echo ""
  echo "## Final Status"
  echo "- system_check: ${status_system_check}"
  echo "- monitor_pre: ${status_monitor_pre}"
  echo "- failure_summary_pre: ${status_failure_summary_pre}"
  echo "- auto_ingest: ${status_auto_ingest}"
  echo "- module_grounding: ${status_module_grounding}"
  echo "- training_refresh: ${status_training_refresh}"
  echo "- monitor_loop: ${status_monitor_loop}"
  echo "- failure_summary_post: ${status_failure_summary_post}"
  echo "- dr_bob_escalation: ${status_dr_bob_escalation}"
  echo "- repeated_hallucinations: ${repeated_count}"
  echo ""
  echo "## Artifacts"
  echo "- ${SUMMARY_FILE}"
  echo "- ${JSON_SUMMARY_FILE}"
  echo "- ${RUN_DIR}/*.log"
} >> "$SUMMARY_FILE"

# Exit non-zero if core enrichment failed.
if [[ "$status_auto_ingest" == "failed" || "$status_system_check" == "failed" ]]; then
  echo "[bob-enrich] completed with failures (see ${SUMMARY_FILE})"
  exit 1
fi

echo "[bob-enrich] completed (see ${SUMMARY_FILE})"
