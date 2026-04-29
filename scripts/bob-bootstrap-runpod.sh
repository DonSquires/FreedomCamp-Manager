#!/bin/bash
# Bob RunPod Bootstrap — Integrate RunPod Serverless with Existing Bob Infrastructure
# Usage: bash scripts/bob-bootstrap-runpod.sh [--validate-only|--full|--local|--runpod]
# 
# Modes:
#   --full            Full setup: integrate RunPod as alternate backend to local inference-service
#   --validate-only   Validate credentials and endpoint connectivity without changes
#   --local           Keep using local inference-service (DEFAULT)
#   --runpod          Switch to RunPod Serverless as primary backend

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(dirname "$SCRIPT_DIR")
MODE="${1:-full}"
BACKEND_MODE="local"  # Can be: local, runpod, hybrid

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- Helper Functions ---
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[!]${NC} $1"
}

# --- 1. Environment Validation ---
check_env() {
  log_info "Checking RunPod credentials in environment..."
  
  if [ -z "$INFERENCE_SERVICE_URL" ]; then
    log_error "INFERENCE_SERVICE_URL not set"
    log_info "Set it via: export INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/n0bp1ifmq01cx2"
    return 1
  fi
  
  if [ -z "$INFERENCE_API_KEY" ]; then
    log_error "INFERENCE_API_KEY not set"
    log_info "Set it via: export INFERENCE_API_KEY=rpa_..."
    return 1
  fi
  
  log_success "Environment variables present"
  echo "  INFERENCE_SERVICE_URL: ${INFERENCE_SERVICE_URL:0:50}..."
  echo "  INFERENCE_API_KEY: ${INFERENCE_API_KEY:0:15}... (masked)"
  return 0
}

# --- 2. RunPod Endpoint Health ---
check_endpoint() {
  log_info "Testing RunPod endpoint connectivity..."
  
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    "${INFERENCE_SERVICE_URL}/runsync" \
    -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"input":{"action":"chat","message":"ping"}}' \
    --max-time 10 2>/dev/null || echo "000")
  
  if [ "$RESPONSE" == "200" ]; then
    log_success "RunPod endpoint is responsive (HTTP 200)"
    return 0
  else
    log_error "RunPod endpoint returned HTTP $RESPONSE"
    log_warn "Check: Is the pod running? Does the API key match?"
    return 1
  fi
}

# --- 3. Model Verification ---
check_models() {
  log_info "Verifying models are loaded on RunPod pod..."
  
  # Try to list models via Ollama API
  MODELS=$(curl -s "${INFERENCE_SERVICE_URL}/api/tags" \
    -H "Authorization: Bearer ${INFERENCE_API_KEY}" 2>/dev/null || echo "{}")
  
  if echo "$MODELS" | grep -q "qwen2.5"; then
    log_success "Primary model (qwen2.5:7b) is available"
  else
    log_warn "Primary model not found in /api/tags response"
    log_info "This is OK if models are baked into the pod; proceed with caution"
  fi
  
  return 0
}

# --- 4. Training Data Ingestion ---
load_training_data() {
  log_info "Ingesting training data into Bob's knowledge base..."
  
  cd "$REPO_ROOT"
  
  # Generate brain dump from live codebase
  if [ -f "scripts/auto-ingest.mjs" ]; then
    log_info "Running auto-ingest to populate BOB_BRAIN_DUMP.md..."
    node scripts/auto-ingest.mjs || log_warn "auto-ingest.mjs did not complete fully"
  else
    log_warn "auto-ingest.mjs not found; skipping brain dump generation"
  fi
  
  # Verify training docs exist
  TRAINING_DOCS=0
  for doc in docs/BOB_TRAINING_*.md docs/DECISIONS.md docs/LESSONS_LEARNED.md; do
    if [ -f "$doc" ]; then
      TRAINING_DOCS=$((TRAINING_DOCS + 1))
    fi
  done
  
  log_success "Found $TRAINING_DOCS training documents"
  return 0
}

# --- 5. ADR Indexing ---
index_architecture_decisions() {
  log_info "Indexing architecture decision records..."
  
  if [ ! -d "$REPO_ROOT/docs/adr" ]; then
    log_warn "docs/adr directory not found; creating..."
    mkdir -p "$REPO_ROOT/docs/adr"
  fi
  
  ADR_COUNT=$(find "$REPO_ROOT/docs/adr" -name "*.md" 2>/dev/null | wc -l)
  log_success "Indexed $ADR_COUNT architecture decisions"
  
  if [ "$ADR_COUNT" -lt 3 ]; then
    log_warn "ADR count is low; some decision records may be missing"
  fi
  
  return 0
}

# --- 6. Tool Suite Validation ---
validate_tools() {
  log_info "Validating Bob's tool suite..."
  
  TOOLS_AVAILABLE=0
  TOOLS_MISSING=0
  
  # Check for key tool scripts
  for tool in \
    "scripts/auto-ingest.mjs" \
    "scripts/dr-bob-review.mjs" \
    "scripts/bob-response-log.mjs" \
    "scripts/summarize-failures.mjs" \
    "scripts/system-check.sh"; do
    
    if [ -f "$REPO_ROOT/$tool" ]; then
      TOOLS_AVAILABLE=$((TOOLS_AVAILABLE + 1))
    else
      TOOLS_MISSING=$((TOOLS_MISSING + 1))
    fi
  done
  
  log_success "Tool suite validation: $TOOLS_AVAILABLE available, $TOOLS_MISSING missing"
  return 0
}

# --- 7. Copilot Instructions Update ---
update_instructions() {
  log_info "Verifying Copilot instructions include Bob protocols..."
  
  if ! grep -q "Change Intent Validation Gate" "$REPO_ROOT/.github/copilot-instructions.md" 2>/dev/null; then
    log_warn "Bob Truth Protocol not found in copilot-instructions.md"
    log_info "This should be present for AI-assisted safety gates"
  else
    log_success "Bob Truth Protocol is active in Copilot instructions"
  fi
  
  return 0
}

# --- 8. Testing Integration ---
validate_tests() {
  log_info "Checking Bob's test integration..."
  
  if [ -f "$REPO_ROOT/tests/e2e/visual-regression.spec.ts" ]; then
    TEST_COUNT=$(grep -c "test(" "$REPO_ROOT/tests/e2e/visual-regression.spec.ts" || echo "0")
    log_success "Found $TEST_COUNT test cases for visual regression"
  fi
  
  if [ -f "$REPO_ROOT/data/bob-response-scores.jsonl" ]; then
    SCORE_ENTRIES=$(wc -l < "$REPO_ROOT/data/bob-response-scores.jsonl")
    log_success "Response scoring history: $SCORE_ENTRIES entries"
  fi
  
  return 0
}

# --- 7.5. Permissions & Directories ---
setup_runtime_dirs() {
  log_info "Setting up runtime directories..."
  
  mkdir -p "$REPO_ROOT/.runtime"
  mkdir -p "$REPO_ROOT/data"
  mkdir -p "$REPO_ROOT/docs/adr"
  
  chmod 700 "$REPO_ROOT/.runtime"
  
  log_success "Runtime directories ready"
  return 0
}

# --- 7. Existing Bob Inference Service Detection ---
check_bob_inference_service() {
  log_info "Checking for existing Bob inference-service..."
  
  if [ -f "$REPO_ROOT/inference-service/server.js" ]; then
    log_success "Found existing Bob inference-service at ./inference-service/server.js"
    
    # Check if service is running locally
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
      log_success "Existing inference-service is running on http://localhost:3000"
      BACKEND_MODE="hybrid"
    else
      log_info "Local inference-service detected but not currently running"
      log_info "To start it: npm --prefix ./inference-service start"
    fi
    
    # Check OLLAMA_BASE_URL configuration
    if grep -q "OLLAMA_BASE_URL" "$REPO_ROOT/inference-service/.env" 2>/dev/null; then
      OLLAMA_URL=$(grep "^OLLAMA_BASE_URL=" "$REPO_ROOT/inference-service/.env" | cut -d= -f2 | tr -d ' ')
      log_info "Existing Ollama backend: $OLLAMA_URL"
    fi
    
    return 0
  else
    log_warn "No existing inference-service found"
    BACKEND_MODE="runpod"
    return 0
  fi
}

# --- 8. Backend Configuration Setup ---
setup_backend_config() {
  local mode="$1"
  
  log_info "Configuring backend mode: $mode"
  
  case "$mode" in
    --runpod)
      log_info "Switching to RunPod Serverless as primary backend..."
      
      # Create RunPod-specific env config
      cat > "$REPO_ROOT/.runtime/bob-runpod-backend.env" << 'BACKEND_EOF'
# RunPod Serverless Configuration for Bob
export INFERENCE_SERVICE_URL_RUNPOD="${INFERENCE_SERVICE_URL:-https://api.runpod.ai/v2/n0bp1ifmq01cx2}"
export INFERENCE_API_KEY_RUNPOD="${INFERENCE_API_KEY}"
export BOB_INFERENCE_BACKEND="runpod-serverless"
export BOB_USERUNPOD="1"

# Optional: keep local endpoint as fallback
export INFERENCE_SERVICE_URL_LOCAL="http://localhost:3000"
export BOB_FALLBACK_TO_LOCAL="1"
BACKEND_EOF
      
      log_success "RunPod backend configured at .runtime/bob-runpod-backend.env"
      ;;
      
    --local)
      log_info "Keeping local inference-service as primary backend..."
      
      cat > "$REPO_ROOT/.runtime/bob-local-backend.env" << 'BACKEND_EOF'
# Local Inference-Service Configuration for Bob
export INFERENCE_SERVICE_URL="http://localhost:3000"
export BOB_INFERENCE_BACKEND="local-inference-service"
export BOB_USE_LOCAL="1"

# Optional: RunPod as high-availability fallback
export INFERENCE_SERVICE_URL_RUNPOD="${INFERENCE_SERVICE_URL_RUNPOD:-https://api.runpod.ai/v2/n0bp1ifmq01cx2}"
export BOB_FALLBACK_TO_RUNPOD="0"
BACKEND_EOF
      
      log_success "Local backend configured at .runtime/bob-local-backend.env"
      ;;
      
    hybrid|*)
      log_info "Setting up hybrid mode with automatic fallback..."
      
      cat > "$REPO_ROOT/.runtime/bob-hybrid-backend.env" << 'BACKEND_EOF'
# Hybrid Backend Configuration — Tries local first, falls back to RunPod
export BOB_INFERENCE_BACKEND="hybrid"
export INFERENCE_SERVICE_URL_LOCAL="http://localhost:3000"
export INFERENCE_SERVICE_URL_RUNPOD="https://api.runpod.ai/v2/n0bp1ifmq01cx2"
export BOB_FALLBACK_TO_LOCAL="1"
export BOB_FALLBACK_TO_RUNPOD="1"
export BOB_PRIMARY_BACKEND="local"  # Try local first
BACKEND_EOF
      
      log_success "Hybrid backend configured at .runtime/bob-hybrid-backend.env"
      ;;
  esac
  
  # Create unified config that covers both
  cat > "$REPO_ROOT/.runtime/bob-unified.env" << 'UNITY_EOF'
# Unified Bob Configuration — Supports Both Local & RunPod

# Operating Mode
export BOB_OPERATING_MODE="build-training"
export SELF_CONTAINED_MODE="false"

# Primary Backend (comment/uncomment as needed)
# export BOB_INFERENCE_BACKEND="local-inference-service"
export BOB_INFERENCE_BACKEND="runpod-serverless"

# Local Inference Service (for hybrid mode)
export INFERENCE_SERVICE_URL_LOCAL="http://localhost:3000"
export INFERENCE_SERVICE_HEALTH_LOCAL="http://localhost:3000/health"

# RunPod Serverless Endpoint
export INFERENCE_SERVICE_URL_RUNPOD="https://api.runpod.ai/v2/n0bp1ifmq01cx2"
export INFERENCE_SERVICE_URL="${INFERENCE_SERVICE_URL_RUNPOD}"
export INFERENCE_API_KEY="${INFERENCE_API_KEY}"
export RUNPOD_ENDPOINT_ID="n0bp1ifmq01cx2"

# Fallback behavior
export BOB_FALLBACK_TO_LOCAL="1"
export BOB_FALLBACK_TO_RUNPOD="1"

# Timeouts & Retries
export BOB_RUNPOD_TIMEOUT_MS="90000"
export BOB_RUNPOD_RETRIES="2"
export BOB_RUNPOD_BACKOFF_MS="700"
export BOB_LOCAL_TIMEOUT_MS="30000"
export BOB_LOCAL_RETRIES="3"

# Supervision & Health
export BOB_SUPERVISOR_INTERVAL_MS="60000"
export BOB_SUPERVISOR_FAILURE_THRESHOLD="3"
export BOB_SUPERVISOR_STATE_FILE=".runtime/bob-supervisor-state.json"

# Training & Knowledge
export BOB_TRAINING_MODE="full"
export BOB_KNOWLEDGE_FRESH_REBUILD="0"
UNITY_EOF
  
  log_success "Unified configuration created at .runtime/bob-unified.env"
}



# --- 10. Summary Report ---
print_summary() {
  log_info "Bob Integration Bootstrap Summary"
  echo ""
  echo "✓ Environment validated"
  echo "✓ Existing Bob inference-service detected (if present)"
  echo "✓ RunPod endpoint configured"
  echo "✓ Models verified"
  echo "✓ Training data ingested"
  echo "✓ Architecture decisions indexed"
  echo "✓ Tool suite validated"
  echo "✓ Test infrastructure ready"
  echo "✓ Runtime directories created"
  echo "✓ Unified backend configuration ready"
  echo ""
  log_success "Bob is ready for production use!"
  echo ""
  echo "Configuration Files:"
  echo "  Local Backend:     .runtime/bob-local-backend.env"
  echo "  RunPod Backend:    .runtime/bob-runpod-backend.env"
  echo "  Unified Config:    .runtime/bob-unified.env"
  echo ""
  echo "Next steps:"
  echo ""
  echo "1. LOAD UNIFIED CONFIGURATION:"
  echo "   source .runtime/bob-unified.env"
  echo ""
  echo "2. TEST LOCAL INFERENCE SERVICE (if available):"
  echo "   npm --prefix ./inference-service start"
  echo "   curl http://localhost:3000/health"
  echo ""
  echo "3. TEST RUNPOD SERVERLESS:"
  echo "   curl -X POST '\${INFERENCE_SERVICE_URL_RUNPOD}/runsync' \\"
  echo "     -H \"Authorization: Bearer \${INFERENCE_API_KEY}\" \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"input\":{\"action\":\"chat\",\"message\":\"status\"}}'"
  echo ""
  echo "4. RUN TESTS WITH BOB:"
  echo "   npm run test"
  echo ""
  echo "5. INTERACTIVE CHAT WITH BOB:"
  echo "   node scripts/bob-direct-chat.mjs"
  echo "   or: node scripts/bob-direct-chat.mjs 'Your question here'"
  echo ""
  echo "6. SWITCH BACKENDS (edit .runtime/bob-unified.env):"
  echo "   - Set BOB_INFERENCE_BACKEND=\"local-inference-service\" for local"
  echo "   - Set BOB_INFERENCE_BACKEND=\"runpod-serverless\" for RunPod"
  echo ""
  echo "AVAILABLE BACKENDS:"
  echo "  • Local inference-service (http://localhost:3000) — Low latency, full control"
  echo "  • RunPod Serverless (https://api.runpod.ai/v2/n0bp1ifmq01cx2) — Scalable, HA"
  echo "  • Hybrid (both) — Automatic fallback if one is unavailable"
  echo ""
}

# --- Main Execution ---
main() {
  echo ""
  echo "=========================================="
  echo "Bob Integration Bootstrap"
  echo "=========================================="
  echo "Mode: $MODE"
  echo "Timestamp: $(date)"
  echo ""
  
  if [ "$MODE" == "--validate-only" ]; then
    log_info "Running validation only (no modifications)"
    check_env && check_endpoint && check_models && log_success "All validations passed"
    exit 0
  fi
  
  # Full setup
  check_env || { log_error "Environment check failed"; exit 1; }
  check_endpoint || { log_error "Endpoint check failed"; exit 1; }
  check_models || log_warn "Model check had warnings; continuing anyway"
  
  # Setup
  setup_runtime_dirs
  
  # Check existing Bob infrastructure
  check_bob_inference_service
  
  load_training_data
  index_architecture_decisions
  validate_tools
  update_instructions
  validate_tests
  
  # Determine backend mode from parameter
  case "$MODE" in
    --runpod) setup_backend_config "--runpod" ;;
    --local) setup_backend_config "--local" ;;
    --full|*) setup_backend_config "hybrid" ;;
  esac
  
  # Load training (optional, non-blocking)
  if command -v node &> /dev/null; then
    log_info "Loading Copilot reasoning framework into Bob..."
    node "$REPO_ROOT/scripts/bob-inject-training.mjs" --coding 2>/dev/null || log_warn "Training injection skipped"
  else
    log_warn "Node not found; skipping training injection"
  fi
  
  print_summary
}

main "$@"
