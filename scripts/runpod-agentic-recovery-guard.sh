#!/usr/bin/env bash
set -euo pipefail

# Agentic recovery guard for RunPod serverless endpoints.
# Behavior:
# - Probe each endpoint with hard network timeouts.
# - If probe completes, auto-approve by keeping workersMax=1.
# - If probe stays queued/times out/fails, auto-rollback to workersMax=0.

API_KEY="${RUNPOD_API_KEY:-${INFERENCE_API_KEY:-${RUNPOD_ENDPOINT_API_KEY:-}}}"
if [[ -z "$API_KEY" ]]; then
  echo "[guard] missing RUNPOD API key" >&2
  exit 1
fi

# STT endpoint removed — STT is now served by Railway (railway-stt/).
# Only the AI inference endpoint is managed here.
ENDPOINTS="${RUNPOD_RECOVERY_ENDPOINTS:-n0bp1ifmq01cx2:ai}"
INTERVAL_SEC="${RUNPOD_RECOVERY_INTERVAL_SEC:-120}"
POLL_ROUNDS="${RUNPOD_RECOVERY_POLL_ROUNDS:-12}"
POLL_SLEEP_SEC="${RUNPOD_RECOVERY_POLL_SLEEP_SEC:-5}"
REST_TIMEOUT_SEC="${RUNPOD_RECOVERY_REST_TIMEOUT_SEC:-10}"
RUN_TIMEOUT_SEC="${RUNPOD_RECOVERY_RUN_TIMEOUT_SEC:-10}"
STATUS_TIMEOUT_SEC="${RUNPOD_RECOVERY_STATUS_TIMEOUT_SEC:-8}"

log() {
  echo "[guard $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

patch_workers() {
  local endpoint_id="$1"
  local min="$2"
  local max="$3"
  curl -sS --max-time "${REST_TIMEOUT_SEC}" -X PATCH "https://rest.runpod.io/v1/endpoints/${endpoint_id}" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "{\"workersMin\":${min},\"workersMax\":${max}}" >/dev/null
}

submit_probe() {
  local endpoint_id="$1"
  local kind="$2"
  local payload
  if [[ "$kind" == "stt" ]]; then
    payload='{"input":{"audio_b64":"UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="}}'
  else
    payload='{"input":{"action":"ping","message":"health probe"}}'
  fi

  curl -sS --max-time "${RUN_TIMEOUT_SEC}" -X POST "https://api.runpod.ai/v2/${endpoint_id}/run" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$payload"
}

job_id_from_json() {
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p'
}

job_status_from_json() {
  sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -n1
}

cancel_job() {
  local endpoint_id="$1"
  local job_id="$2"
  [[ -z "$job_id" ]] && return 0
  curl -sS --max-time "${STATUS_TIMEOUT_SEC}" -X POST "https://api.runpod.ai/v2/${endpoint_id}/cancel/${job_id}" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H 'Content-Type: application/json' \
    -d '{}' >/dev/null || true
}

probe_endpoint() {
  local endpoint_id="$1"
  local kind="$2"

  log "endpoint=${endpoint_id} kind=${kind} probe-start"

  # Open a probe window (allow one worker)
  if ! patch_workers "$endpoint_id" 0 1; then
    log "endpoint=${endpoint_id} patch workersMax=1 failed, forcing idle"
    patch_workers "$endpoint_id" 0 0 || true
    return 1
  fi

  local submit
  if ! submit=$(submit_probe "$endpoint_id" "$kind"); then
    log "endpoint=${endpoint_id} submit failed, forcing idle"
    patch_workers "$endpoint_id" 0 0 || true
    return 1
  fi

  local job_id
  job_id=$(printf '%s' "$submit" | job_id_from_json)
  if [[ -z "$job_id" ]]; then
    log "endpoint=${endpoint_id} missing job id, forcing idle"
    patch_workers "$endpoint_id" 0 0 || true
    return 1
  fi

  local status=""
  local i
  for ((i=1; i<=POLL_ROUNDS; i++)); do
    local st_json
    if ! st_json=$(curl -sS --max-time "${STATUS_TIMEOUT_SEC}" "https://api.runpod.ai/v2/${endpoint_id}/status/${job_id}" -H "Authorization: Bearer ${API_KEY}"); then
      status="NETWORK_ERROR"
      break
    fi

    status=$(printf '%s' "$st_json" | job_status_from_json)
    case "$status" in
      COMPLETED)
        log "endpoint=${endpoint_id} probe=COMPLETED action=approved"
        patch_workers "$endpoint_id" 0 1 || true
        return 0
        ;;
      FAILED|CANCELLED|TIMED_OUT)
        log "endpoint=${endpoint_id} probe=${status} action=rollback-idle"
        cancel_job "$endpoint_id" "$job_id"
        patch_workers "$endpoint_id" 0 0 || true
        return 1
        ;;
      *)
        # IN_QUEUE / IN_PROGRESS / unknown
        ;;
    esac

    sleep "$POLL_SLEEP_SEC"
  done

  log "endpoint=${endpoint_id} probe=${status:-POLL_TIMEOUT} action=rollback-idle"
  cancel_job "$endpoint_id" "$job_id"
  patch_workers "$endpoint_id" 0 0 || true
  return 1
}

log "start endpoints=${ENDPOINTS} interval_sec=${INTERVAL_SEC}"

while true; do
  IFS=',' read -r -a pairs <<< "$ENDPOINTS"
  for pair in "${pairs[@]}"; do
    pair_trimmed="$(echo "$pair" | xargs)"
    [[ -z "$pair_trimmed" ]] && continue
    endpoint_id="${pair_trimmed%%:*}"
    kind="${pair_trimmed##*:}"
    [[ -z "$endpoint_id" ]] && continue
    [[ "$kind" == "$endpoint_id" ]] && kind="ai"
    probe_endpoint "$endpoint_id" "$kind" || true
  done

  sleep "$INTERVAL_SEC"
done
