#!/usr/bin/env sh
set -eu

# Verify a deployed inference service with /health and /infer calls.
# Usage:
#   INFERENCE_URL="https://your-service.up.railway.app" ./scripts/verify-remote-inference.sh
# Optional:
#   TIMEOUT=60 ./scripts/verify-remote-inference.sh

if [ "${INFERENCE_URL:-}" = "" ]; then
  echo "ERROR: INFERENCE_URL is required"
  echo "Example: INFERENCE_URL=https://orc-ai-inference-service-production.up.railway.app ./scripts/verify-remote-inference.sh"
  exit 1
fi

TIMEOUT="${TIMEOUT:-60}"

echo "== Inference Service Verification =="
echo "URL: $INFERENCE_URL"
echo "Timeout: ${TIMEOUT}s"
echo

echo "[1/2] Health check"
health_response="$(curl -sS -m "$TIMEOUT" "$INFERENCE_URL/health")"
echo "$health_response"
echo

echo "[2/2] Inference checks"

# Public test images with visible vehicles.
URL_1="https://images.unsplash.com/photo-1493238792000-8113da705763?w=1200"
URL_2="https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200"
URL_3="https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200"

run_test() {
  idx="$1"
  img_url="$2"
  tmp_file="/tmp/fcm-verify-${idx}.jpg"

  echo "-- test $idx"
  curl -sSL "$img_url" -o "$tmp_file"
  echo "image_size_bytes=$(wc -c < "$tmp_file")"

  infer_response="$(curl -sS -m "$TIMEOUT" -X POST "$INFERENCE_URL/infer" -F "photo=@$tmp_file")"
  echo "$infer_response"

  if command -v jq >/dev/null 2>&1; then
    ok="$(echo "$infer_response" | jq -r '.success // false' 2>/dev/null || echo false)"
    if [ "$ok" = "true" ]; then
      quality="$(echo "$infer_response" | jq -r '.data.embedding_quality // "n/a"')"
      confidence="$(echo "$infer_response" | jq -r '.data.detection.confidence // "n/a"')"
      dim="$(echo "$infer_response" | jq -r '.data.metadata.dimension // "n/a"')"
      time_ms="$(echo "$infer_response" | jq -r '.data.metadata.processing_time_ms // "n/a"')"
      echo "result=PASS quality=$quality confidence=$confidence dimension=$dim time_ms=$time_ms"
    else
      message="$(echo "$infer_response" | jq -r '.message // .error // "unknown error"' 2>/dev/null || echo "unknown error")"
      echo "result=FAIL reason=$message"
    fi
  fi

  echo
}

run_test 1 "$URL_1"
run_test 2 "$URL_2"
run_test 3 "$URL_3"

echo "Done."
