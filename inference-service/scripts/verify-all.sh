#!/usr/bin/env sh
set -eu

# Run full post-deploy verification for inference + Supabase edge wiring.
# Required:
#   INFERENCE_URL
#   SUPABASE_URL
# Optional:
#   SUPABASE_KEY
#   TIMEOUT
#
# Example:
#   INFERENCE_URL="https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync" \
#   SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co" \
#   ./scripts/verify-all.sh

if [ "${INFERENCE_URL:-}" = "" ]; then
  echo "ERROR: INFERENCE_URL is required"
  exit 1
fi

if [ "${SUPABASE_URL:-}" = "" ]; then
  echo "ERROR: SUPABASE_URL is required"
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

echo "== Full Pipeline Verification =="
echo "INFERENCE_URL: $INFERENCE_URL"
echo "SUPABASE_URL: $SUPABASE_URL"
if [ -n "${SUPABASE_KEY:-}" ]; then
  echo "SUPABASE_KEY: provided"
else
  echo "SUPABASE_KEY: not provided"
fi
echo

echo "[1/2] Remote inference verification"
INFERENCE_URL="$INFERENCE_URL" TIMEOUT="${TIMEOUT:-60}" "$SCRIPT_DIR/verify-remote-inference.sh"
echo

echo "[2/2] Supabase pipeline verification"
if [ -n "${SUPABASE_KEY:-}" ]; then
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_KEY="$SUPABASE_KEY" TIMEOUT="${TIMEOUT:-30}" "$SCRIPT_DIR/verify-supabase-pipeline.sh"
else
  SUPABASE_URL="$SUPABASE_URL" TIMEOUT="${TIMEOUT:-30}" "$SCRIPT_DIR/verify-supabase-pipeline.sh"
fi

echo
echo "All verification steps completed."
