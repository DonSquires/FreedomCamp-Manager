#!/usr/bin/env bash
set -euo pipefail

echo "[start_mode] RunPod Serverless startup: launching long-running handler process"
echo "[start_mode] Default command is not a one-shot test runner; it must stay alive for job polling"
exec /usr/local/bin/start.sh
