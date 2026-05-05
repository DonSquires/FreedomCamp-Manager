#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Repo sync — clone or update FreedomCamp-Manager so Playwright tests,
# scripts, and playwright.config.ts are available at /app/repo.
# handler.py run_playwright uses working_dir=/app/repo.
#
# Required env: GITHUB_REPO_URL (e.g. https://github.com/DonSquires/FreedomCamp-Manager.git)
# Optional env: GITHUB_REPO_BRANCH (default: main)
#               GITHUB_TOKEN — set for private repo access
# ---------------------------------------------------------------------------
REPO_URL="${GITHUB_REPO_URL:-}"
REPO_BRANCH="${GITHUB_REPO_BRANCH:-main}"
REPO_DIR="/app/repo"
FAST_BOOT="${RUNPOD_FAST_BOOT:-true}"

# Determine if we're using external or local Ollama
# Priority: OLLAMA_EXTERNAL_URL > OLLAMA_BASE_URL > default localhost
OLLAMA_EXTERNAL_URL="${OLLAMA_EXTERNAL_URL:-}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-}"
LOCAL_OLLAMA_URL="http://127.0.0.1:11434"

# Resolve which Ollama URL to use
if [ -n "$OLLAMA_EXTERNAL_URL" ]; then
  RESOLVED_OLLAMA_URL="${OLLAMA_EXTERNAL_URL%/}"  # Trim trailing slash
  USE_LOCAL_OLLAMA="false"
  echo "[start] External Ollama configured: $RESOLVED_OLLAMA_URL"
elif [ -n "$OLLAMA_BASE_URL" ] && [ "$OLLAMA_BASE_URL" != "$LOCAL_OLLAMA_URL" ]; then
  RESOLVED_OLLAMA_URL="${OLLAMA_BASE_URL%/}"
  USE_LOCAL_OLLAMA="false"
  echo "[start] Alternative Ollama configured: $RESOLVED_OLLAMA_URL"
else
  RESOLVED_OLLAMA_URL="$LOCAL_OLLAMA_URL"
  USE_LOCAL_OLLAMA="true"
  echo "[start] Using local Ollama at $LOCAL_OLLAMA_URL"
fi

if [ -z "${RUNPOD_PREP_REPO_NODE_DEPS_ON_START+x}" ]; then
  if [ "$FAST_BOOT" = "true" ]; then
    PREP_REPO_NODE_DEPS_ON_START="false"
  else
    PREP_REPO_NODE_DEPS_ON_START="true"
  fi
else
  PREP_REPO_NODE_DEPS_ON_START="${RUNPOD_PREP_REPO_NODE_DEPS_ON_START}"
fi

if [ -z "${RUNPOD_PREP_MODELS_ON_START+x}" ]; then
  if [ "$FAST_BOOT" = "true" ]; then
    PREP_MODELS_ON_START="false"
  else
    PREP_MODELS_ON_START="true"
  fi
else
  PREP_MODELS_ON_START="${RUNPOD_PREP_MODELS_ON_START}"
fi

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
    echo "[start] Updating repo at $repo_dir (branch: $branch)..."
    if ! git -C "$repo_dir" remote set-url origin "$auth_url"; then
      git -C "$repo_dir" remote set-url origin "$public_url" || true
    fi

    if ! git -C "$repo_dir" fetch origin "$branch" --depth=1 2>&1 | head -5; then
      if [ "$auth_url" != "$public_url" ]; then
        echo "[start] Auth fetch failed; retrying with public GitHub URL"
        git -C "$repo_dir" remote set-url origin "$public_url" || true
        git -C "$repo_dir" fetch origin "$branch" --depth=1 2>&1 | head -5
      else
        return 1
      fi
    fi

    git -C "$repo_dir" reset --hard "origin/$branch"
    echo "[start] Repo updated to $(git -C $repo_dir rev-parse --short HEAD)"
  else
    echo "[start] Cloning repo into $repo_dir (branch: $branch)..."
    if ! git clone --depth=1 --branch "$branch" "$auth_url" "$repo_dir"; then
      if [ "$auth_url" != "$public_url" ]; then
        echo "[start] Auth clone failed; retrying with public GitHub URL"
        git clone --depth=1 --branch "$branch" "$public_url" "$repo_dir"
      else
        return 1
      fi
    fi
    echo "[start] Clone complete: $(git -C $repo_dir rev-parse --short HEAD)"
  fi
}

if [ -n "$REPO_URL" ]; then
  if ! sync_repo "$REPO_URL" "$REPO_BRANCH" "$REPO_DIR"; then
    echo "[start] WARNING: repo sync failed; continuing without repo-dependent setup"
  fi

  TRAINING_REFRESH_ON_START="${BOB_TRAINING_REFRESH_ON_START:-true}"
  if [ "$TRAINING_REFRESH_ON_START" = "true" ]; then
    if [ -f "$REPO_DIR/scripts/auto-ingest.mjs" ]; then
      echo "[start] Refreshing docs/BOB_BRAIN_DUMP.md via auto-ingest..."
      if ! (cd "$REPO_DIR" && node scripts/auto-ingest.mjs); then
        echo "[start] WARNING: auto-ingest failed; keeping existing brain dump"
      fi
    fi
    if [ -f "$REPO_DIR/scripts/generate-runpod-training-memory.mjs" ]; then
      echo "[start] Refreshing runpod-worker/training_memory.json..."
      if ! (cd "$REPO_DIR" && node scripts/generate-runpod-training-memory.mjs); then
        echo "[start] WARNING: training memory refresh failed; keeping existing training memory"
      fi
    fi
  fi

  if [ -f "$REPO_DIR/runpod-worker/training_memory.json" ]; then
    cp -f "$REPO_DIR/runpod-worker/training_memory.json" /app/training_memory.json
    echo "[start] Synced training memory to /app/training_memory.json"
  fi

  # Install repo dependencies only when explicitly enabled.
  if [ -f "$REPO_DIR/package.json" ]; then
    if [ "$PREP_REPO_NODE_DEPS_ON_START" = "true" ]; then
      echo "[start] Installing repo Node deps..."
      if ! (cd "$REPO_DIR" && npm install --legacy-peer-deps --silent 2>&1 | tail -3); then
        echo "[start] WARNING: npm install failed in $REPO_DIR"
      fi
    else
      echo "[start] Skipping repo Node deps install (RUNPOD_PREP_REPO_NODE_DEPS_ON_START=${PREP_REPO_NODE_DEPS_ON_START})"
    fi
    cd /app
  fi

  # Prepare inference-service models/config so translation/vision/audio paths
  # behave the same way as pod runtime during realignment validation.
  INFERENCE_DIR="$REPO_DIR/inference-service"
  if [ "$PREP_MODELS_ON_START" = "true" ] && [ -f "$INFERENCE_DIR/scripts/download-models.js" ]; then
    echo "[start] Downloading ONNX models for inference-service..."
    if ! (cd "$INFERENCE_DIR" && node scripts/download-models.js); then
      echo "[start] WARNING: model download failed; continuing with preloaded models"
    fi
  else
    echo "[start] Skipping ONNX model download (RUNPOD_PREP_MODELS_ON_START=${PREP_MODELS_ON_START})"
  fi

  if [ -d "$INFERENCE_DIR/models" ]; then
    mkdir -p /app/models
    [ -f "$INFERENCE_DIR/models/yolov8n.onnx" ] && cp -f "$INFERENCE_DIR/models/yolov8n.onnx" /app/models/yolov8n.onnx || true
    [ -f "$INFERENCE_DIR/models/mobilenet_v3.onnx" ] && cp -f "$INFERENCE_DIR/models/mobilenet_v3.onnx" /app/models/mobilenet_v3.onnx || true
  fi

  # Write .env for tests — inject required Supabase + inference vars
  ENV_FILE="$REPO_DIR/.env"
  {
    [ -n "$VITE_SUPABASE_URL" ]      && echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL"
    [ -n "$VITE_SUPABASE_ANON_KEY" ] && echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY"
    [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
    [ -n "$INFERENCE_SERVICE_URL" ]  && echo "INFERENCE_SERVICE_URL=$INFERENCE_SERVICE_URL"
    [ -n "$INFERENCE_API_KEY" ]      && echo "INFERENCE_API_KEY=$INFERENCE_API_KEY"
  } > "$ENV_FILE"
  echo "[start] .env written to $ENV_FILE"
else
  echo "[start] GITHUB_REPO_URL not set — skipping repo clone (run_playwright will use /app only)"
fi

MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"

if [ "$USE_LOCAL_OLLAMA" = "true" ]; then
  echo "[start] Starting local Ollama daemon..."
  ollama serve &
  OLLAMA_PID=$!

  echo "[start] Waiting for Ollama to be ready (HTTP 200 on /api/tags)..."
  until curl -sf "$RESOLVED_OLLAMA_URL/api/tags" > /dev/null 2>&1; do
    sleep 1
  done
  sleep 2
  echo "[start] Ollama is ready"

  echo "[start] Verifying model $MODEL is available (pre-baked at build time)..."
  if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
    echo "[start] Model not found, pulling..."
    ollama pull "$MODEL"
  fi

  echo "[start] Warming up model $MODEL (first request loads weights into VRAM)..."
  MAX_WARMUP_ATTEMPTS="${RUNPOD_MAX_WARMUP_ATTEMPTS:-10}"
  WARMUP_ATTEMPTS=0
  until python3 -c "
import requests, sys
try:
    base_url = '${RESOLVED_OLLAMA_URL}'
    r = requests.post(f'{base_url}/api/chat',
        json={'model': '${MODEL}', 'messages': [{'role':'user','content':'hi'}], 'stream': False},
        timeout=120)
    if r.status_code == 404:
        r = requests.post(f'{base_url}/api/generate',
            json={'model': '${MODEL}', 'prompt': 'hi', 'stream': False},
            timeout=120)
    r.raise_for_status()
    data = r.json()
    preview = (data.get('message', {}) or {}).get('content') or data.get('response') or '?'
    print('[start] Warm-up OK:', str(preview)[:40])
    sys.exit(0)
except Exception as e:
    print('[start] Warm-up not ready:', e)
    sys.exit(1)
"; do
    WARMUP_ATTEMPTS=$((WARMUP_ATTEMPTS+1))
    if [ "$WARMUP_ATTEMPTS" -ge "$MAX_WARMUP_ATTEMPTS" ]; then
      echo "[start] WARNING: warm-up did not complete after ${MAX_WARMUP_ATTEMPTS} attempts, starting handler anyway"
      break
    fi
    sleep 5
  done
  echo "[start] Model warm-up complete"
else
  echo "[start] External Ollama mode: skipping local daemon boot and warmup"
fi

# ---------------------------------------------------------------------------
# Inference-service (Bob HTTP API on port 3000)
# Starts when the repo was cloned and inference-service/server.js is present.
# Enable by setting GITHUB_REPO_URL; controlled by BOB_INFERENCE_SERVICE=true.
# ---------------------------------------------------------------------------
INFERENCE_SVC_DIR="${REPO_DIR}/inference-service"
BOB_INFERENCE_SERVICE="${BOB_INFERENCE_SERVICE:-true}"
if [ "$BOB_INFERENCE_SERVICE" = "true" ] && [ -f "${INFERENCE_SVC_DIR}/server.js" ]; then
  VISION_MODEL="${OLLAMA_VISION_MODEL:-llama3.2-vision:11b}"
  if [ "$USE_LOCAL_OLLAMA" = "true" ]; then
    echo "[start] Ensuring vision model is available: ${VISION_MODEL}"
    if ! ollama list 2>/dev/null | grep -q "${VISION_MODEL}"; then
      if ! ollama pull "${VISION_MODEL}"; then
        echo "[start] WARNING: Failed to pull ${VISION_MODEL}; falling back to llava:7b"
        VISION_MODEL="llava:7b"
        ollama pull "${VISION_MODEL}" || true
      fi
    fi
  else
    echo "[start] Using external Ollama for vision model: will use $RESOLVED_OLLAMA_URL"
  fi

  echo "[start] Setting up inference-service env..."
  cat > "${INFERENCE_SVC_DIR}/.env" <<EOF
PORT=3000
NODE_ENV=production
BOB_OPERATING_MODE=${BOB_OPERATING_MODE:-build-training}
OLLAMA_BASE_URL=${RESOLVED_OLLAMA_URL}
CHAT_PROVIDER=${CHAT_PROVIDER:-ollama}
TABULAR_NLP_PROVIDER=${TABULAR_NLP_PROVIDER:-heuristic}
OLLAMA_VISION_MODEL=${VISION_MODEL}
SELF_CONTAINED_MODE=false
SELF_CONTAINED_STRICT_EGRESS=false
REQUIRE_SELF_CONTAINED_MODE=false
OLLAMA_AUTO_PULL_MODELS=false
YOLO_MODEL_PATH=${INFERENCE_SVC_DIR}/models/yolov8n.onnx
EMBEDDING_MODEL_PATH=${INFERENCE_SVC_DIR}/models/mobilenet_v3.onnx
WHISPER_SERVICE_URL=${WHISPER_SERVICE_URL:-}
ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY:-}
BOB_ENABLE_TTS=${BOB_ENABLE_TTS:-true}
BOB_ENABLE_STT=${BOB_ENABLE_STT:-true}
BOB_ENABLE_AUDIO_ANALYSIS=${BOB_ENABLE_AUDIO_ANALYSIS:-true}
BOB_ENABLE_UI_VISION=${BOB_ENABLE_UI_VISION:-true}
DOCTOR_REQUIRE_ONNX_MODELS=false
DOCTOR_OLLAMA_PROBE_TIMEOUT_MS=12000
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://kxwjcupuxnnbnzcgmkoi.supabase.co}
EOF
  echo "[start] Installing inference-service deps..."
  cd "${INFERENCE_SVC_DIR}"
  npm ci --omit=dev 2>/dev/null || npm install --production
  cd /app
  echo "[start] Starting inference-service on port 3000..."
  node "${INFERENCE_SVC_DIR}/server.js" > /var/log/bob-inference.log 2>&1 &
  BOB_PID=$!
  # Wait up to 30s for it to become healthy
  for i in $(seq 1 15); do
    if curl -fsS --max-time 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
      echo "[start] inference-service healthy (pid ${BOB_PID})"
      break
    fi
    sleep 2
  done
else
  echo "[start] inference-service skipped (BOB_INFERENCE_SERVICE=${BOB_INFERENCE_SERVICE}, dir=${INFERENCE_SVC_DIR})"
fi

exec python3 handler.py
