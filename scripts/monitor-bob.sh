#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MONITOR_VERSION="2026-05-13.enterprise.v1"
MONITOR_LOCK_DIR="${BOB_MONITOR_LOCK_DIR:-tmp/locks/monitor-bob.lock}"
MONITOR_HEARTBEAT_FILE="${BOB_MONITOR_HEARTBEAT_FILE:-data/monitor-heartbeat.json}"
MONITOR_ERROR_REGEX="${BOB_MONITOR_ERROR_REGEX:-(^|[^0-9])500([^0-9]|$)|status=500|HTTP 500|Internal Server Error}"
MONITOR_LOG_LINES="${BOB_MONITOR_LOG_LINES:-500}"

acquire_lock() {
  mkdir -p "$(dirname "$MONITOR_LOCK_DIR")"
  if mkdir "$MONITOR_LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$MONITOR_LOCK_DIR/pid"
    trap 'rm -rf "$MONITOR_LOCK_DIR"' EXIT
    return 0
  fi

  local existing_pid=""
  if [[ -f "$MONITOR_LOCK_DIR/pid" ]]; then
    existing_pid="$(cat "$MONITOR_LOCK_DIR/pid" 2>/dev/null || true)"
  fi

  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Bob monitor: another monitor run is active (pid=$existing_pid); skipping this cycle."
    exit 0
  fi

  rm -rf "$MONITOR_LOCK_DIR" 2>/dev/null || true
  mkdir "$MONITOR_LOCK_DIR" 2>/dev/null || {
    echo "Bob monitor: failed to acquire lock after stale cleanup"
    exit 3
  }
  echo "$$" > "$MONITOR_LOCK_DIR/pid"
  trap 'rm -rf "$MONITOR_LOCK_DIR"' EXIT
}

acquire_lock

# Guard: this script is for VPS/production monitoring only.
# In CI environments (e.g. GitHub Actions) journalctl contains runner system
# logs that produce false-positive 500-error matches unrelated to the
# application.  Skip log scanning, mark the monitor healthy, and exit.
if [[ "${CI:-false}" == "true" ]]; then
  echo "Bob monitor: CI environment detected — skipping log scan (monitor is for VPS/production only)."

  if [[ -f system_state.json ]]; then
    node - "$ROOT_DIR/system_state.json" <<'EOF_CI_CLEAR'
const fs = require('fs');
const filePath = process.argv[2];
const raw = fs.readFileSync(filePath, 'utf8');
const state = JSON.parse(raw);
state.monitor = {
  ...(state.monitor || {}),
  checked_at: new Date().toISOString(),
  status: 'healthy',
  note: 'CI environment — log scan skipped',
};
delete state.critical_warning;
fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
EOF_CI_CLEAR
  fi

  exit 0
fi

WINDOW_MINUTES="${BOB_MONITOR_WINDOW_MINUTES:-15}"
ERROR_THRESHOLD="${BOB_MONITOR_ERROR_THRESHOLD:-5}"
ESCALATE_TO_DR_BOB="${BOB_ESCALATE_TO_DR_BOB:-true}"
INCIDENT_FILE="${BOB_MONITOR_INCIDENT_FILE:-data/dr-bob-live-incident.md}"
ESCALATION_FILE="${BOB_MONITOR_ESCALATION_FILE:-data/dr-bob-live-escalation.json}"
LIVE_DIAG_SELF_HEAL_ENABLED="${BOB_LIVE_DIAG_SELF_HEAL_ENABLED:-true}"
LIVE_DIAG_SUMMARY_FILE="${BOB_LIVE_DIAG_SUMMARY_FILE:-data/live-session-diagnostics-summary.json}"
LIVE_DIAG_WINDOW_MINUTES="${LIVE_DIAG_WINDOW_MINUTES:-20}"

TMP_INPUT="$(mktemp)"
cleanup() {
  rm -f "$TMP_INPUT"
}
trap cleanup EXIT

collect_logs() {
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs --nostream --lines "$MONITOR_LOG_LINES" 2>/dev/null || true
  fi

  if command -v journalctl >/dev/null 2>&1; then
    journalctl --since "${WINDOW_MINUTES} minutes ago" --no-pager 2>/dev/null || true
  fi

  if [[ -f /var/log/syslog ]]; then
    tail -n "$((MONITOR_LOG_LINES * 2))" /var/log/syslog 2>/dev/null || true
  fi
}

collect_logs > "$TMP_INPUT"

ERROR_COUNT="$({ grep -Eic "$MONITOR_ERROR_REGEX" "$TMP_INPUT"; } || true)"
UNIQUE_ERROR_COUNT="$({ grep -Ei "$MONITOR_ERROR_REGEX" "$TMP_INPUT" | sed 's/[[:space:]]\+/ /g' | cut -c1-220 | sort -u | wc -l; } || true)"

if [[ ! -f system_state.json ]]; then
  bash scripts/system-check.sh
fi

node - "$ROOT_DIR/system_state.json" "$ERROR_COUNT" "$UNIQUE_ERROR_COUNT" "$ERROR_THRESHOLD" "$WINDOW_MINUTES" "$MONITOR_VERSION" <<'EOF_NODE'
const fs = require('fs');

const [filePath, errorCountRaw, uniqueErrorCountRaw, thresholdRaw, windowMinutesRaw, monitorVersion] = process.argv.slice(2);
const errorCount = Number(errorCountRaw || '0');
const uniqueErrorCount = Number(uniqueErrorCountRaw || '0');
const threshold = Number(thresholdRaw || '5');
const windowMinutes = Number(windowMinutesRaw || '15');

const raw = fs.readFileSync(filePath, 'utf8');
const state = JSON.parse(raw);

state.monitor = {
  ...(state.monitor || {}),
  checked_at: new Date().toISOString(),
  monitor_version: monitorVersion || 'unknown',
  window_minutes: windowMinutes,
  error_threshold: threshold,
  recent_500_errors: errorCount,
  unique_500_error_signatures: uniqueErrorCount,
};

// Non-CI monitor runs should not keep a stale CI skip note.
delete state.monitor.note;

if (errorCount >= threshold) {
  state.critical_warning = `Bob monitor detected ${errorCount} server-side 500 errors in the last ${windowMinutes} minutes.`;
  state.monitor.status = 'warning';
} else {
  delete state.critical_warning;
  state.monitor.status = 'healthy';
}

fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
EOF_NODE

mkdir -p "$(dirname "$MONITOR_HEARTBEAT_FILE")"
node - "$MONITOR_HEARTBEAT_FILE" "$ERROR_COUNT" "$UNIQUE_ERROR_COUNT" "$WINDOW_MINUTES" "$ERROR_THRESHOLD" "$MONITOR_VERSION" <<'EOF_HEARTBEAT'
const fs = require('fs');

const [filePath, errorCountRaw, uniqueErrorCountRaw, windowMinutesRaw, thresholdRaw, monitorVersion] = process.argv.slice(2);
const payload = {
  checked_at: new Date().toISOString(),
  monitor_version: monitorVersion,
  error_count: Number(errorCountRaw || '0'),
  unique_error_signatures: Number(uniqueErrorCountRaw || '0'),
  window_minutes: Number(windowMinutesRaw || '15'),
  threshold: Number(thresholdRaw || '5'),
};
fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
EOF_HEARTBEAT

if [[ "$LIVE_DIAG_SELF_HEAL_ENABLED" == "true" ]]; then
  node scripts/self-heal-live-session-diagnostics.mjs --window-minutes "$LIVE_DIAG_WINDOW_MINUTES" --retries "${LIVE_DIAG_HTTP_RETRIES:-2}" --timeout-ms "${LIVE_DIAG_HTTP_TIMEOUT_MS:-12000}" || true

  if [[ -f "$LIVE_DIAG_SUMMARY_FILE" ]]; then
    node - "$ROOT_DIR/system_state.json" "$LIVE_DIAG_SUMMARY_FILE" <<'EOF_LIVE_DIAG'
const fs = require('fs');

const [statePath, summaryPath] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

state.monitor = {
  ...(state.monitor || {}),
  live_session_diagnostics: summary,
};

const hasLiveWarning = summary && (summary.status === 'warning' || summary.status === 'stale' || summary.status === 'unavailable');
if (hasLiveWarning) {
  const liveWarning = `Live session diagnostics ${summary.status}: ${summary.reason || 'review required'}`;
  if (state.critical_warning) {
    if (!String(state.critical_warning).includes(liveWarning)) {
      state.critical_warning = `${state.critical_warning} ${liveWarning}`;
    }
  } else {
    state.critical_warning = liveWarning;
  }

  if (state.monitor.status === 'healthy') {
    state.monitor.status = 'warning';
  }
}

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
EOF_LIVE_DIAG
  fi
fi

echo "Bob monitor checked logs: ${ERROR_COUNT} server-side 500 errors (${UNIQUE_ERROR_COUNT} unique signatures) in last ${WINDOW_MINUTES} minutes"

if [[ "${ESCALATE_TO_DR_BOB}" == "true" && "$ERROR_COUNT" -ge "$ERROR_THRESHOLD" ]]; then
  mkdir -p "$(dirname "$INCIDENT_FILE")"
  LAST_ERRORS="$({ grep -Ei "$MONITOR_ERROR_REGEX" "$TMP_INPUT" | tail -n 40; } || true)"

  cat > "$INCIDENT_FILE" <<EOF_INCIDENT
# Live Bob Monitor Incident

- Detected at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
- Monitor version: ${MONITOR_VERSION}
- Error count: ${ERROR_COUNT}
- Unique signatures: ${UNIQUE_ERROR_COUNT}
- Window minutes: ${WINDOW_MINUTES}
- Threshold: ${ERROR_THRESHOLD}
- Source: scripts/monitor-bob.sh

## Recent Error Samples

\`\`\`
${LAST_ERRORS}
\`\`\`
EOF_INCIDENT

  echo "Bob monitor: escalating incident to Dr Bob via scripts/dr-bob-review.mjs"
  node scripts/dr-bob-review.mjs \
    --file "$INCIDENT_FILE" \
    --type plan \
    --strict-json true \
    --max-attempts 4 \
    --self-heal-basic true \
    --escalate-file "$ESCALATION_FILE" || true
fi