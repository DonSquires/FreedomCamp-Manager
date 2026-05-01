FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies including zstd required by Ollama installer
RUN apt-get update && apt-get install -y \
  curl ca-certificates zstd git unzip \
    python3 python3-pip \
    espeak-ng ffmpeg \
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

# Install runpod Python SDK
RUN pip3 install --no-cache-dir runpod requests

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

WORKDIR /app

COPY handler.py start.sh pod_start.sh training_memory.json package.json ./

# Install startup scripts in a path that cannot be shadowed by runtime mounts.
RUN install -m 0755 start.sh /usr/local/bin/start.sh && \
  install -m 0755 pod_start.sh /usr/local/bin/pod_start.sh

# Fail fast during image build if handler.py has syntax issues.
RUN python3 -m py_compile /app/handler.py

# Install Playwright + browser runtimes so run_playwright supports
# chromium/firefox/webkit projects in pod mode.
RUN npm install --save-dev @playwright/test && \
  npx playwright install --with-deps chromium firefox webkit
RUN chmod +x start.sh pod_start.sh

CMD ["/usr/local/bin/start.sh"]
