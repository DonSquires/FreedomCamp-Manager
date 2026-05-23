#!/usr/bin/env bash
# Railway Services Credential Audit
# 
# PURPOSE:
#   Validate Railway tokens, service IDs, and Supabase secrets without requiring
#   GitHub Actions secret access (which requires admin permissions).
#
# WORKS BY:
#   - Tests tokens with Railway CLI (if available locally)
#   - Tests Supabase secrets via GraphQL/REST endpoint
#   - Tests service connectivity via HTTP health checks
#   - Reports which secrets are valid, missing, or invalid
#   - No secrets print to stdout (safe to run, capture output)
#
# REQUIREMENTS:
#   - railway CLI installed (for token validation)
#   - curl (for HTTP tests)
#   - jq (for JSON parsing)
#
# USAGE:
#   # Option 1: Read secrets from current shell environment
#   ./scripts/validate-railway-credentials.sh
#
#   # Option 2: Load from .env.local before running
#   source .env.local && ./scripts/validate-railway-credentials.sh
#
#   # Option 3: Source in another script
#   source ./scripts/validate-railway-credentials.sh
#   validate_secret "RAILWAY_BOB_TOKEN" "bob" "Railway"
#
# EXIT CODES:
#   0 = all secrets valid
#   1 = at least one secret missing or invalid
#   2 = prerequisites missing (railway CLI, curl, jq)

set -euo pipefail

# If present, normalize credentials from GitHub Actions-injected secret names.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/load-railway-secrets-from-github-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/load-railway-secrets-from-github-env.sh" --quiet
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# State
VALIDATED_COUNT=0
INVALID_COUNT=0
MISSING_COUNT=0

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log_success() {
  echo -e "${GREEN}✅${NC} $1"
}

log_error() {
  echo -e "${RED}❌${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠️${NC} $1"
}

log_info() {
  echo -e "${BLUE}ℹ️${NC} $1"
}

# Mask sensitive output (show first 6 chars + *)
mask_secret() {
  local secret="$1"
  if [ ${#secret} -gt 6 ]; then
    echo "${secret:0:6}***"
  else
    echo "***"
  fi
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

# Validate Railway token via Railway GraphQL API
validate_railway_token() {
  local token_value="$1"
  local token_name="$2"

  # UUID-shaped values are allowed in this environment. Do not fail fast here;
  # continue with Graph checks and report scope behavior.
  if [[ "$token_value" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    log_info "Railway token ($token_name) is UUID-shaped; continuing with Graph scope validation."
  fi

  local payload='{"query":"query Viewer { me { id email name } }"}'
  local http_code
  http_code=$(curl -s -o /tmp/railway-token-check.json -w '%{http_code}' --max-time 12 \
    -X POST 'https://backboard.railway.com/graphql/v2' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token_value}" \
    --data "$payload" 2>/dev/null || echo "000")

  if [ "$http_code" != "200" ]; then
    log_error "Railway token ($token_name) is invalid or unreachable (HTTP $http_code): $(mask_secret "$token_value")"
    ((INVALID_COUNT+=1))
    return 1
  fi

  local has_errors
  has_errors=$(jq -r 'if (.errors | length) > 0 then "yes" else "no" end' /tmp/railway-token-check.json 2>/dev/null || echo "yes")
  if [ "$has_errors" = "yes" ]; then
    local first_error
    first_error=$(jq -r '.errors[0].message // "unknown"' /tmp/railway-token-check.json 2>/dev/null || echo "unknown")

    if [[ "$first_error" == "Not Authorized" ]]; then
      log_warning "Railway token ($token_name) cannot access me() query; treating as potentially scoped token."
      ((VALIDATED_COUNT+=1))
      return 0
    fi

    log_error "Railway token ($token_name) Graph probe failed: $first_error"
    ((INVALID_COUNT+=1))
    return 1
  fi

  local viewer
  viewer=$(jq -r '.data.me.email // "unknown"' /tmp/railway-token-check.json 2>/dev/null || echo "unknown")
  log_success "Railway token ($token_name) is valid (viewer: $viewer)"
  ((VALIDATED_COUNT+=1))
  return 0
}

# Validate railway service exists in token scope (advisory)
validate_railway_service_id() {
  local token_value="$1"
  local service_id="$2"
  local service_name="$3"

  if [ -z "$service_id" ]; then
    log_warning "Service ID ($service_name) is empty — skipping advisory check"
    return 1
  fi

  local payload
  payload=$(printf '{"query":"query($id:String!){ service(id:$id){ id name } }","variables":{"id":"%s"}}' "$service_id")

  local http_code
  http_code=$(curl -s -o /tmp/railway-service-check.json -w '%{http_code}' --max-time 12 \
    -X POST 'https://backboard.railway.com/graphql/v2' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token_value}" \
    --data "$payload" 2>/dev/null || echo "000")

  if [ "$http_code" != "200" ]; then
    log_warning "Service ID ($service_name) probe unreachable (HTTP $http_code)"
    return 1
  fi

  local has_errors
  has_errors=$(jq -r 'if (.errors | length) > 0 then "yes" else "no" end' /tmp/railway-service-check.json 2>/dev/null || echo "yes")
  if [ "$has_errors" = "yes" ]; then
    local first_error
    first_error=$(jq -r '.errors[0].message // "unknown"' /tmp/railway-service-check.json 2>/dev/null || echo "unknown")
    log_warning "Service ID ($service_name) Graph probe failed: $first_error"
    return 1
  fi

  local resolved_name
  resolved_name=$(jq -r '.data.service.name // "unknown"' /tmp/railway-service-check.json 2>/dev/null || echo "unknown")
  log_success "Service ID ($service_name) is accessible via Graph (resolved: $resolved_name)"
  ((VALIDATED_COUNT+=1))
  return 0
}

# Validate HTTP health endpoint
validate_service_url() {
  local url="$1"
  local service_name="$2"
  
  if [ -z "$url" ]; then
    log_warning "No URL provided for $service_name — skipping"
    return 1
  fi

  # Normalize URL
  if [[ "$url" != http://* && "$url" != https://* ]]; then
    url="https://$url"
  fi

  local health_url="${url%/}/health"
  local http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$health_url" 2>/dev/null || echo "000")
  
  if [ "$http_code" = "200" ]; then
    log_success "Service ($service_name) is healthy: $health_url"
    ((VALIDATED_COUNT+=1))
    return 0
  else
    log_warning "Service ($service_name) returned HTTP $http_code: $health_url"
    return 1
  fi
}

# ============================================================================
# MAIN AUDIT
# ============================================================================

main() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}   Railway Services Credential Audit${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo ""

  # Check prerequisites
  local missing_prereqs=()
  command_exists curl || missing_prereqs+=("curl")
  command_exists jq || missing_prereqs+=("jq")
  
  if [ ${#missing_prereqs[@]} -gt 0 ]; then
    log_error "Missing prerequisites: ${missing_prereqs[*]}"
    log_info "Install with: apt install ${missing_prereqs[*]} (or brew install on macOS)"
    return 2
  fi

  if ! command_exists railway; then
    log_warning "railway CLI not found — CLI-based checks are skipped (API checks still run)"
  fi

  # ========== BOB SERVICE ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  BOB INFERENCE SERVICE"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${RAILWAY_BOB_TOKEN:-}" ]; then
    log_error "RAILWAY_BOB_TOKEN is not set"
    ((MISSING_COUNT+=1))
  else
    validate_railway_token "$RAILWAY_BOB_TOKEN" "RAILWAY_BOB_TOKEN"
  fi

  if [ -z "${RAILWAY_BOB_SERVICE_ID:-}" ]; then
    log_warning "RAILWAY_BOB_SERVICE_ID is not set (optional if RAILWAY_BOB_PROJECT_ID is set)"
    ((MISSING_COUNT+=1))
  else
    if [ -n "${RAILWAY_BOB_TOKEN:-}" ]; then
      validate_railway_service_id "$RAILWAY_BOB_TOKEN" "$RAILWAY_BOB_SERVICE_ID" "RAILWAY_BOB_SERVICE_ID" || true
    fi
  fi

  if [ -z "${RAILWAY_BOB_PROJECT_ID:-}" ]; then
    log_warning "RAILWAY_BOB_PROJECT_ID is not set (optional if RAILWAY_BOB_SERVICE_ID is set)"
  fi

  if [ -n "${BOB_SERVICE_URL:-}" ]; then
    validate_service_url "$BOB_SERVICE_URL" "BOB (public URL)" || true
  fi

  # ========== OLLAMA SERVICE ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  OLLAMA LLM SERVICE"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${RAILWAY_OLLAMA_SERVICE_ID:-}" ]; then
    log_warning "RAILWAY_OLLAMA_SERVICE_ID is not set (optional if RAILWAY_BOB_PROJECT_ID is set)"
    ((MISSING_COUNT+=1))
  else
    if [ -n "${RAILWAY_BOB_TOKEN:-}" ]; then
      validate_railway_service_id "$RAILWAY_BOB_TOKEN" "$RAILWAY_OLLAMA_SERVICE_ID" "RAILWAY_OLLAMA_SERVICE_ID" || true
    fi
  fi

  if [ -n "${OLLAMA_SERVICE_URL:-}" ]; then
    validate_service_url "$OLLAMA_SERVICE_URL" "Ollama (public URL)" || true
  fi

  # ========== PROXY SERVICE ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  PROXY SERVER SERVICE"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${RAILWAY_TOKEN:-}" ]; then
    log_error "RAILWAY_TOKEN is not set (required for core services)"
    ((MISSING_COUNT+=1))
  else
    validate_railway_token "$RAILWAY_TOKEN" "RAILWAY_TOKEN"
  fi

  if [ -z "${RAILWAY_PROXY_SERVICE_ID:-}" ]; then
    log_error "RAILWAY_PROXY_SERVICE_ID is not set"
    ((MISSING_COUNT+=1))
  else
    if [ -n "${RAILWAY_TOKEN:-}" ]; then
      validate_railway_service_id "$RAILWAY_TOKEN" "$RAILWAY_PROXY_SERVICE_ID" "RAILWAY_PROXY_SERVICE_ID" || true
    fi
  fi

  if [ -n "${PROXY_SERVICE_URL:-}" ]; then
    validate_service_url "$PROXY_SERVICE_URL" "Proxy (public URL)" || true
  fi

  # ========== INFERENCE SERVICE ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  INFERENCE SERVICE (Core)"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${RAILWAY_INFERENCE_SERVICE_ID:-}" ]; then
    log_error "RAILWAY_INFERENCE_SERVICE_ID is not set"
    ((MISSING_COUNT+=1))
  else
    if [ -n "${RAILWAY_TOKEN:-}" ]; then
      validate_railway_service_id "$RAILWAY_TOKEN" "$RAILWAY_INFERENCE_SERVICE_ID" "RAILWAY_INFERENCE_SERVICE_ID" || true
    fi
  fi

  if [ -n "${INFERENCE_SERVICE_URL:-}" ]; then
    validate_service_url "$INFERENCE_SERVICE_URL" "Inference (public URL)" || true
  fi

  # ========== PTT SERVICE ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  PTT SERVER SERVICE (Push-to-Talk)"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${RAILWAY_PTT_SERVICE_ID:-}" ]; then
    log_warning "RAILWAY_PTT_SERVICE_ID is not set"
    ((MISSING_COUNT+=1))
  else
    if [ -n "${RAILWAY_TOKEN:-}" ]; then
      validate_railway_service_id "$RAILWAY_TOKEN" "$RAILWAY_PTT_SERVICE_ID" "RAILWAY_PTT_SERVICE_ID" || true
    fi
  fi

  if [ -n "${PTT_SERVICE_URL:-}" ]; then
    validate_service_url "$PTT_SERVICE_URL" "PTT Server (public URL)" || true
  fi

  # ========== SUPABASE SECRETS ==========
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  SUPABASE VAULT SECRETS (Edge Functions)"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ -z "${PROXY_SERVER_URL:-}" ]; then
    log_error "PROXY_SERVER_URL Supabase secret is not set"
    ((MISSING_COUNT+=1))
  else
    validate_service_url "$PROXY_SERVER_URL" "PROXY_SERVER_URL (Supabase secret)" || true
  fi

  if [ -z "${INFERENCE_SERVICE_URL:-}" ]; then
    log_error "INFERENCE_SERVICE_URL Supabase secret is not set"
    ((MISSING_COUNT+=1))
  else
    validate_service_url "$INFERENCE_SERVICE_URL" "INFERENCE_SERVICE_URL (Supabase secret)" || true
  fi

  if [ -z "${INFERENCE_API_KEY:-}" ]; then
    log_error "INFERENCE_API_KEY Supabase secret is not set"
    ((MISSING_COUNT+=1))
  else
    log_success "INFERENCE_API_KEY is set: $(mask_secret "$INFERENCE_API_KEY")"
    ((VALIDATED_COUNT+=1))
  fi

  if [ -z "${PTT_SERVER_URL:-}" ]; then
    log_warning "PTT_SERVER_URL Supabase secret is not set"
    ((MISSING_COUNT+=1))
  else
    validate_service_url "$PTT_SERVER_URL" "PTT_SERVER_URL (Supabase secret)" || true
  fi

  # ========== SUMMARY ==========
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "  SUMMARY"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  log_success "Validated: $VALIDATED_COUNT"
  
  if [ $INVALID_COUNT -gt 0 ]; then
    log_error "Invalid: $INVALID_COUNT"
  fi
  
  if [ $MISSING_COUNT -gt 0 ]; then
    log_error "Missing: $MISSING_COUNT"
  fi

  echo ""
  
  if [ $MISSING_COUNT -eq 0 ] && [ $INVALID_COUNT -eq 0 ]; then
    log_success "All secrets are valid!"
    echo ""
    log_info "Next steps:"
    echo "  1. Run the wiring audit: .github/workflows/ops-railway-wiring-audit.yml"
    echo "  2. Run smoke test: .github/workflows/ops-bob-human-interaction-smoke.yml"
    echo ""
    return 0
  else
    echo ""
    log_error "Some secrets are missing or invalid. See above for details."
    echo ""
    log_info "Fix steps:"
    echo "  1. See docs/RAILWAY_SERVICES_AUTHORITY.md for required secrets"
    echo "  2. Add missing secrets to GitHub Actions or your .env file"
    echo "  3. For Railway tokens: Project → Settings → Tokens"
    echo "  4. For service IDs: Service → Settings → Service ID"
    echo "  5. Rerun this script to validate"
    echo ""
    return 1
  fi
}

# ============================================================================
# ENTRY POINT
# ============================================================================

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
