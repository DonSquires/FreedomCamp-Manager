FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Serverless-first worker image. Build: 2026-05-19 - set GHCR package to public for RunPod pull.
# Build trigger note: keep this file change-safe so workflow path triggers can republish GHCR image.
# - no CUDA base
# - no local Ollama install
# - no baked Ollama models
# - optimized for RunPod serverless orchestration with external Ollama
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git jq unzip zstd \
  build-essential \
  nodejs npm \
  espeak-ng ffmpeg sox alsa-utils libsndfile1 \
  libasound2 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
  libnspr4 libnss3 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libxkbcommon0 libxshmfence1 \
  libxss1 libxtst6 libcairo2 libpango-1.0-0 libglib2.0-0 \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Bun is retained because the repo is Bun-first and startup scripts may rely on it.
RUN curl -fsSL https://bun.sh/install | bash && \
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# ---------------------------------------------------------------------------
# Capability-oriented defaults (non-secret). Secrets are injected at runtime.
# ---------------------------------------------------------------------------
ENV RUNPOD_WORKER_MODE=serverless
ENV RUNPOD_RUNTIME_MODE=serverless
ENV RUNPOD_FAST_BOOT=true
ENV OLLAMA_EXTERNAL_URL=https://ollama-production-3ab0.up.railway.app
ENV OLLAMA_BASE_URL=https://ollama-production-3ab0.up.railway.app
ENV OLLAMA_MODEL=qwen2.5:7b
ENV OLLAMA_VISION_MODEL=llama3.2-vision:11b
ENV OLLAMA_TIMEOUT_MS=120000
ENV BOB_ATTITUDE_PROFILE=operational
ENV BOB_ATTITUDE_INSTRUCTIONS=
ENV TRAINING_MEMORY_PATH=/app/training_memory.json
ENV BOB_TRAINING_REFRESH_ON_START=false
ENV BOB_ENABLE_UI_VISION=true
ENV BOB_ENABLE_AUDIO_ANALYSIS=true
ENV BOB_ENABLE_TTS=true
ENV BOB_ENABLE_STT=true
ENV BOB_INFERENCE_SERVICE=false
ENV RUNPOD_PREP_REPO_NODE_DEPS_ON_START=false
ENV RUNPOD_PREP_MODELS_ON_START=false
ENV RUNPOD_MAX_WARMUP_ATTEMPTS=3
ENV WHISPER_SERVICE_URL=https://fieldops-railway-stt-production.up.railway.app
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
ENV OPENAI_REFERENCE_GATE_ENABLED=true
ENV ALLOW_OPENAI_REFERENCE_PROVIDER=false
ENV ALLOW_OPENAI_RUNTIME=true
ENV OPENAI_ALLOWED_PURPOSES=research,training
ENV OPENAI_MODEL=gpt-4o-mini
ENV OPENAI_BASE_URL=https://api.openai.com/v1
ENV OPENAI_API_KEY=

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY handler.py training_memory.json package.json ./

# Fail fast during image build if handler.py has syntax issues.
RUN python3 -m py_compile /app/handler.py

# Install Playwright and browser runtimes for run_playwright jobs.
RUN npm install --save-dev @playwright/test && \
  npx playwright install --with-deps chromium firefox webkit

# RunPod Serverless requirement:
# - the container default command must start a long-running handler process
# - the handler must stay alive and read jobs from RunPod
# - do not use one-shot local test commands as container default
# Build trigger note: lowercase GHCR tag fix rollout trigger.
CMD ["python3", "-u", "handler.py"]
