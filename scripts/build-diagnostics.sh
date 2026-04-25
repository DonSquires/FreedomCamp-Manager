#!/bin/sh

set -eu

OUT_DIR="${1:-tools/build-diagnostics}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="${OUT_DIR}/${STAMP}"
LOG_FILE="${RUN_DIR}/build.log"
META_FILE="${RUN_DIR}/meta.txt"
RESOURCE_FILE="${RUN_DIR}/resource.txt"

mkdir -p "$RUN_DIR"

{
  echo "timestamp_utc=$STAMP"
  echo "cwd=$(pwd)"
  echo "node=$(node -v 2>/dev/null || echo missing)"
  echo "npm=$(npm -v 2>/dev/null || echo missing)"
  echo "bun=$(bun -v 2>/dev/null || echo missing)"
  echo "uname=$(uname -a 2>/dev/null || echo unknown)"
  echo "meminfo_total_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo unknown)"
  echo "meminfo_available_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo unknown)"
} > "$META_FILE"

BUILD_CMD="npm run build"

echo "Running: $BUILD_CMD"
echo "Diagnostics output: $RUN_DIR"

if command -v /usr/bin/time >/dev/null 2>&1; then
  set +e
  /usr/bin/time -v sh -c "$BUILD_CMD" > "$LOG_FILE" 2> "$RESOURCE_FILE"
  CODE=$?
  set -e
else
  set +e
  sh -c "$BUILD_CMD" > "$LOG_FILE" 2>&1
  CODE=$?
  set -e
  echo "warning=/usr/bin/time not available" > "$RESOURCE_FILE"
fi

echo "exit_code=$CODE" >> "$META_FILE"

if [ "$CODE" -eq 0 ]; then
  echo "Build diagnostics run succeeded"
else
  echo "Build diagnostics run failed with exit code $CODE"
fi

echo "Artifacts:"
echo "- $META_FILE"
echo "- $LOG_FILE"
echo "- $RESOURCE_FILE"

exit "$CODE"
