#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CRON_TAG="# bob-autonomous-learning-cycle"
LOG_DIR="${BOB_AUTONOMOUS_LOG_DIR:-${REPO_ROOT}/logs}"
LOG_FILE="${BOB_AUTONOMOUS_LOG_FILE:-${LOG_DIR}/bob-autonomous-cycle.log}"
CRON_SCHEDULE="${BOB_AUTONOMOUS_CRON_SCHEDULE:-15 2 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab command not found"
  exit 1
fi

mkdir -p "${LOG_DIR}"

cron_command() {
  echo "cd \"${REPO_ROOT}\" && bash scripts/run-autonomous-learning-cycle.sh >> \"${LOG_FILE}\" 2>&1"
}

desired_line() {
  printf "%s %s %s" "${CRON_SCHEDULE}" "$(cron_command)" "${CRON_TAG}"
}

current_crontab() {
  crontab -l 2>/dev/null || true
}

install_entry() {
  local existing
  existing="$(current_crontab)"
  local line
  line="$(desired_line)"

  {
    printf '%s\n' "${existing}" | awk -v tag="${CRON_TAG}" 'index($0, tag) == 0 && length($0) > 0 { print }'
    printf '%s\n' "${line}"
  } | crontab -

  if printf '%s\n' "${existing}" | grep -Fq "${CRON_TAG}"; then
    echo "Updated autonomous learning cron entry"
  else
    echo "Installed autonomous learning cron entry"
  fi

  echo "Schedule: ${CRON_SCHEDULE}"
  echo "Log file: ${LOG_FILE}"
}

remove_entry() {
  local existing
  existing="$(current_crontab)"

  if ! printf '%s\n' "${existing}" | grep -Fq "${CRON_TAG}"; then
    echo "No autonomous learning cron entry found"
    return 0
  fi

  printf '%s\n' "${existing}" | grep -Fv "${CRON_TAG}" | crontab -
  echo "Removed autonomous learning cron entry"
}

show_status() {
  local existing
  existing="$(current_crontab)"
  echo "Autonomous cron status:"
  if printf '%s\n' "${existing}" | grep -F "${CRON_TAG}"; then
    true
  else
    echo "(not installed)"
  fi

  if command -v pgrep >/dev/null 2>&1 && pgrep -x crond >/dev/null 2>&1; then
    echo "crond: running"
  else
    echo "crond: not running"
  fi

  echo "Cycle script: ${REPO_ROOT}/scripts/run-autonomous-learning-cycle.sh"
  echo "Cycle log: ${LOG_FILE}"
}

start_daemon() {
  if command -v pgrep >/dev/null 2>&1 && pgrep -x crond >/dev/null 2>&1; then
    echo "crond already running"
    return 0
  fi

  if ! command -v crond >/dev/null 2>&1; then
    echo "crond not found"
    return 1
  fi

  crond
  echo "Started crond"
}

usage() {
  cat <<EOF
Usage: bash scripts/manage-autonomous-cron.sh <install|remove|status|start-daemon>

Environment overrides:
  BOB_AUTONOMOUS_CRON_SCHEDULE   Cron expression (default: 15 2 * * *)
  BOB_AUTONOMOUS_LOG_DIR         Directory for logs (default: <repo>/logs)
  BOB_AUTONOMOUS_LOG_FILE        Log file path (default: <repo>/logs/bob-autonomous-cycle.log)
EOF
}

cmd="${1:-status}"
case "${cmd}" in
  install)
    install_entry
    ;;
  remove)
    remove_entry
    ;;
  status)
    show_status
    ;;
  start-daemon)
    start_daemon
    ;;
  *)
    usage
    exit 2
    ;;
esac
