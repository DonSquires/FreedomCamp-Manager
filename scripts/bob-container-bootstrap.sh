#!/usr/bin/env bash
set -euo pipefail

# Deterministic Bob-in-container bootstrap sequence for Railway-backed runtime.
#
# Purpose:
#   1) Normalize credential aliases into canonical names.
#   2) Validate Railway tokens/service IDs and reachable service URLs.
#   3) Verify Bob health + authenticated chat from this container.
#   4) Optionally run a direct Bob chat smoke check.
#
# Usage:
#   bash scripts/bob-container-bootstrap.sh --load-runtime
#   bash scripts/bob-container-bootstrap.sh --load-runtime --chat "status check"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOAD_RUNTIME="false"
CHAT_PROMPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --load-runtime)
      LOAD_RUNTIME="true"
      shift
      ;;
    --chat)
      CHAT_PROMPT="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/bob-container-bootstrap.sh [--load-runtime] [--chat <prompt>]" >&2
      exit 2
      ;;
  esac
done

log() { echo "[bob-bootstrap] $*"; }
warn() { echo "[bob-bootstrap][warn] $*"; }
fail() { echo "[bob-bootstrap][fail] $*"; }

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  log "Loading env file: $file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"

      if [[ "$val" =~ ^\".*\"$ ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:${#val}-2}"
      fi

      export "$key=$val"
    fi
  done < "$file"
}

if [[ "$LOAD_RUNTIME" == "true" ]]; then
  load_env_file "$ROOT_DIR/.runtime/bob-local-credentials.env"
  load_env_file "$ROOT_DIR/.runtime/railway-secrets.env"
  load_env_file "$ROOT_DIR/.env.local"
  load_env_file "$ROOT_DIR/inference-service/.env"
fi

# Normalize aliases to canonical names.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/load-railway-secrets-from-github-env.sh" --quiet

log "Step 1/4: Validate Railway credentials and service reachability"
if ! bash "$SCRIPT_DIR/validate-railway-credentials.sh"; then
  fail "Railway credential validation failed. Resolve missing/invalid values before continuing."
  exit 1
fi

log "Step 2/4: Verify Bob from container (health + authenticated chat + Railway API probes)"
if ! bash "$SCRIPT_DIR/bob-container-doctor.sh" --check-railway --check-railway-api; then
  fail "Bob doctor checks failed. Fix connectivity/auth and rerun bootstrap."
  exit 1
fi

if [[ -n "$CHAT_PROMPT" ]]; then
  log "Step 3/4: Run explicit Bob chat prompt"
  if ! node "$SCRIPT_DIR/ask-bob.mjs" "$CHAT_PROMPT"; then
    fail "Explicit Bob chat check failed."
    exit 1
  fi
else
  log "Step 3/4: No explicit chat prompt provided; skipping extra chat check"
fi

log "Step 4/4: Bootstrap complete"
log "Bob is reachable from this container with current Railway-backed credentials."

log "Suggested next commands:"
log "  node scripts/ask-bob.mjs \"Give me a one-line operational status\""
log "  node scripts/talk-with-bob.mjs"
