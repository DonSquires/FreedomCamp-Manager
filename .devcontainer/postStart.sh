#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${HOME}/vite-dev.log"
PID_FILE="${HOME}/.fieldops-vite-dev.pid"

is_pid_running() {
	local pid="$1"
	if [[ -z "$pid" ]]; then
		return 1
	fi
	kill -0 "$pid" 2>/dev/null
}

# Prefer an existing PID file if present.
if [[ -f "$PID_FILE" ]]; then
	existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
	if is_pid_running "$existing_pid"; then
		exit 0
	fi
fi

# Fall back to process discovery to handle stale or missing PID files.
existing_cmd_pid="$(pgrep -f "npm run dev -- --host 0.0.0.0" | head -n 1 || true)"
if is_pid_running "$existing_cmd_pid"; then
	printf '%s\n' "$existing_cmd_pid" > "$PID_FILE"
	exit 0
fi

nohup npm run dev -- --host 0.0.0.0 > "$LOG_FILE" 2>&1 &
printf '%s\n' "$!" > "$PID_FILE"
