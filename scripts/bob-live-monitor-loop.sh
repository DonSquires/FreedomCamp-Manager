#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INTERVAL_MINUTES="${BOB_MONITOR_INTERVAL_MINUTES:-5}"
SUMMARY_WINDOW_HOURS="${BOB_SUMMARY_WINDOW_HOURS:-24}"
ONE_SHOT="${BOB_MONITOR_ONE_SHOT:-false}"
LOCK_DIR="${BOB_LIVE_MONITOR_LOCK_DIR:-tmp/locks/bob-live-monitor-loop.lock}"
MAX_BACKOFF_MINUTES="${BOB_MONITOR_MAX_BACKOFF_MINUTES:-15}"

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
    echo "[bob-live-monitor] another live monitor loop is already running (pid=$existing_pid); exiting"
    exit 0
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR" 2>/dev/null || {
    echo "[bob-live-monitor] unable to acquire loop lock"
    exit 3
  }
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
fi

if ! [[ "$INTERVAL_MINUTES" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_MINUTES" -lt 1 ]]; then
  echo "Invalid BOB_MONITOR_INTERVAL_MINUTES: $INTERVAL_MINUTES"
  exit 2
fi

if ! [[ "$MAX_BACKOFF_MINUTES" =~ ^[0-9]+$ ]] || [[ "$MAX_BACKOFF_MINUTES" -lt 1 ]]; then
  echo "Invalid BOB_MONITOR_MAX_BACKOFF_MINUTES: $MAX_BACKOFF_MINUTES"
  exit 2
fi

echo "[bob-live-monitor] starting at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "[bob-live-monitor] interval=${INTERVAL_MINUTES}m summaryWindow=${SUMMARY_WINDOW_HOURS}h"

consecutive_failures=0

while true; do
  echo "[bob-live-monitor] cycle start $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  MONITOR_EXIT=0
  bash scripts/monitor-bob.sh || MONITOR_EXIT=$?
  if [[ "$MONITOR_EXIT" -ne 0 ]]; then
    consecutive_failures=$((consecutive_failures + 1))
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
  else
    consecutive_failures=0
  fi

  node scripts/summarize-failures.mjs --hours "$SUMMARY_WINDOW_HOURS" || true

  if [[ -f system_state.json ]]; then
    node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('system_state.json','utf8'));if(s.critical_warning){console.log('[bob-live-monitor] critical warning present:',s.critical_warning)}else{console.log('[bob-live-monitor] status',s.monitor?.status||'healthy')}" || true
  fi

  if [[ "$ONE_SHOT" == "true" ]]; then
    echo "[bob-live-monitor] one-shot mode complete"
    break
  fi

  backoff_minutes="$INTERVAL_MINUTES"
  if [[ "$consecutive_failures" -gt 0 ]]; then
    candidate=$((INTERVAL_MINUTES * (2 ** (consecutive_failures - 1))))
    if [[ "$candidate" -gt "$MAX_BACKOFF_MINUTES" ]]; then
      backoff_minutes="$MAX_BACKOFF_MINUTES"
    else
      backoff_minutes="$candidate"
    fi
  fi

  echo "[bob-live-monitor] cycle complete; sleeping ${backoff_minutes}m"
  sleep "$((backoff_minutes * 60))"
done
