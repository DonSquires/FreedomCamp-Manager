#!/bin/bash
set -e

# Bob Computer Use Readiness Checker
# Purpose: verify whether this environment is ready for screen/camera/mic + computer-use control.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; }
info() { echo -e "${BLUE}INFO${NC} $1"; }

JSON_MODE=0
ENFORCE_MODE=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    --enforce) ENFORCE_MODE=1 ;;
  esac
done

OS_NAME=$(uname -s 2>/dev/null || echo "unknown")

WARNINGS=()
ERRORS=()

add_warning() { WARNINGS+=("$1"); }
add_error() { ERRORS+=("$1"); }

echo ""
echo "Bob Computer Use Readiness"
echo "==========================="
info "Detected OS: $OS_NAME"

# 1) Model/API readiness
API_READY=0
if [ -n "$ANTHROPIC_API_KEY" ] || [ -n "$OPENAI_API_KEY" ] || [ -n "$GOOGLE_API_KEY" ]; then
  pass "At least one multimodal API key is present in environment"
  API_READY=1
else
  warn "No multimodal API key found (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY)"
  add_warning "No multimodal API key found"
fi

# 2) Docker readiness for containerized computer-use flows
if command -v docker >/dev/null 2>&1; then
  pass "Docker is installed"
else
  warn "Docker not found (needed for many safe-box computer-use demos)"
  add_warning "Docker not found"
fi

# 3) Python + custom automation readiness
if command -v python3 >/dev/null 2>&1; then
  pass "python3 available"
  if python3 - <<'PY' >/dev/null 2>&1
import importlib.util
ok = importlib.util.find_spec('pyautogui') is not None
raise SystemExit(0 if ok else 1)
PY
  then
    pass "pyautogui installed"
  else
    warn "pyautogui not installed (custom hands/mouse path). Install with: pip install pyautogui"
    add_warning "pyautogui not installed"
  fi
else
  warn "python3 not found (custom PyAutoGUI path unavailable)"
  add_warning "python3 not found"
fi

# 4) Camera and mic tooling checks (best-effort in headless/devcontainer)
if command -v ffmpeg >/dev/null 2>&1; then
  pass "ffmpeg available (helpful for audio/video capture pipelines)"
else
  warn "ffmpeg not found (optional, but useful for camera/mic diagnostics)"
  add_warning "ffmpeg not found"
fi

if [ "$OS_NAME" = "Darwin" ]; then
  info "Mac permission reminder: System Settings > Privacy & Security > Accessibility/Screen Recording"
elif [[ "$OS_NAME" == MINGW* ]] || [[ "$OS_NAME" == CYGWIN* ]] || [[ "$OS_NAME" == MSYS* ]]; then
  info "Windows permission reminder: run desktop bridge app as Administrator"
fi

# 5) Safety controls checklist
echo ""
info "Safety Controls Checklist (manual verification required):"
echo "- Manual confirmation mode enabled before destructive actions"
echo "- Kill switch known and tested (Ctrl+C / emergency stop)"
echo "- Sensitive windows hidden before screen-sharing tasks"
echo "- Camera/mic/screen permissions restricted to trusted host app"

# 6) Setup path recommendations
echo ""
info "Recommended setup path based on current environment:"
if [ "$API_READY" -eq 1 ] && command -v docker >/dev/null 2>&1; then
  echo "- Pro Path Ready: containerized computer-use + multimodal model"
elif [ "$API_READY" -eq 1 ]; then
  echo "- Consumer/Builder Path Ready: API-based vision/voice tools"
else
  echo "- Start with No-Code path or configure API keys first"
fi

echo ""
info "Verification prompts to run after setup:"
echo "1) Camera test: 'What object am I holding and what text is visible?'"
echo "2) Screen test: 'What is the key value in the top-right area?'"
echo "3) Audio test: 'Classify my tone from this sample.'"

echo ""
pass "Readiness check complete"

if [ "$ENFORCE_MODE" -eq 1 ]; then
  if [ "$API_READY" -eq 0 ]; then
    add_error "Enforce mode: multimodal API key is required"
  fi
  if ! command -v docker >/dev/null 2>&1; then
    add_error "Enforce mode: docker is required"
  fi
fi

if [ "$JSON_MODE" -eq 1 ]; then
  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    warnings_json=$(printf '%s\n' "${WARNINGS[@]}" | jq -R . | jq -s .)
  else
    warnings_json='[]'
  fi
  if [ "${#ERRORS[@]}" -gt 0 ]; then
    errors_json=$(printf '%s\n' "${ERRORS[@]}" | jq -R . | jq -s .)
  else
    errors_json='[]'
  fi
  recommended_path="configure-api-keys-first"
  if [ "$API_READY" -eq 1 ] && command -v docker >/dev/null 2>&1; then
    recommended_path="pro-containerized"
  elif [ "$API_READY" -eq 1 ]; then
    recommended_path="api-assisted"
  fi

  jq -n \
    --arg os "$OS_NAME" \
    --arg recommended_path "$recommended_path" \
    --argjson api_ready "$API_READY" \
    --argjson warnings "$warnings_json" \
    --argjson errors "$errors_json" \
    '{
      os: $os,
      api_ready: ($api_ready == 1),
      recommended_path: $recommended_path,
      warnings: $warnings,
      errors: $errors,
      enforce_passed: ($errors | length == 0)
    }'
fi

if [ "$ENFORCE_MODE" -eq 1 ] && [ "${#ERRORS[@]}" -gt 0 ]; then
  fail "Enforce mode failed"
  exit 2
fi
