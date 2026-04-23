#!/usr/bin/env bash
# aggregate-telemetry.sh
# ──────────────────────────────────────────────────────────────────────────────
# Observer Pattern — System Telemetry Aggregator
#
# Tails structured logs from every FieldOps service into a single rolling file
# so Bob (and any human operator) can cross-reference timestamps across the
# full stack (Vercel/Vite, Supabase, inference service, PTT, RunPod gateway).
#
# Usage:
#   ./scripts/aggregate-telemetry.sh [--out ./system_telemetry.log] [--tail-lines 200]
#
# Bob cross-reference pattern:
#   "Run the Playwright test. If a check fails, immediately cross-reference
#    the timestamp of the failure in system_telemetry.log."
#
# Requires: curl, jq (optional but recommended for JSON log pretty-printing)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Configurable defaults ─────────────────────────────────────────────────────
LOG_OUT="${LOG_OUT:-${ROOT_DIR}/system_telemetry.log}"
TAIL_LINES="${TAIL_LINES:-200}"
ROTATE_MB="${ROTATE_MB:-10}"

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)     LOG_OUT="$2"; shift 2 ;;
    --tail-lines) TAIL_LINES="$2"; shift 2 ;;
    --rotate-mb)  ROTATE_MB="$2"; shift 2 ;;
    *) echo "Unknown flag: $1. Usage: $0 [--out PATH] [--tail-lines N]"; exit 1 ;;
  esac
done

echo "[telemetry] Writing to ${LOG_OUT}"
echo "[telemetry] Starting aggregation loop. Press Ctrl+C to stop."

# ── Log-rotate helper ─────────────────────────────────────────────────────────
rotate_if_large() {
  local f="$1"
  local max_bytes=$(( ROTATE_MB * 1024 * 1024 ))
  if [[ -f "$f" ]]; then
    local size
    size=$(wc -c < "$f" 2>/dev/null || echo 0)
    if (( size > max_bytes )); then
      local ts; ts=$(date '+%Y%m%dT%H%M%S')
      mv "$f" "${f%.log}-${ts}.log"
      echo "[telemetry] $(date -u '+%Y-%m-%dT%H:%M:%SZ') [system] Log rotated (was ${size} bytes)" >> "$f"
    fi
  fi
}

# ── Timestamp emitter ─────────────────────────────────────────────────────────
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# ── Source 1: Inference / Bob service ────────────────────────────────────────
tail_inference_service() {
  local service_url="${BOB_SERVICE_URL:-${INFERENCE_SERVICE_URL:-}}"
  if [[ -z "$service_url" ]]; then return; fi

  while true; do
    {
      curl -sf --max-time 5 "${service_url}/health" 2>/dev/null \
        | (command -v jq &>/dev/null && jq -c '. + {source:"inference_service", ts:"'"$(ts)"'"}' 2>/dev/null || cat) \
        | while IFS= read -r line; do
            echo "$(ts) [inference] ${line}" >> "$LOG_OUT"
          done
    } || true
    sleep 15
  done
}

# ── Source 2: PTT / signaling server ─────────────────────────────────────────
tail_ptt_service() {
  local ptt_url="${PTT_SERVER_URL:-${PTT_SERVICE_URL:-}}"
  if [[ -z "$ptt_url" ]]; then return; fi

  while true; do
    {
      curl -sf --max-time 5 "${ptt_url}/health" 2>/dev/null \
        | (command -v jq &>/dev/null && jq -c '. + {source:"ptt_service", ts:"'"$(ts)"'"}' 2>/dev/null || cat) \
        | while IFS= read -r line; do
            echo "$(ts) [ptt] ${line}" >> "$LOG_OUT"
          done
    } || true
    sleep 15
  done
}

# ── Source 3: RunPod gateway ──────────────────────────────────────────────────
tail_runpod_gateway() {
  local gw_url="${RUNPOD_GATEWAY_URL:-}"
  if [[ -z "$gw_url" ]]; then return; fi

  while true; do
    {
      curl -sf --max-time 5 "${gw_url}/health" 2>/dev/null \
        | (command -v jq &>/dev/null && jq -c '. + {source:"runpod_gateway", ts:"'"$(ts)"'"}' 2>/dev/null || cat) \
        | while IFS= read -r line; do
            echo "$(ts) [runpod] ${line}" >> "$LOG_OUT"
          done
    } || true
    sleep 20
  done
}

# ── Source 4: Local dev server (Vite) process log ────────────────────────────
tail_vite_logs() {
  local vite_log="${ROOT_DIR}/.vite-dev.log"
  if [[ ! -f "$vite_log" ]]; then return; fi
  tail -n "${TAIL_LINES}" -F "$vite_log" 2>/dev/null \
    | while IFS= read -r line; do
        echo "$(ts) [vite] ${line}" >> "$LOG_OUT"
      done
}

# ── Source 5: Playwright test runner output ───────────────────────────────────
tail_playwright_logs() {
  local pw_log="${ROOT_DIR}/.playwright-run.log"
  if [[ ! -f "$pw_log" ]]; then return; fi
  tail -n "${TAIL_LINES}" -F "$pw_log" 2>/dev/null \
    | while IFS= read -r line; do
        echo "$(ts) [playwright] ${line}" >> "$LOG_OUT"
      done
}

# ── Load environment ──────────────────────────────────────────────────────────
if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC1090
  set -o allexport
  source "${ROOT_DIR}/.env" 2>/dev/null || true
  set +o allexport
fi
if [[ -f "${ROOT_DIR}/.env.local" ]]; then
  set -o allexport
  source "${ROOT_DIR}/.env.local" 2>/dev/null || true
  set +o allexport
fi

# ── Rotate and write session start marker ────────────────────────────────────
rotate_if_large "$LOG_OUT"
echo "$(ts) [system] ===== telemetry aggregator started (pid=$$) =====" >> "$LOG_OUT"

# ── Fan-out background collectors ────────────────────────────────────────────
tail_inference_service &
PID_INFERENCE=$!
tail_ptt_service &
PID_PTT=$!
tail_runpod_gateway &
PID_RUNPOD=$!
tail_vite_logs &
PID_VITE=$!
tail_playwright_logs &
PID_PW=$!

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  echo
  echo "$(ts) [system] ===== telemetry aggregator stopped =====" >> "$LOG_OUT"
  kill "$PID_INFERENCE" "$PID_PTT" "$PID_RUNPOD" "$PID_VITE" "$PID_PW" 2>/dev/null || true
  echo "[telemetry] Stopped. Log: ${LOG_OUT}"
}
trap cleanup EXIT INT TERM

# ── Heartbeat ─────────────────────────────────────────────────────────────────
while true; do
  rotate_if_large "$LOG_OUT"
  echo "$(ts) [system] heartbeat" >> "$LOG_OUT"
  sleep 60
done
