#!/usr/bin/env sh
set -eu

# Prevent floating image tags for RunPod worker deploy configs.
# The build workflow is allowed to publish :latest for compatibility,
# but runtime/deployment configs must use immutable tags or digests.

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

TARGETS=".github/workflows docs scripts runpod-worker runpod-gateway"
ALLOWLIST_FILE=".github/workflows/build-ai-worker.yml"

cd "$ROOT_DIR"

PATTERN='ghcr.io/donsquires/freedomcamp-manager-ai:latest|freedomcamp-manager-ai:latest'

MATCHES="$(grep -RInE --exclude="validate-runpod-image-tags.sh" "$PATTERN" $TARGETS 2>/dev/null || true)"

if [ -z "$MATCHES" ]; then
  echo "PASS: no floating RunPod worker image tags found."
  exit 0
fi

VIOLATIONS="$(echo "$MATCHES" | grep -v "$ALLOWLIST_FILE" || true)"

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: found disallowed floating image tag(s) for RunPod worker:"
  echo "$VIOLATIONS"
  echo ""
  echo "Use one of:"
  echo "- ghcr.io/donsquires/freedomcamp-manager-ai:sha-<commit-sha>"
  echo "- ghcr.io/donsquires/freedomcamp-manager-ai@sha256:<digest>"
  exit 1
fi

echo "PASS: only allowlisted build workflow references :latest."
