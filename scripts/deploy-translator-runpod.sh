#!/usr/bin/env bash
set -euo pipefail

# Deploy a dedicated Translator pod on RunPod.
# This wraps scripts/create-runpod-pods.mjs with translator-specific defaults.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXTERNAL_TRANSLATOR_TEMPLATE_ID="${TRANSLATOR_TEMPLATE_ID-}"
EXTERNAL_RUNPOD_TRANSLATOR_TEMPLATE_ID="${RUNPOD_TRANSLATOR_TEMPLATE_ID-}"
EXTERNAL_TRANSLATOR_GPU_TYPE_ID="${TRANSLATOR_GPU_TYPE_ID-}"
EXTERNAL_TRANSLATOR_COUNT="${TRANSLATOR_COUNT-}"
EXTERNAL_TRANSLATOR_NAME_PREFIX="${TRANSLATOR_NAME_PREFIX-}"
EXTERNAL_TRANSLATOR_CLOUD_TYPE="${TRANSLATOR_CLOUD_TYPE-}"
EXTERNAL_TRANSLATOR_VOLUME_GB="${TRANSLATOR_VOLUME_GB-}"
EXTERNAL_TRANSLATOR_CONTAINER_DISK_GB="${TRANSLATOR_CONTAINER_DISK_GB-}"
EXTERNAL_TRANSLATOR_DRY_RUN="${TRANSLATOR_DRY_RUN-}"

if [[ -f .runtime/translator.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .runtime/translator.env
  set +a
fi

if [[ -n "${EXTERNAL_TRANSLATOR_TEMPLATE_ID}" ]]; then
  TRANSLATOR_TEMPLATE_ID="${EXTERNAL_TRANSLATOR_TEMPLATE_ID}"
fi
if [[ -n "${EXTERNAL_RUNPOD_TRANSLATOR_TEMPLATE_ID}" ]]; then
  RUNPOD_TRANSLATOR_TEMPLATE_ID="${EXTERNAL_RUNPOD_TRANSLATOR_TEMPLATE_ID}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_GPU_TYPE_ID}" ]]; then
  TRANSLATOR_GPU_TYPE_ID="${EXTERNAL_TRANSLATOR_GPU_TYPE_ID}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_COUNT}" ]]; then
  TRANSLATOR_COUNT="${EXTERNAL_TRANSLATOR_COUNT}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_NAME_PREFIX}" ]]; then
  TRANSLATOR_NAME_PREFIX="${EXTERNAL_TRANSLATOR_NAME_PREFIX}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_CLOUD_TYPE}" ]]; then
  TRANSLATOR_CLOUD_TYPE="${EXTERNAL_TRANSLATOR_CLOUD_TYPE}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_VOLUME_GB}" ]]; then
  TRANSLATOR_VOLUME_GB="${EXTERNAL_TRANSLATOR_VOLUME_GB}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_CONTAINER_DISK_GB}" ]]; then
  TRANSLATOR_CONTAINER_DISK_GB="${EXTERNAL_TRANSLATOR_CONTAINER_DISK_GB}"
fi
if [[ -n "${EXTERNAL_TRANSLATOR_DRY_RUN}" ]]; then
  TRANSLATOR_DRY_RUN="${EXTERNAL_TRANSLATOR_DRY_RUN}"
fi

TRANSLATOR_TEMPLATE_ID="${TRANSLATOR_TEMPLATE_ID:-${RUNPOD_TRANSLATOR_TEMPLATE_ID:-}}"

if [[ -z "${RUNPOD_API_KEY:-}" ]]; then
  echo "ERROR: RUNPOD_API_KEY is required"
  exit 1
fi

if [[ -z "${TRANSLATOR_TEMPLATE_ID:-}" ]]; then
  echo "ERROR: TRANSLATOR_TEMPLATE_ID is required"
  echo "Set TRANSLATOR_TEMPLATE_ID to a RunPod template configured for ptt-bridge-python image."
  exit 1
fi

if [[ -z "${TRANSLATOR_GPU_TYPE_ID:-}" ]]; then
  echo "ERROR: TRANSLATOR_GPU_TYPE_ID is required"
  echo "Example values: NVIDIA_RTX_A4000, NVIDIA_GEFORCE_RTX_4090, NVIDIA_L40S"
  exit 1
fi

TRANSLATOR_COUNT="${TRANSLATOR_COUNT:-1}"
TRANSLATOR_NAME_PREFIX="${TRANSLATOR_NAME_PREFIX:-bob-translator}"
TRANSLATOR_CLOUD_TYPE="${TRANSLATOR_CLOUD_TYPE:-SECURE}"
TRANSLATOR_VOLUME_GB="${TRANSLATOR_VOLUME_GB:-120}"
TRANSLATOR_CONTAINER_DISK_GB="${TRANSLATOR_CONTAINER_DISK_GB:-40}"
TRANSLATOR_DRY_RUN="${TRANSLATOR_DRY_RUN:-false}"

echo "Deploying translator pod(s) with settings:"
echo "  template:       ${TRANSLATOR_TEMPLATE_ID}"
echo "  gpu:            ${TRANSLATOR_GPU_TYPE_ID}"
echo "  count:          ${TRANSLATOR_COUNT}"
echo "  name prefix:    ${TRANSLATOR_NAME_PREFIX}"
echo "  cloud type:     ${TRANSLATOR_CLOUD_TYPE}"
echo "  volume (GB):    ${TRANSLATOR_VOLUME_GB}"
echo "  container disk: ${TRANSLATOR_CONTAINER_DISK_GB}"
echo "  dry run:        ${TRANSLATOR_DRY_RUN}"

RUNPOD_GRAPHQL_URL="https://api.runpod.io/graphql"
ME_QUERY='query Me { myself { id email } }'

AUTH_PAYLOAD=$(curl -fsSL -X POST "$RUNPOD_GRAPHQL_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d "{\"query\":$(printf '%s' "$ME_QUERY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" )

AUTH_EMAIL=$(printf '%s' "$AUTH_PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(((d.get("data") or {}).get("myself") or {}).get("email") or "")')
if [[ -z "$AUTH_EMAIL" ]]; then
  echo "ERROR: Unable to verify RunPod credentials"
  echo "$AUTH_PAYLOAD"
  exit 1
fi

echo "Authenticated as: ${AUTH_EMAIL}"

for ((i=1; i<=TRANSLATOR_COUNT; i++)); do
  POD_NAME="${TRANSLATOR_NAME_PREFIX}_${i}"
  echo "Creating translator pod ${i}/${TRANSLATOR_COUNT}: ${POD_NAME}"

  if [[ "$TRANSLATOR_DRY_RUN" == "true" ]]; then
    echo "[dry-run] Would create pod: ${POD_NAME}"
    continue
  fi

  MUTATION='mutation DeployPod($input: PodFindAndDeployOnDemandInput!) { podFindAndDeployOnDemand(input: $input) { id name imageName desiredStatus machineId } }'
  VARIABLES=$(python3 - <<PY
import json
print(json.dumps({
  "input": {
    "cloudType": "${TRANSLATOR_CLOUD_TYPE}",
    "gpuTypeId": "${TRANSLATOR_GPU_TYPE_ID}",
    "name": "${POD_NAME}",
    "templateId": "${TRANSLATOR_TEMPLATE_ID}",
    "containerDiskInGb": int(${TRANSLATOR_CONTAINER_DISK_GB}),
    "volumeInGb": int(${TRANSLATOR_VOLUME_GB}),
  }
}))
PY
)

  RESPONSE=$(curl -fsSL -X POST "$RUNPOD_GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
    -d "{\"query\":$(printf '%s' "$MUTATION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"variables\":${VARIABLES}}")

  POD_ID=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((((d.get("data") or {}).get("podFindAndDeployOnDemand") or {}).get("id") or ""))')
  POD_STATUS=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((((d.get("data") or {}).get("podFindAndDeployOnDemand") or {}).get("desiredStatus") or ""))')
  if [[ -z "$POD_ID" ]]; then
    echo "ERROR: RunPod API did not return a pod id"
    echo "$RESPONSE"
    exit 1
  fi

  echo "Created: ${POD_NAME} (${POD_ID}) status=${POD_STATUS}"
done
