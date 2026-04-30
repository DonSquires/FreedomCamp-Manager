#!/bin/bash
# ---------------------------------------------------------------------------
# pod_start.sh — Startup script for the RunPod SPOT POD (HTTP API on port 3000)
# Baked into the Docker image so dockerArgs can simply call: bash /app/pod_start.sh
# No quoting/escaping issues in RunPod dockerArgs.
#
# Sequence:
#   1. Start Ollama daemon + wait for ready
#   2. Clone / update FreedomCamp-Manager repo
#   3. Install inference-service deps
#   4. Write .env
#   5. Start node inference-service/server.js (foreground — keeps pod alive)
# ---------------------------------------------------------------------------
set -e

REPO_DIR="/workspace/repo"
BRANCH="${GITHUB_REPO_BRANCH:-main}"
REPO_URL="${GITHUB_REPO_URL:-https://github.com/DonSquires/FreedomCamp-Manager.git}"

mkdir -p /workspace/logs

# ---------------------------------------------------------------------------
# 1. Ollama daemon
# ---------------------------------------------------------------------------
echo "[pod_start] Starting Ollama..."
ollama serve > /workspace/logs/ollama.log 2>&1 &
OLLAMA_READY=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    OLLAMA_READY=1
    echo "[pod_start] Ollama ready after ${i}s"
    break
  fi
  sleep 1
done
if [ "$OLLAMA_READY" = "0" ]; then
  echo "[pod_start] WARNING: Ollama did not become ready — continuing anyway"
fi

# ---------------------------------------------------------------------------
# 2. Repo clone / update
# ---------------------------------------------------------------------------
if [ -n "$GITHUB_TOKEN" ]; then
  AUTH_URL="${REPO_URL/https:\/\//https:\/\/${GITHUB_TOKEN}@}"
else
  AUTH_URL="$REPO_URL"
fi

if [ -d "$REPO_DIR/.git" ]; then
  echo "[pod_start] Updating repo (branch: $BRANCH)..."
  git -C "$REPO_DIR" fetch origin "$BRANCH" --depth=1 2>&1 | head -5
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  echo "[pod_start] Updated to $(git -C $REPO_DIR rev-parse --short HEAD)"
else
  echo "[pod_start] Cloning repo (branch: $BRANCH)..."
  git clone --depth=1 --branch "$BRANCH" "$AUTH_URL" "$REPO_DIR"
  echo "[pod_start] Cloned: $(git -C $REPO_DIR rev-parse --short HEAD)"
fi

# ---------------------------------------------------------------------------
# 3. Install inference-service deps
# ---------------------------------------------------------------------------
INFERENCE_DIR="$REPO_DIR/inference-service"
echo "[pod_start] Installing inference-service deps..."
cd "$INFERENCE_DIR"
npm ci --omit=dev 2>/dev/null || npm install --production

# Download required ONNX models so /infer does not run in degraded mode.
echo "[pod_start] Downloading ONNX models..."
node scripts/download-models.js

# Ensure a vision model exists; if the requested model is unsupported by the
# bundled Ollama version, fall back to a broadly compatible multimodal model.
VISION_MODEL="${OLLAMA_VISION_MODEL:-llama3.2-vision:11b}"
echo "[pod_start] Ensuring vision model is available: ${VISION_MODEL}"
if ! ollama list 2>/dev/null | grep -q "${VISION_MODEL}"; then
  if ! ollama pull "${VISION_MODEL}"; then
    echo "[pod_start] WARNING: Failed to pull ${VISION_MODEL}; falling back to llava:7b"
    VISION_MODEL="llava:7b"
    ollama pull "${VISION_MODEL}"
  fi
fi
cd /app

# ---------------------------------------------------------------------------
# 4. Write .env
# ---------------------------------------------------------------------------
cat > "$INFERENCE_DIR/.env" <<EOF
PORT=3000
NODE_ENV=production
BOB_OPERATING_MODE=${BOB_OPERATING_MODE:-build-training}
OLLAMA_BASE_URL=http://127.0.0.1:11434
CHAT_PROVIDER=${CHAT_PROVIDER:-ollama}
TABULAR_NLP_PROVIDER=${TABULAR_NLP_PROVIDER:-heuristic}
OLLAMA_VISION_MODEL=${VISION_MODEL}
SELF_CONTAINED_MODE=false
SELF_CONTAINED_STRICT_EGRESS=false
REQUIRE_SELF_CONTAINED_MODE=false
OLLAMA_AUTO_PULL_MODELS=false
DOCTOR_REQUIRE_ONNX_MODELS=false
DOCTOR_OLLAMA_PROBE_TIMEOUT_MS=12000
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://kxwjcupuxnnbnzcgmkoi.supabase.co}
$([ -n "$INFERENCE_API_KEY" ] && echo "INFERENCE_API_KEY=$INFERENCE_API_KEY")
$([ -n "$VITE_SUPABASE_URL" ] && echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL")
$([ -n "$VITE_SUPABASE_ANON_KEY" ] && echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY")
$([ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY")
EOF
echo "[pod_start] .env written"

# ---------------------------------------------------------------------------
# 5. Start inference-service (foreground — keeps container alive)
# ---------------------------------------------------------------------------
echo "[pod_start] Starting inference-service on port 3000..."
exec node "$INFERENCE_DIR/server.js"
