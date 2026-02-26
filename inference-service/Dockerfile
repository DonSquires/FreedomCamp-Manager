# Multi-stage build for optimized production image
# NOTE: We use node:18-slim (Debian) NOT node:18-alpine.
# onnxruntime-node ships pre-built glibc binaries; they crash on Alpine (musl libc).

# Stage 0: Python model exporter
# Exports yolov8n.onnx (via ultralytics) and mobilenet_v3.onnx (via torchvision).
# Only the ~27 MB ONNX files survive into the next stage; Python/torch are discarded.
FROM python:3.11-slim AS model-exporter

WORKDIR /models

# Install CPU-only PyTorch + torchvision first (large wheel, cached separately),
# then ultralytics and onnx.
RUN pip install --no-cache-dir \
      "torch>=2.0.0,<3.0.0" \
      "torchvision>=0.15.0" \
      --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir \
      "ultralytics>=8.0.0,<9.0.0" \
      "onnx>=1.14.0"

# Copy and run the export script (produces /models/yolov8n.onnx and /models/mobilenet_v3.onnx)
COPY scripts/export-models.py ./export-models.py
RUN python export-models.py

# Stage 1: Build dependencies + bake models into image
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for scripts)
COPY package*.json ./
RUN npm install --no-audit --prefer-offline || npm install --no-audit

# Bring in the pre-exported ONNX models from the Python stage
COPY --from=model-exporter /models ./models

# Copy scripts and run download-models.js — it detects the models already exist
# (size check passes) and skips downloading, acting only as a validation step.
COPY scripts ./scripts
RUN node scripts/download-models.js

# Re-install production-only deps after model download
RUN npm prune --omit=dev

# Stage 2: Production image
FROM node:18-slim

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY server.js ./

# Copy baked-in ONNX models (~27 MB total — eliminates degraded-mode warning)
COPY --from=builder /app/models ./models

# Create non-root user (Debian syntax — node:18-slim is Debian-based)
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -m nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"

# Start server
CMD ["node", "server.js"]
