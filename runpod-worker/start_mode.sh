#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────
# DEPRECATED: start_mode.sh is no longer used in the serverless Docker image.
#
# The Dockerfile CMD runs `python3 -u handler.py` directly.
# This script previously routed to start.sh but is now unused.
#
# Serverless configuration: Railway external Ollama only (no local Ollama).
# ───────────────────────────────────────────────────────────────────────────
echo "[start_mode] ERROR: This script must not be called in serverless mode."
echo "[start_mode] The Docker image CMD is: python3 -u handler.py"
exit 1
