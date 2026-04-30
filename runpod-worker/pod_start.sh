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

strip_github_credentials() {
  printf '%s' "$1" | sed -E 's#https://[^/@]+@github.com/#https://github.com/#I'
}

sync_repo() {
  local repo_url="$1"
  local branch="$2"
  local repo_dir="$3"
  local public_url
  local auth_url

  public_url="$(strip_github_credentials "$repo_url")"
  auth_url="$public_url"
  if [ -n "$GITHUB_TOKEN" ]; then
    auth_url="${public_url/https:\/\/github.com\//https:\/\/x-access-token:${GITHUB_TOKEN}@github.com/}"
  fi

  if [ -d "$repo_dir/.git" ]; then
    echo "[pod_start] Updating repo (branch: $branch)..."
    git -C "$repo_dir" remote set-url origin "$auth_url" || git -C "$repo_dir" remote set-url origin "$public_url" || true
    if ! git -C "$repo_dir" fetch origin "$branch" --depth=1 2>&1 | head -5; then
      if [ "$auth_url" != "$public_url" ]; then
        echo "[pod_start] Auth fetch failed; retrying with public GitHub URL"
        git -C "$repo_dir" remote set-url origin "$public_url" || true
        git -C "$repo_dir" fetch origin "$branch" --depth=1 2>&1 | head -5
      else
        return 1
      fi
    fi
    git -C "$repo_dir" reset --hard "origin/$branch"
    echo "[pod_start] Updated to $(git -C $repo_dir rev-parse --short HEAD)"
  else
    echo "[pod_start] Cloning repo (branch: $branch)..."
    if ! git clone --depth=1 --branch "$branch" "$auth_url" "$repo_dir"; then
      if [ "$auth_url" != "$public_url" ]; then
        echo "[pod_start] Auth clone failed; retrying with public GitHub URL"
        git clone --depth=1 --branch "$branch" "$public_url" "$repo_dir"
      else
        return 1
      fi
    fi
    echo "[pod_start] Cloned: $(git -C $repo_dir rev-parse --short HEAD)"
  fi
}

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
sync_repo "$REPO_URL" "$BRANCH" "$REPO_DIR"

# ---------------------------------------------------------------------------
# 3. Install inference-service deps
# ---------------------------------------------------------------------------
INFERENCE_DIR="$REPO_DIR/inference-service"
INSTALL_CACHE_DIR="/workspace/cache"
INSTALL_HASH_FILE="$INSTALL_CACHE_DIR/inference_node_modules.hash"
echo "[pod_start] Installing inference-service deps..."
cd "$INFERENCE_DIR"
mkdir -p "$INSTALL_CACHE_DIR"

LOCKFILE=""
if [ -f "$INFERENCE_DIR/package-lock.json" ]; then
  LOCKFILE="$INFERENCE_DIR/package-lock.json"
elif [ -f "$INFERENCE_DIR/npm-shrinkwrap.json" ]; then
  LOCKFILE="$INFERENCE_DIR/npm-shrinkwrap.json"
fi

CURRENT_HASH=""
if [ -n "$LOCKFILE" ]; then
  CURRENT_HASH=$(sha256sum "$LOCKFILE" | awk '{print $1}')
fi

PREV_HASH=""
if [ -f "$INSTALL_HASH_FILE" ]; then
  PREV_HASH=$(cat "$INSTALL_HASH_FILE")
fi

if [ -d "$INFERENCE_DIR/node_modules" ] && [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" = "$PREV_HASH" ]; then
  echo "[pod_start] Dependency cache hit; skipping npm install"
else
  echo "[pod_start] Dependency cache miss; running npm ci"
  npm ci --omit=dev 2>/dev/null || npm install --production
  if [ -n "$CURRENT_HASH" ]; then
    printf '%s' "$CURRENT_HASH" > "$INSTALL_HASH_FILE"
  fi
fi

# Download required ONNX models so /infer does not run in degraded mode.
echo "[pod_start] Downloading ONNX models..."
if ! node scripts/download-models.js; then
  echo "[pod_start] WARNING: model download failed; continuing with any preloaded models"
fi

# Compatibility fallback: some runtime paths still reference /app/models.
mkdir -p /app/models
if [ -f "$INFERENCE_DIR/models/yolov8n.onnx" ]; then
  cp -f "$INFERENCE_DIR/models/yolov8n.onnx" /app/models/yolov8n.onnx
else
  echo "[pod_start] WARNING: missing $INFERENCE_DIR/models/yolov8n.onnx"
fi
if [ -f "$INFERENCE_DIR/models/mobilenet_v3.onnx" ]; then
  cp -f "$INFERENCE_DIR/models/mobilenet_v3.onnx" /app/models/mobilenet_v3.onnx
else
  echo "[pod_start] WARNING: missing $INFERENCE_DIR/models/mobilenet_v3.onnx"
fi

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
YOLO_MODEL_PATH=${INFERENCE_DIR}/models/yolov8n.onnx
EMBEDDING_MODEL_PATH=${INFERENCE_DIR}/models/mobilenet_v3.onnx
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
cd "$INFERENCE_DIR"
# Override image-baked defaults for this process so dotenv does not keep
# stale values such as OLLAMA_VISION_MODEL=llama3.2-vision:11b.
export OLLAMA_VISION_MODEL="$VISION_MODEL"
export OLLAMA_AUTO_PULL_MODELS=false
exec node server.js
