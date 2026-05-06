#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_DIR="${BOB_AUTONOMOUS_PID_DIR:-${REPO_ROOT}/tmp}"
LOG_DIR="${BOB_AUTONOMOUS_LOG_DIR:-${REPO_ROOT}/logs}"
PID_FILE="${BOB_AUTONOMOUS_PID_FILE:-${PID_DIR}/bob-autonomous-daemon.pid}"
LOG_FILE="${BOB_AUTONOMOUS_LOG_FILE:-${LOG_DIR}/bob-autonomous-cycle.log}"
INTERVAL_MINUTES="${BOB_AUTONOMOUS_INTERVAL_MINUTES:-60}"

mkdir -p "${PID_DIR}" "${LOG_DIR}"

is_running() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(cat "${PID_FILE}")"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null
}

start_daemon() {
  if ! [[ "${INTERVAL_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${INTERVAL_MINUTES}" -lt 5 ]]; then
    echo "Invalid BOB_AUTONOMOUS_INTERVAL_MINUTES=${INTERVAL_MINUTES} (must be integer >= 5)"
    exit 2
  fi

  if is_running; then
    echo "Autonomous daemon already running (pid $(cat "${PID_FILE}"))"
    return 0
  fi

  local runner
  runner="cd \"${REPO_ROOT}\" && while true; do echo \"[bob-autonomous-daemon] cycle start $(date -u '+%Y-%m-%dT%H:%M:%SZ')\"; bash scripts/run-autonomous-learning-cycle.sh >> \"${LOG_FILE}\" 2>&1 || true; echo \"[bob-autonomous-daemon] cycle done; sleeping ${INTERVAL_MINUTES}m\" >> \"${LOG_FILE}\"; sleep $((INTERVAL_MINUTES * 60)); done"

  nohup bash -lc "${runner}" >> "${LOG_FILE}" 2>&1 &
  echo "$!" > "${PID_FILE}"
  echo "Started autonomous daemon (pid $!)"
  echo "Interval: ${INTERVAL_MINUTES} minutes"
  echo "Log file: ${LOG_FILE}"
}

stop_daemon() {
  if ! is_running; then
    rm -f "${PID_FILE}"
    echo "Autonomous daemon is not running"
    return 0
  fi

  local pid
  pid="$(cat "${PID_FILE}")"
  kill "${pid}" || true
  rm -f "${PID_FILE}"
  echo "Stopped autonomous daemon (pid ${pid})"
}

status_daemon() {
  if is_running; then
    echo "Autonomous daemon: running (pid $(cat "${PID_FILE}"))"
  else
    echo "Autonomous daemon: not running"
  fi
  echo "PID file: ${PID_FILE}"
  echo "Log file: ${LOG_FILE}"
  if [[ -f "${LOG_FILE}" ]]; then
    echo "Recent log lines:"
    tail -n 5 "${LOG_FILE}" || true
  fi
}

usage() {
  cat <<EOF
Usage: bash scripts/manage-autonomous-daemon.sh <start|stop|status>

Environment overrides:
  BOB_AUTONOMOUS_INTERVAL_MINUTES  Run interval in minutes (default: 60)
  BOB_AUTONOMOUS_LOG_FILE          Log file path (default: <repo>/logs/bob-autonomous-cycle.log)
  BOB_AUTONOMOUS_PID_FILE          PID file path (default: <repo>/tmp/bob-autonomous-daemon.pid)
EOF
}

cmd="${1:-status}"
case "${cmd}" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  status)
    status_daemon
    ;;
  *)
    usage
    exit 2
    ;;
esac
