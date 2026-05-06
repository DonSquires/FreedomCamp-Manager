#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────
# DEPRECATED: start.sh is no longer used in the serverless Docker image.
#
# The Dockerfile CMD now runs `python3 -u handler.py` directly.
# This script is kept for reference only and must not be called.
#
# Serverless configuration: Railway external Ollama only (no local Ollama).
# For SPOT pod variants with local inference, reference pod_start.sh instead.
# ───────────────────────────────────────────────────────────────────────────
echo "[worker] ERROR: This script (start.sh) must not be called."
echo "[worker] The serverless Docker image runs: python3 -u handler.py"
echo "[worker] No startup scripts are used in serverless mode."
exit 1
