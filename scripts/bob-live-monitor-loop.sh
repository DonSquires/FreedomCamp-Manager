#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INTERVAL_MINUTES="${BOB_MONITOR_INTERVAL_MINUTES:-5}"
SUMMARY_WINDOW_HOURS="${BOB_SUMMARY_WINDOW_HOURS:-24}"

if ! [[ "$INTERVAL_MINUTES" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_MINUTES" -lt 1 ]]; then
  echo "Invalid BOB_MONITOR_INTERVAL_MINUTES: $INTERVAL_MINUTES"
  exit 2
fi

echo "[bob-live-monitor] starting at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "[bob-live-monitor] interval=${INTERVAL_MINUTES}m summaryWindow=${SUMMARY_WINDOW_HOURS}h"

while true; do
  echo "[bob-live-monitor] cycle start $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  MONITOR_EXIT=0
  bash scripts/monitor-bob.sh || MONITOR_EXIT=$?
  if [[ "$MONITOR_EXIT" -ne 0 ]]; then
    echo "[bob-live-monitor] ERROR: monitor-bob.sh exited with code ${MONITOR_EXIT} — marking state degraded"
    node - "$ROOT_DIR/system_state.json" "$MONITOR_EXIT" <<'EOF_CRASH'
const fs = require('fs');
const [filePath, exitCode] = process.argv.slice(2);
if (!fs.existsSync(filePath)) process.exit(0);
const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
state.monitor = { ...(state.monitor || {}), status: 'warning', note: `monitor-bob.sh crashed with exit code ${exitCode}` };
state.critical_warning = `Monitor script crashed (exit ${exitCode}) — last state may be stale`;
fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
EOF_CRASH
  fi

  node scripts/summarize-failures.mjs --hours "$SUMMARY_WINDOW_HOURS" || true

  if [[ -f system_state.json ]]; then
    node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('system_state.json','utf8'));if(s.critical_warning){console.log('[bob-live-monitor] critical warning present:',s.critical_warning)}else{console.log('[bob-live-monitor] status',s.monitor?.status||'healthy')}" || true
  fi

  echo "[bob-live-monitor] cycle complete; sleeping ${INTERVAL_MINUTES}m"
  sleep "$((INTERVAL_MINUTES * 60))"
done
