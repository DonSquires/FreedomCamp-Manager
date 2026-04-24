#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WINDOW_MINUTES="${BOB_MONITOR_WINDOW_MINUTES:-15}"
ERROR_THRESHOLD="${BOB_MONITOR_ERROR_THRESHOLD:-5}"
ESCALATE_TO_DR_BOB="${BOB_ESCALATE_TO_DR_BOB:-true}"
INCIDENT_FILE="${BOB_MONITOR_INCIDENT_FILE:-data/dr-bob-live-incident.md}"
ESCALATION_FILE="${BOB_MONITOR_ESCALATION_FILE:-data/dr-bob-live-escalation.json}"

TMP_INPUT="$(mktemp)"
cleanup() {
  rm -f "$TMP_INPUT"
}
trap cleanup EXIT

collect_logs() {
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs --nostream --lines 500 2>/dev/null || true
  fi

  if command -v journalctl >/dev/null 2>&1; then
    journalctl --since "${WINDOW_MINUTES} minutes ago" --no-pager 2>/dev/null || true
  fi

  if [[ -f /var/log/syslog ]]; then
    tail -n 1000 /var/log/syslog 2>/dev/null || true
  fi
}

collect_logs > "$TMP_INPUT"

ERROR_COUNT="$({ grep -Eic '(^|[^0-9])500([^0-9]|$)|status=500|HTTP 500|Internal Server Error' "$TMP_INPUT"; } || true)"

if [[ ! -f system_state.json ]]; then
  bash scripts/system-check.sh
fi

node - "$ROOT_DIR/system_state.json" "$ERROR_COUNT" "$ERROR_THRESHOLD" "$WINDOW_MINUTES" <<'EOF_NODE'
const fs = require('fs');

const [filePath, errorCountRaw, thresholdRaw, windowMinutesRaw] = process.argv.slice(2);
const errorCount = Number(errorCountRaw || '0');
const threshold = Number(thresholdRaw || '5');
const windowMinutes = Number(windowMinutesRaw || '15');

const raw = fs.readFileSync(filePath, 'utf8');
const state = JSON.parse(raw);

state.monitor = {
  ...(state.monitor || {}),
  checked_at: new Date().toISOString(),
  window_minutes: windowMinutes,
  error_threshold: threshold,
  recent_500_errors: errorCount,
};

if (errorCount >= threshold) {
  state.critical_warning = `Bob monitor detected ${errorCount} server-side 500 errors in the last ${windowMinutes} minutes.`;
  state.monitor.status = 'warning';
} else {
  delete state.critical_warning;
  state.monitor.status = 'healthy';
}

fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
EOF_NODE

echo "Bob monitor checked logs: ${ERROR_COUNT} server-side 500 errors in last ${WINDOW_MINUTES} minutes"

if [[ "${ESCALATE_TO_DR_BOB}" == "true" && "$ERROR_COUNT" -ge "$ERROR_THRESHOLD" ]]; then
  mkdir -p "$(dirname "$INCIDENT_FILE")"
  LAST_ERRORS="$({ grep -Ei '(^|[^0-9])500([^0-9]|$)|status=500|HTTP 500|Internal Server Error' "$TMP_INPUT" | tail -n 40; } || true)"

  cat > "$INCIDENT_FILE" <<EOF_INCIDENT
# Live Bob Monitor Incident

- Detected at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
- Error count: ${ERROR_COUNT}
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