# ORC/AI Inference Service — Railway Deployment
# Node.js 20 slim (Debian-based) for native module compatibility.
# onnxruntime-node and sharp both ship pre-built Linux x64 binaries;
# node:20-slim avoids the Alpine musl vs glibc mismatch.

FROM node:20-slim

# Install OS-level dependencies required by sharp (libvips) and onnxruntime-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first to exploit Docker layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy the full service source
COPY . .

# Pre-download ONNX model files so the service starts in full (non-degraded) mode.
# These are small files (total ~40 MB) served from public GitHub / Hugging Face URLs.
# If the download fails at build time the image still builds and the service starts
# in degraded mode, relying on RunPod for GPU inference.
RUN node scripts/download-models.js || echo "⚠️  Model download failed — service will start in degraded mode (RunPod GPU path remains active)"

# Railway injects PORT automatically; default to 3000 locally
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Health check — the /health endpoint always returns 200 with a JSON status report
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "server.js"]
