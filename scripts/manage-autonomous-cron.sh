#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CRON_TAG="# bob-autonomous-self-heal-cycle"
LOG_DIR="${BOB_AUTONOMOUS_LOG_DIR:-${REPO_ROOT}/logs}"
LOG_FILE="${BOB_AUTONOMOUS_LOG_FILE:-${LOG_DIR}/bob-autonomous-cycle.log}"
CRON_SCHEDULE="${BOB_AUTONOMOUS_CRON_SCHEDULE:-15 2 * * *}"
CYCLE_SCRIPT="${BOB_AUTONOMOUS_CYCLE_SCRIPT:-scripts/run-autonomous-learning-cycle.sh}"
FALLBACK_ENTRY_FILE="${BOB_AUTONOMOUS_CRON_FALLBACK_FILE:-${REPO_ROOT}/tmp/bob-autonomous-cron.entry}"
ENABLE_DAEMON_FALLBACK="${BOB_AUTONOMOUS_ENABLE_DAEMON_FALLBACK:-true}"
DAEMON_FALLBACK_INTERVAL_MINUTES="${BOB_AUTONOMOUS_DAEMON_FALLBACK_INTERVAL_MINUTES:-1440}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab command not found"
  exit 1
fi

mkdir -p "${LOG_DIR}"

cron_command() {
  echo "cd \"${REPO_ROOT}\" && BOB_ENABLE_TRAINING_REFRESH=\"${BOB_ENABLE_TRAINING_REFRESH:-}\" bash \"${CYCLE_SCRIPT}\" >> \"${LOG_FILE}\" 2>&1"
}

desired_line() {
  printf "%s %s %s" "${CRON_SCHEDULE}" "$(cron_command)" "${CRON_TAG}"
}

current_crontab() {
  crontab -l 2>/dev/null || true
}

install_entry() {
  if [[ ! -f "${REPO_ROOT}/${CYCLE_SCRIPT}" ]]; then
    echo "Cycle script not found: ${CYCLE_SCRIPT}"
    exit 2
  fi

  local existing
  existing="$(current_crontab)"
  local line
  line="$(desired_line)"

  local install_code=0
  set +e
  {
    printf '%s\n' "${existing}" | awk -v tag="${CRON_TAG}" 'index($0, tag) == 0 && length($0) > 0 { print }'
    printf '%s\n' "${line}"
  } | crontab -
  install_code=$?
  set -e

  if [[ "$install_code" -ne 0 ]]; then
    mkdir -p "$(dirname "${FALLBACK_ENTRY_FILE}")"
    printf '%s\n' "${line}" > "${FALLBACK_ENTRY_FILE}"
    echo "Could not install crontab directly in this environment (exit=${install_code})."
    echo "Wrote fallback cron entry: ${FALLBACK_ENTRY_FILE}"
    echo "Install on host with: crontab ${FALLBACK_ENTRY_FILE}"

    if [[ "${ENABLE_DAEMON_FALLBACK}" == "true" ]]; then
      if [[ -f "${REPO_ROOT}/scripts/manage-autonomous-daemon.sh" ]]; then
        echo "Attempting daemon fallback with interval ${DAEMON_FALLBACK_INTERVAL_MINUTES} minutes"
        BOB_AUTONOMOUS_INTERVAL_MINUTES="${DAEMON_FALLBACK_INTERVAL_MINUTES}" bash "${REPO_ROOT}/scripts/manage-autonomous-daemon.sh" start || true
      else
        echo "Daemon fallback unavailable: scripts/manage-autonomous-daemon.sh not found"
      fi
    fi

    return 0
  fi

  if printf '%s\n' "${existing}" | grep -Fq "${CRON_TAG}"; then
    echo "Updated autonomous self-heal cron entry"
  else
    echo "Installed autonomous self-heal cron entry"
  fi

  echo "Schedule: ${CRON_SCHEDULE}"
  echo "Cycle script: ${CYCLE_SCRIPT}"
  echo "Log file: ${LOG_FILE}"
}

remove_entry() {
  local existing
  existing="$(current_crontab)"

  if ! printf '%s\n' "${existing}" | grep -Fq "${CRON_TAG}"; then
    echo "No autonomous self-heal cron entry found"
    return 0
  fi

  printf '%s\n' "${existing}" | grep -Fv "${CRON_TAG}" | crontab -
  echo "Removed autonomous self-heal cron entry"
}

show_status() {
  local existing
  existing="$(current_crontab)"
  echo "Autonomous self-heal cron status:"
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

  echo "Cycle script: ${REPO_ROOT}/${CYCLE_SCRIPT}"
  echo "Cycle log: ${LOG_FILE}"

  if [[ -f "${REPO_ROOT}/scripts/manage-autonomous-daemon.sh" ]]; then
    BOB_AUTONOMOUS_INTERVAL_MINUTES="${DAEMON_FALLBACK_INTERVAL_MINUTES}" bash "${REPO_ROOT}/scripts/manage-autonomous-daemon.sh" status || true
  fi
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
  BOB_AUTONOMOUS_CRON_SCHEDULE   Cron expression (default: 15 2 * * *, once daily)
  BOB_AUTONOMOUS_CYCLE_SCRIPT    Cycle script path relative to repo root (default: scripts/run-autonomous-learning-cycle.sh)
  BOB_ENABLE_TRAINING_REFRESH    Pass-through env for cycle script training refresh behavior
  BOB_AUTONOMOUS_CRON_FALLBACK_FILE  Fallback path for generated cron entry when install is blocked
  BOB_AUTONOMOUS_LOG_DIR         Directory for logs (default: <repo>/logs)
  BOB_AUTONOMOUS_LOG_FILE        Log file path (default: <repo>/logs/bob-autonomous-cycle.log)
  BOB_AUTONOMOUS_ENABLE_DAEMON_FALLBACK  Enable daemon fallback when crontab install fails (default: true)
  BOB_AUTONOMOUS_DAEMON_FALLBACK_INTERVAL_MINUTES  Fallback daemon interval in minutes (default: 1440)
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
