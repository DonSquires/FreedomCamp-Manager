#!/usr/bin/env bash
set -euo pipefail

# Background stack launcher for app + PTT + supporting services.
# Usage:
#   bash scripts/bg-stack.sh start
#   bash scripts/bg-stack.sh stop
#   bash scripts/bg-stack.sh restart
#   bash scripts/bg-stack.sh status

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime/background"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

START_MODE="${START_MODE:-dev}"

services=(
  "app"
  "proxy"
  "ptt"
  "inference"
  "translator"
)

service_cmd() {
  local svc="$1"
  case "$svc" in
    app)
      if [[ "$START_MODE" == "preview" ]]; then
        echo "cd '$ROOT_DIR' && bun run preview --host 0.0.0.0 --port ${PORT:-4173}"
      else
        echo "cd '$ROOT_DIR' && bun run dev --host 0.0.0.0 --port ${PORT:-5173}"
      fi
      ;;
    proxy)
      echo "cd '$ROOT_DIR/proxy-server' && npm run dev"
      ;;
    ptt)
      echo "cd '$ROOT_DIR/ptt-server' && npm run dev"
      ;;
    inference)
      echo "cd '$ROOT_DIR/inference-service' && npm run dev"
      ;;
    translator)
      if command -v uvicorn >/dev/null 2>&1; then
        echo "cd '$ROOT_DIR' && uvicorn ptt-bridge-python.main:app --host 0.0.0.0 --port ${TRANSLATOR_PORT:-8274}"
      elif command -v python3 >/dev/null 2>&1; then
        echo "cd '$ROOT_DIR' && python3 -m uvicorn ptt-bridge-python.main:app --host 0.0.0.0 --port ${TRANSLATOR_PORT:-8274}"
      else
        echo ""
      fi
      ;;
    *)
      echo ""
      ;;
  esac
}

pid_file() {
  echo "$PID_DIR/$1.pid"
}

log_file() {
  echo "$LOG_DIR/$1.log"
}

is_running() {
  local svc="$1"
  local pidf
  pidf="$(pid_file "$svc")"
  [[ -f "$pidf" ]] || return 1
  local pid
  pid="$(cat "$pidf" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_service() {
  local svc="$1"
  local cmd
  cmd="$(service_cmd "$svc")"

  if [[ -z "$cmd" ]]; then
    echo "[skip] $svc (command unavailable in this environment)"
    return
  fi

  if is_running "$svc"; then
    echo "[ok] $svc already running (pid $(cat "$(pid_file "$svc")"))"
    return
  fi

  echo "[start] $svc"
  nohup bash -lc "$cmd" >"$(log_file "$svc")" 2>&1 &
  echo $! >"$(pid_file "$svc")"
  echo "[pid] $svc -> $(cat "$(pid_file "$svc")")"
}

stop_service() {
  local svc="$1"
  local pidf
  pidf="$(pid_file "$svc")"

  if ! [[ -f "$pidf" ]]; then
    echo "[ok] $svc not running"
    return
  fi

  local pid
  pid="$(cat "$pidf" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "[stop] $svc (pid $pid)"
    kill "$pid" 2>/dev/null || true
  else
    echo "[ok] $svc stale pid file"
  fi

  rm -f "$pidf"
}

status_service() {
  local svc="$1"
  if is_running "$svc"; then
    echo "[up]   $svc (pid $(cat "$(pid_file "$svc")"))"
  else
    echo "[down] $svc"
  fi
}

cmd="${1:-status}"
case "$cmd" in
  start)
    for svc in "${services[@]}"; do
      start_service "$svc"
    done
    ;;
  stop)
    for (( i=${#services[@]}-1; i>=0; i-- )); do
      stop_service "${services[$i]}"
    done
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    for svc in "${services[@]}"; do
      status_service "$svc"
    done
    ;;
  *)
    echo "Usage: bash scripts/bg-stack.sh [start|stop|restart|status]"
    exit 1
    ;;
esac
