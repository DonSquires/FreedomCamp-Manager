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

  # Install Node deps + Playwright config for the repo
  if [ -f "$REPO_DIR/package.json" ]; then
    echo "[start] Installing repo Node deps..."
    if ! (cd "$REPO_DIR" && npm install --legacy-peer-deps --silent 2>&1 | tail -3); then
      echo "[start] WARNING: npm install failed in $REPO_DIR"
    fi
    cd /app
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

echo "[start] Starting Ollama..."
ollama serve &
OLLAMA_PID=$!

echo "[start] Waiting for Ollama to be ready (HTTP 200 on /api/tags)..."
until curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done
# Brief extra wait for model loading after API is live
sleep 2
echo "[start] Ollama is ready"

MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
echo "[start] Verifying model $MODEL is available (pre-baked at build time)..."
# Model is pre-baked — pull only if somehow missing
if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
  echo "[start] Model not found, pulling..."
  ollama pull "$MODEL"
fi
echo "[start] Warming up model $MODEL (first request loads weights into VRAM)..."
WARMUP_ATTEMPTS=0
until python3 -c "
import requests, sys
try:
    # Prefer /api/chat, fallback to /api/generate for older Ollama builds.
    r = requests.post('http://127.0.0.1:11434/api/chat',
        json={'model': '${MODEL}', 'messages': [{'role':'user','content':'hi'}], 'stream': False},
        timeout=120)
    if r.status_code == 404:
        r = requests.post('http://127.0.0.1:11434/api/generate',
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
  if [ "$WARMUP_ATTEMPTS" -ge 10 ]; then
    echo "[start] WARNING: warm-up did not complete after 10 attempts, starting handler anyway"
    break
  fi
  sleep 5
done
echo "[start] Model warm-up complete"
echo "[start] Model warm-up complete"

# ---------------------------------------------------------------------------
# Inference-service (Bob HTTP API on port 3000)
# Starts when the repo was cloned and inference-service/server.js is present.
# Enable by setting GITHUB_REPO_URL; controlled by BOB_INFERENCE_SERVICE=true.
# ---------------------------------------------------------------------------
INFERENCE_SVC_DIR="${REPO_DIR}/inference-service"
BOB_INFERENCE_SERVICE="${BOB_INFERENCE_SERVICE:-true}"
if [ "$BOB_INFERENCE_SERVICE" = "true" ] && [ -f "${INFERENCE_SVC_DIR}/server.js" ]; then
  echo "[start] Setting up inference-service env..."
  cat > "${INFERENCE_SVC_DIR}/.env" <<EOF
PORT=3000
NODE_ENV=production
BOB_OPERATING_MODE=${BOB_OPERATING_MODE:-build-training}
OLLAMA_BASE_URL=http://127.0.0.1:11434
CHAT_PROVIDER=${CHAT_PROVIDER:-ollama}
TABULAR_NLP_PROVIDER=${TABULAR_NLP_PROVIDER:-heuristic}
SELF_CONTAINED_MODE=false
SELF_CONTAINED_STRICT_EGRESS=false
REQUIRE_SELF_CONTAINED_MODE=false
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
