#!/usr/bin/env bash
set -euo pipefail

# One-shot bootstrap for GitHub Actions + Supabase runtime secrets.
#
# Usage:
#   export GH_PAT="ghp_..."
#   export SUPABASE_ACCESS_TOKEN="sbp_..."
#   export RAILWAY_BOB_TOKEN="..."
#   export RAILWAY_BOB_PROJECT_ID="..."
#   export RAILWAY_TOKEN="..."
#   export RAILWAY_INFERENCE_SERVICE_ID="..."
#   export RAILWAY_PROXY_SERVICE_ID="..."         # optional but recommended
#   export RAILWAY_PTT_SERVICE_ID="..."           # optional but recommended
#   export INFERENCE_SERVICE_URL="https://..."
#   export PROXY_SERVER_URL="https://..."         # optional but recommended
#   export PTT_SERVER_URL="https://..."           # optional but recommended
#   export INFERENCE_API_KEY="..."                # optional but recommended
#   ./scripts/bootstrap-runtime-secrets.sh

REPO="DonSquires/FreedomCamp-Manager"
PROJECT_REF="kxwjcupuxnnbnzcgmkoi"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() {
  echo -e "${RED}ERROR:${NC} $1" >&2
  exit 1
}

warn() {
  echo -e "${YELLOW}WARN:${NC} $1"
}

ok() {
  echo -e "${GREEN}OK:${NC} $1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

need_env() {
  local key="$1"
  [ -n "${!key:-}" ] || die "Missing required environment variable: $key"
}

set_gh_secret() {
  local key="$1"
  local val="$2"
  GH_TOKEN="$GH_PAT" gh secret set -R "$REPO" "$key" -b "$val" >/dev/null
  ok "GitHub secret set: $key"
}

set_supabase_secret() {
  local key="$1"
  local val="$2"
  SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" \
    supabase secrets set "$key=$val" --project-ref "$PROJECT_REF" >/dev/null
  ok "Supabase secret set: $key"
}

need_cmd gh
need_cmd supabase
need_cmd curl

need_env GH_PAT
need_env SUPABASE_ACCESS_TOKEN
need_env RAILWAY_BOB_TOKEN
need_env RAILWAY_BOB_PROJECT_ID
need_env RAILWAY_TOKEN
need_env RAILWAY_INFERENCE_SERVICE_ID
need_env INFERENCE_SERVICE_URL

# Optional, but very useful for complete wiring.
if [ -z "${RAILWAY_PROXY_SERVICE_ID:-}" ]; then
  warn "RAILWAY_PROXY_SERVICE_ID not set; proxy deploy workflow may still fail."
fi
if [ -z "${RAILWAY_PTT_SERVICE_ID:-}" ]; then
  warn "RAILWAY_PTT_SERVICE_ID not set; PTT deploy workflow may still fail."
fi
if [ -z "${PROXY_SERVER_URL:-}" ]; then
  warn "PROXY_SERVER_URL not set; wiring audit can fail for proxy URL checks."
fi
if [ -z "${PTT_SERVER_URL:-}" ]; then
  warn "PTT_SERVER_URL not set; wiring audit can fail for PTT URL checks."
fi
if [ -z "${INFERENCE_API_KEY:-}" ]; then
  warn "INFERENCE_API_KEY not set; edge-to-inference auth checks can fail."
fi

# Quick URL sanity checks (non-fatal for optional URLs).
curl -fsS "${INFERENCE_SERVICE_URL%/}/health" >/dev/null || die "INFERENCE_SERVICE_URL health check failed"
[ -z "${PROXY_SERVER_URL:-}" ] || curl -fsS "${PROXY_SERVER_URL%/}/health" >/dev/null || warn "PROXY_SERVER_URL health check failed"
[ -z "${PTT_SERVER_URL:-}" ] || curl -fsS "${PTT_SERVER_URL%/}/health" >/dev/null || warn "PTT_SERVER_URL health check failed"

echo "Applying GitHub Actions secrets..."
set_gh_secret "RAILWAY_BOB_TOKEN" "$RAILWAY_BOB_TOKEN"
set_gh_secret "RAILWAY_BOB_PROJECT_ID" "$RAILWAY_BOB_PROJECT_ID"
set_gh_secret "RAILWAY_TOKEN" "$RAILWAY_TOKEN"
set_gh_secret "RAILWAY_INFERENCE_SERVICE_ID" "$RAILWAY_INFERENCE_SERVICE_ID"
set_gh_secret "INFERENCE_SERVICE_URL" "$INFERENCE_SERVICE_URL"

[ -z "${RAILWAY_PROXY_SERVICE_ID:-}" ] || set_gh_secret "RAILWAY_PROXY_SERVICE_ID" "$RAILWAY_PROXY_SERVICE_ID"
[ -z "${RAILWAY_PTT_SERVICE_ID:-}" ] || set_gh_secret "RAILWAY_PTT_SERVICE_ID" "$RAILWAY_PTT_SERVICE_ID"
[ -z "${PROXY_SERVER_URL:-}" ] || set_gh_secret "PROXY_SERVER_URL" "$PROXY_SERVER_URL"
[ -z "${PTT_SERVER_URL:-}" ] || set_gh_secret "PTT_SERVER_URL" "$PTT_SERVER_URL"
[ -z "${INFERENCE_API_KEY:-}" ] || set_gh_secret "INFERENCE_API_KEY" "$INFERENCE_API_KEY"

echo "Applying Supabase Edge Function secrets..."
set_supabase_secret "INFERENCE_SERVICE_URL" "$INFERENCE_SERVICE_URL"
[ -z "${PROXY_SERVER_URL:-}" ] || set_supabase_secret "PROXY_SERVER_URL" "$PROXY_SERVER_URL"
[ -z "${PTT_SERVER_URL:-}" ] || set_supabase_secret "PTT_SERVER_URL" "$PTT_SERVER_URL"
[ -z "${INFERENCE_API_KEY:-}" ] || set_supabase_secret "INFERENCE_API_KEY" "$INFERENCE_API_KEY"

ok "Bootstrap complete."
echo "Next: run scripts/validate-railway-credentials.sh with the same env vars to verify full coverage."
