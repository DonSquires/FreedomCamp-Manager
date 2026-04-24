#!/usr/bin/env bash
set -euo pipefail

# One-off secret/bootstrap helper for GitHub Actions, Supabase Edge Function secrets,
# and Railway service variables. Values are sourced from existing environment
# variables where available, with secure random defaults generated for internal keys.
# Example:
#   export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

rand_hex_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
}

PROJECT_REF="${SUPABASE_PROJECT_REF:-kxwjcupuxnnbnzcgmkoi}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
VAPID_SUBJECT="${VAPID_SUBJECT:-mailto:admin@fcmanager.co.nz}"

INFERENCE_SERVICE_URL="${INFERENCE_SERVICE_URL:-${VITE_INFERENCE_SERVICE_URL:-}}"
PROXY_SERVER_URL="${PROXY_SERVER_URL:-${VITE_PROXY_SERVER_URL:-}}"
PTT_SERVER_URL="${PTT_SERVER_URL:-${VITE_PTT_SERVER_URL:-}}"

INFERENCE_API_KEY="${INFERENCE_API_KEY:-$(rand_hex_32)}"
PTT_PROXY_SECRET="${PTT_PROXY_SECRET:-$(rand_hex_32)}"
PTT_JWT_SECRET="${PTT_JWT_SECRET:-$(rand_hex_32)}"
INTEL_HMAC_KEY="${INTEL_HMAC_KEY:-$(rand_hex_32)}"
PROXY_SECRET="${PROXY_SECRET:-$PTT_PROXY_SECRET}"

VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}"
VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY:-}"

STATUS_GH="skipped"
STATUS_SUPABASE="skipped"
STATUS_RAILWAY="skipped"

log() {
  printf '%s\n' "$*"
}

set_gh_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    return 0
  fi
  gh secret set "$name" --app actions >/dev/null <<<"$value"
}

set_railway_secret() {
  local service_id="$1"
  local key="$2"
  local value="$3"
  if [[ -z "$service_id" || -z "$value" ]]; then
    return 0
  fi
  printf '%s' "$value" | railway variable set "$key" --stdin \
    --service "$service_id" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --skip-deploys >/dev/null
}

generate_vapid_keys() {
  local output
  output="$(node - <<'NODE'
const { generateKeyPairSync } = require('node:crypto')

function b64urlToBuffer(input) {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=')
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { format: 'jwk' },
  privateKeyEncoding: { format: 'jwk' },
})

if (!publicKey.x || !publicKey.y || !privateKey.d) {
  throw new Error('Failed to generate VAPID key material')
}

const x = b64urlToBuffer(publicKey.x)
const y = b64urlToBuffer(publicKey.y)
const d = b64urlToBuffer(privateKey.d)
const pub = Buffer.concat([Buffer.from([0x04]), x, y])

console.log(`VAPID_PUBLIC_KEY=${toBase64Url(pub)}`)
console.log(`VAPID_PRIVATE_KEY=${toBase64Url(d)}`)
NODE
)"

  VAPID_PUBLIC_KEY="$(printf '%s\n' "$output" | sed -n 's/^VAPID_PUBLIC_KEY=//p')"
  VAPID_PRIVATE_KEY="$(printf '%s\n' "$output" | sed -n 's/^VAPID_PRIVATE_KEY=//p')"
}

if [[ -z "$VAPID_PUBLIC_KEY" || -z "$VAPID_PRIVATE_KEY" ]]; then
  generate_vapid_keys
fi

log "Starting one-off secret bootstrap..."

# GitHub Actions secrets
if gh auth status >/dev/null 2>&1; then
  if gh api repos/DonSquires/FreedomCamp-Manager/actions/secrets/public-key >/dev/null 2>&1; then
    if set_gh_secret INFERENCE_API_KEY "$INFERENCE_API_KEY" \
      && set_gh_secret PTT_PROXY_SECRET "$PTT_PROXY_SECRET" \
      && set_gh_secret PTT_JWT_SECRET "$PTT_JWT_SECRET" \
      && set_gh_secret INTEL_HMAC_KEY "$INTEL_HMAC_KEY" \
      && set_gh_secret INFERENCE_SERVICE_URL "$INFERENCE_SERVICE_URL" \
      && set_gh_secret PROXY_SERVICE_URL "$PROXY_SERVER_URL" \
      && set_gh_secret PTT_SERVER_URL "$PTT_SERVER_URL"; then
      STATUS_GH="ok"
    else
      STATUS_GH="failed"
    fi
  else
    STATUS_GH="forbidden (needs PAT with actions secrets write)"
  fi
else
  STATUS_GH="unauthenticated"
fi

# Supabase edge function secrets
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  supabase_pairs=(
    "INFERENCE_API_KEY=$INFERENCE_API_KEY"
    "PTT_PROXY_SECRET=$PTT_PROXY_SECRET"
    "PTT_JWT_SECRET=$PTT_JWT_SECRET"
    "INTEL_HMAC_KEY=$INTEL_HMAC_KEY"
    "VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY"
    "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY"
    "VAPID_SUBJECT=$VAPID_SUBJECT"
  )
  [[ -n "$INFERENCE_SERVICE_URL" ]] && supabase_pairs+=("INFERENCE_SERVICE_URL=$INFERENCE_SERVICE_URL")
  [[ -n "$PROXY_SERVER_URL" ]] && supabase_pairs+=("PROXY_SERVER_URL=$PROXY_SERVER_URL" "NZSCV_PROXY_URL=$PROXY_SERVER_URL")
  [[ -n "$PTT_SERVER_URL" ]] && supabase_pairs+=("PTT_SERVER_URL=$PTT_SERVER_URL")

  if supabase secrets set --project-ref "$PROJECT_REF" "${supabase_pairs[@]}" >/dev/null; then
    STATUS_SUPABASE="ok"
  else
    STATUS_SUPABASE="failed"
  fi
else
  STATUS_SUPABASE="missing SUPABASE_ACCESS_TOKEN"
fi

# Railway service vars
if railway whoami >/dev/null 2>&1; then
  if set_railway_secret "${RAILWAY_INFERENCE_SERVICE_ID:-}" INFERENCE_API_KEY "$INFERENCE_API_KEY" \
    && set_railway_secret "${RAILWAY_INFERENCE_SERVICE_ID:-}" INTEL_HMAC_KEY "$INTEL_HMAC_KEY" \
    && set_railway_secret "${RAILWAY_PTT_SERVICE_ID:-}" PROXY_SECRET "$PTT_PROXY_SECRET" \
    && set_railway_secret "${RAILWAY_PTT_SERVICE_ID:-}" PTT_JWT_SECRET "$PTT_JWT_SECRET" \
    && set_railway_secret "${RAILWAY_PROXY_SERVICE_ID:-}" PROXY_SECRET "$PROXY_SECRET"; then
    STATUS_RAILWAY="ok"
  else
    STATUS_RAILWAY="failed"
  fi
else
  STATUS_RAILWAY="unauthenticated"
fi

log ""
log "Bootstrap summary:"
log "  GitHub Actions secrets: $STATUS_GH"
log "  Supabase secrets:       $STATUS_SUPABASE"
log "  Railway variables:      $STATUS_RAILWAY"
log ""
log "Generated/used internal secrets in this run:"
log "  INFERENCE_API_KEY"
log "  PTT_PROXY_SECRET"
log "  PTT_JWT_SECRET"
log "  INTEL_HMAC_KEY"
log "  VAPID_PUBLIC_KEY"
log "  VAPID_PRIVATE_KEY"

if [[ "$STATUS_GH" != "ok" || "$STATUS_SUPABASE" != "ok" || "$STATUS_RAILWAY" != "ok" ]]; then
  exit 2
fi
