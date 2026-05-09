#!/usr/bin/env bash
set -euo pipefail

# Normalize credentials from GitHub Actions env/secrets into canonical names.
# This script does not call GitHub APIs; it only uses env vars already injected
# into the job from `secrets.*`.
#
# Usage examples:
#   source ./scripts/load-railway-secrets-from-github-env.sh
#   ./scripts/load-railway-secrets-from-github-env.sh --run "bash scripts/validate-railway-credentials.sh"

QUIET="false"
RUN_CMD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet)
      QUIET="true"
      shift
      ;;
    --run)
      RUN_CMD="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

pick_first() {
  local key
  for key in "$@"; do
    if [[ -n "${!key:-}" ]]; then
      printf "%s" "${!key}"
      return 0
    fi
  done
  return 1
}

set_if_present() {
  local target="$1"
  shift
  local val=""
  if val="$(pick_first "$@")"; then
    export "$target=$val"
    # Persist for later workflow steps when running in GitHub Actions.
    if [[ -n "${GITHUB_ENV:-}" ]]; then
      {
        printf "%s<<EOF\n" "$target"
        printf "%s\n" "$val"
        printf "EOF\n"
      } >> "$GITHUB_ENV"
    fi
    # Mask in workflow logs when available.
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      printf "::add-mask::%s\n" "$val"
    fi
    if [[ "$QUIET" != "true" ]]; then
      echo "resolved: $target"
    fi
    return 0
  fi

  if [[ "$QUIET" != "true" ]]; then
    echo "missing: $target"
  fi
  return 1
}

# Bob + Ollama project credentials
# Canonical: RAILWAY_BOB_TOKEN  |  @deprecated aliases: RAILWAY_TOKEN_BOB, RAILWAY_ORC_TOKEN
# Local fallback: RAILWAY_TOKEN when only one Railway token is available.
set_if_present RAILWAY_BOB_TOKEN RAILWAY_BOB_TOKEN RAILWAY_TOKEN_BOB RAILWAY_ORC_TOKEN RAILWAY_TOKEN || true
# Canonical: RAILWAY_BOB_PROJECT_ID | @deprecated alias: RAILWAY_ORC_PROJECT_ID
set_if_present RAILWAY_BOB_PROJECT_ID RAILWAY_BOB_PROJECT_ID RAILWAY_ORC_PROJECT_ID || true
# Canonical: RAILWAY_BOB_SERVICE_ID  |  @deprecated alias: RAILWAY_SERVICE_ID
set_if_present RAILWAY_BOB_SERVICE_ID RAILWAY_BOB_SERVICE_ID RAILWAY_SERVICE_ID || true
# Canonical: RAILWAY_BOB_SERVICE_NAME | @deprecated alias: RAILWAY_ORC_SERVICE_NAME
set_if_present RAILWAY_BOB_SERVICE_NAME RAILWAY_BOB_SERVICE_NAME RAILWAY_ORC_SERVICE_NAME || true
set_if_present RAILWAY_OLLAMA_SERVICE_ID RAILWAY_OLLAMA_SERVICE_ID || true

# Core project credentials
# Canonical: RAILWAY_TOKEN  |  @deprecated alias: RAILWAY_CORE_TOKEN
# Fallback: RAILWAY_BOB_TOKEN for shared-project setups where one token has deploy scope.
set_if_present RAILWAY_TOKEN RAILWAY_TOKEN RAILWAY_CORE_TOKEN RAILWAY_BOB_TOKEN || true
set_if_present RAILWAY_INFERENCE_SERVICE_ID RAILWAY_INFERENCE_SERVICE_ID || true
set_if_present RAILWAY_PROXY_SERVICE_ID RAILWAY_PROXY_SERVICE_ID || true
set_if_present RAILWAY_PTT_SERVICE_ID RAILWAY_PTT_SERVICE_ID || true

# Runtime URL/API secrets
# Canonical: VITE_SUPABASE_URL  |  @deprecated alias: SUPABASE_URL
set_if_present VITE_SUPABASE_URL VITE_SUPABASE_URL SUPABASE_URL || true
# Canonical: INFERENCE_SERVICE_URL / BOB_SERVICE_URL (both accepted; set both to same value)
set_if_present INFERENCE_SERVICE_URL INFERENCE_SERVICE_URL BOB_SERVICE_URL || true
set_if_present BOB_SERVICE_URL BOB_SERVICE_URL INFERENCE_SERVICE_URL || true
# Canonical: PROXY_SERVER_URL  |  @deprecated aliases: PROXY_SERVICE_URL, NZSCV_PROXY_URL
set_if_present PROXY_SERVER_URL PROXY_SERVER_URL PROXY_SERVICE_URL NZSCV_PROXY_URL || true
# Canonical: PTT_SERVER_URL  |  @deprecated alias: PTT_SERVICE_URL
set_if_present PTT_SERVER_URL PTT_SERVER_URL PTT_SERVICE_URL || true
# Canonical: INFERENCE_API_KEY  |  @deprecated alias: BOB_INFERENCE_API_KEY
set_if_present INFERENCE_API_KEY INFERENCE_API_KEY BOB_INFERENCE_API_KEY || true
set_if_present BOB_INFERENCE_API_KEY BOB_INFERENCE_API_KEY INFERENCE_API_KEY || true

if [[ -n "$RUN_CMD" ]]; then
  eval "$RUN_CMD"
fi
