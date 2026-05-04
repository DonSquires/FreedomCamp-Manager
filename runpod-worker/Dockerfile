FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install base + media/runtime dependencies for serverless Bob capabilities:
# - Playwright browsers (chromium/firefox/webkit)
# - vision/image processing
# - audio IO + speech helpers (listen/speak paths)
# - repo orchestration + JSON tooling
RUN apt-get update && apt-get install -y \
  curl ca-certificates zstd git unzip \
    python3 python3-pip python3-venv python3-dev \
    build-essential jq \
    ripgrep fd-find fzf tree less vim nano tmux htop zip rsync openssh-client \
    espeak-ng ffmpeg sox alsa-utils pulseaudio-utils libsndfile1 \
    libasound2 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnspr4 libnss3 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libxkbcommon0 libxshmfence1 \
    libxss1 libxtst6 libcairo2 libpango-1.0-0 libglib2.0-0 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------------------
# Pin Ollama to a known-good version that fully supports /api/chat, streaming,
# and the multimodal messages format (introduced in 0.1.14, stable from 0.3.x).
# Pinning prevents silent breakage when install.sh rolls forward to a new
# release. Update OLLAMA_VERSION deliberately after testing a new build.
# ----------------------------------------------------------------------------
ENV OLLAMA_VERSION=0.6.5
RUN OLLAMA_VERSION=${OLLAMA_VERSION} curl -fsSL https://ollama.com/install.sh | sh
RUN ollama --version

# ---------------------------------------------------------------------------
# Pre-pull models at build time so workers start instantly (no runtime download)
#
# Model roster (3 logical roles, 2 Ollama pulls):
#   1. qwen2.5:7b          — Bob chat / reasoning / Dr Bob reviewer  (~5 GB Q4)
#   2. llama3.2-vision:11b — Vision: biosecurity plant ID + smoke assessment (~7 GB)
#
# Noise/audio classification uses a separate ONNX model (yamnet.onnx) pulled by
# the inference-service at startup via download-models.js — NOT an Ollama model.
#
# VRAM budget: ~12 GB total — fits L4/A10G (24 GB) with concurrency headroom.
# ---------------------------------------------------------------------------
ENV OLLAMA_MODEL=qwen2.5:7b
ENV DR_BOB_MODEL=qwen2.5:7b
ENV OLLAMA_VISION_MODEL=llama3.2-vision:11b
RUN ollama serve & \
    until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do sleep 2; done && \
    echo "[build] Pulling model 1/2: qwen2.5:7b (Bob chat + Dr Bob reviewer)" && \
    ollama pull qwen2.5:7b && \
    echo "[build] Pulling model 2/2: llama3.2-vision:11b (biosecurity + smoke vision)" && \
    ollama pull llama3.2-vision:11b && \
    echo "[build] Verifying model 1 — /api/chat qwen2.5:7b ..." && \
    curl -sf -X POST http://localhost:11434/api/chat \
      -H 'Content-Type: application/json' \
      -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"ping"}],"stream":false}' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('message'), 'qwen2.5:7b /api/chat check failed'" && \
    echo "[build] Verifying model 2 — /api/chat llama3.2-vision:11b ..." && \
    curl -sf -X POST http://localhost:11434/api/chat \
      -H 'Content-Type: application/json' \
      -d '{"model":"llama3.2-vision:11b","messages":[{"role":"user","content":"ping"}],"stream":false}' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('message'), 'llama3.2-vision:11b /api/chat check failed'" && \
    echo "[build] All Ollama models verified OK" && \
    pkill ollama || true

# Python runtime helpers for serverless pathways:
# - runpod/requests: transport
# - pillow/opencv: screenshot + visual processing
# - soundfile/librosa: audio feature extraction for listen/tone analysis
RUN pip3 install --no-cache-dir \
  runpod requests pillow numpy opencv-python-headless soundfile librosa

# ---------------------------------------------------------------------------
# Node.js 20 + npm — required for autonomous Playwright test execution
# (run_playwright action in handler.py)
# ---------------------------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Bun runtime for Bun-first repositories (this repo includes bun.lock)
RUN curl -fsSL https://bun.sh/install | bash && \
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# Additional CLI toolkit used for coding/ops in serverless containers.
# Includes GitHub CLI, Supabase CLI, Railway CLI, and RunPod CLI helper.
RUN apt-get update && apt-get install -y gh && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN npm install -g @railway/cli supabase && \
  npm cache clean --force

RUN RUNPODCTL_TAG="$(curl -fsSL https://api.github.com/repos/runpod/runpodctl/releases/latest | jq -r '.tag_name')" && \
  curl -fsSL "https://github.com/runpod/runpodctl/releases/download/${RUNPODCTL_TAG}/runpodctl-linux-amd64" -o /usr/local/bin/runpodctl && \
  chmod +x /usr/local/bin/runpodctl

# Convenience alias expected by your workflow (`gr` -> `rg`).
RUN ln -sf /usr/bin/rg /usr/local/bin/gr

# ---------------------------------------------------------------------------
# Capability-oriented defaults (non-secret). Secrets are injected at runtime.
# ---------------------------------------------------------------------------
ENV RUNPOD_WORKER_MODE=serverless
ENV RUNPOD_RUNTIME_MODE=serverless
ENV OLLAMA_BASE_URL=http://127.0.0.1:11434
ENV OLLAMA_TIMEOUT_MS=120000
ENV BOB_ATTITUDE_PROFILE=operational
ENV BOB_ATTITUDE_INSTRUCTIONS=
ENV TRAINING_MEMORY_PATH=/app/training_memory.json
ENV BOB_TRAINING_REFRESH_ON_START=true
ENV BOB_ENABLE_UI_VISION=true
ENV BOB_ENABLE_AUDIO_ANALYSIS=true
ENV BOB_ENABLE_TTS=true
ENV BOB_ENABLE_STT=true
ENV BOB_INFERENCE_SERVICE=true
ENV WHISPER_SERVICE_URL=
ENV ELEVENLABS_API_KEY=
ENV ELEVENLABS_VOICE_ID=
ENV CHAT_PROVIDER=ollama
ENV TABULAR_NLP_PROVIDER=heuristic
ENV INFERENCE_SERVICE_URL=http://127.0.0.1:3000
ENV INFERENCE_API_KEY=
ENV RUNPOD_ENDPOINT_ID=
ENV RUNPOD_RUNSYNC_URL=
ENV RUNPOD_API_KEY=
ENV GITHUB_REPO_URL=
ENV GITHUB_REPO_BRANCH=main
ENV GITHUB_TOKEN=
ENV DEFAULT_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173
ENV PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173
ENV PTT_SERVER_URL=http://127.0.0.1:3002
ENV PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

WORKDIR /app

COPY handler.py start.sh start_mode.sh training_memory.json package.json ./

# Install startup scripts in a path that cannot be shadowed by runtime mounts.
RUN install -m 0755 start.sh /usr/local/bin/start.sh && \
  install -m 0755 start_mode.sh /usr/local/bin/start_mode.sh

# Fail fast during image build if handler.py has syntax issues.
RUN python3 -m py_compile /app/handler.py

# Install Playwright + browser runtimes so run_playwright supports
# chromium/firefox/webkit projects in serverless worker jobs.
RUN npm install --save-dev @playwright/test && \
  npx playwright install --with-deps chromium firefox webkit
RUN chmod +x start.sh start_mode.sh

CMD ["/usr/local/bin/start_mode.sh"]
