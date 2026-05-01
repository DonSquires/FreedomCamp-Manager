#!/usr/bin/env bash
set -euo pipefail

MODE="${RUNPOD_RUNTIME_MODE:-auto}"

normalize_mode() {
  local raw="${1:-auto}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$raw" in
    auto|pod|serverless) printf '%s' "$raw" ;;
    *)
      echo "[start_mode] WARN: unknown RUNPOD_RUNTIME_MODE='$raw', using auto"
      printf 'auto'
      ;;
  esac
}

pick_auto_mode() {
  if [[ -n "${RUNPOD_WEBHOOK_GET_JOB:-}" && -n "${RUNPOD_WEBHOOK_POST_OUTPUT:-}" ]]; then
    printf 'serverless'
  else
    printf 'pod'
  fi
}

MODE="$(normalize_mode "$MODE")"
if [[ "$MODE" == "auto" ]]; then
  MODE="$(pick_auto_mode)"
fi

echo "[start_mode] Selected runtime mode: ${MODE}"

if [[ "$MODE" == "serverless" ]]; then
  echo "[start_mode] Launching serverless worker startup path (/usr/local/bin/start.sh)"
  exec /usr/local/bin/start.sh
fi

if [[ -x /usr/local/bin/pod_start.sh ]]; then
  echo "[start_mode] Launching pod runtime startup path (/usr/local/bin/pod_start.sh)"
  exec /usr/local/bin/pod_start.sh
fi

echo "[start_mode] WARN: pod_start.sh not found; falling back to always-on ollama serve"
exec ollama serve
