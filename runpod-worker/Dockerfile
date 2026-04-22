FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies including zstd required by Ollama installer
RUN apt-get update && apt-get install -y \
    curl ca-certificates zstd \
    python3 python3-pip \
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

# Pre-pull models at build time so workers start instantly (no runtime download)
ENV OLLAMA_MODEL=llama3.1:8b
ENV OLLAMA_VISION_MODEL=llama3.2-vision:11b
RUN ollama serve & \
    until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do sleep 2; done && \
    ollama pull llama3.1:8b && \
    ollama pull llama3.2-vision:11b && \
    # Verify /api/chat endpoint exists before baking the image
    curl -sf -X POST http://localhost:11434/api/chat \
      -H 'Content-Type: application/json' \
      -d '{"model":"llama3.1:8b","messages":[{"role":"user","content":"ping"}],"stream":false}' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('message'), 'No message in /api/chat response'" && \
    echo "[build] /api/chat verified OK" && \
    pkill ollama || true

# Install runpod Python SDK
RUN pip3 install --no-cache-dir runpod requests

WORKDIR /app

COPY handler.py start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
