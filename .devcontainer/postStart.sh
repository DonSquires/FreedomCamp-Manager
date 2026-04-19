#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${HOME}/vite-dev.log"
PID_FILE="${HOME}/.fieldops-vite-dev.pid"
OLLAMA_LOG_FILE="${HOME}/ollama.log"

truthy() {
	local value="${1:-}"
	value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
	[[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

start_ollama_if_needed() {
	if ! command -v ollama >/dev/null 2>&1; then
		return 0
	fi

	local autostart="${OLLAMA_AUTOSTART:-true}"
	if ! truthy "$autostart"; then
		return 0
	fi

	if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
		return 0
	fi

	nohup ollama serve > "$OLLAMA_LOG_FILE" 2>&1 &

	for _ in $(seq 1 20); do
		if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done

	if ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
		return 0
	fi

	local pull_on_start="${OLLAMA_PULL_ON_START:-false}"
	local model="${OLLAMA_MODEL:-llama3.1:8b}"
	if truthy "$pull_on_start"; then
		if ! ollama list 2>/dev/null | awk '{print $1}' | grep -Fxq "$model"; then
			nohup ollama pull "$model" >> "$OLLAMA_LOG_FILE" 2>&1 &
		fi
	fi
}

start_ollama_if_needed

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
