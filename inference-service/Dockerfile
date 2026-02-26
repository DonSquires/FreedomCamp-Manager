# Multi-stage build for optimized production image
# NOTE: We use node:18-slim (Debian) NOT node:18-alpine.
# onnxruntime-node ships pre-built glibc binaries; they crash on Alpine (musl libc).

# Stage 1: Build dependencies + download + export ONNX models
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for scripts)
COPY package*.json ./
RUN npm install --no-audit --prefer-offline || npm install --no-audit

# Python3 + pip for ONNX model export (builder stage only — NOT copied to production)
# torch CPU-only wheel (~250 MB) is much smaller than the default GPU wheel (~2 GB).
RUN apt-get update && apt-get install -y python3 python3-pip --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU + torchvision (for MobileNetV3 export) + ultralytics (for YOLOv8n export)
# Pinned to stable compatible versions; CPU-only wheel (~250 MB) avoids the 2 GB GPU wheel.
RUN pip3 install --no-cache-dir \
      "torch>=2.1,<3.0" "torchvision>=0.16,<1.0" \
        --extra-index-url https://download.pytorch.org/whl/cpu \
      "ultralytics>=8.0,<9.0" \
      "onnx>=1.14,<2.0"

# Copy download script and run it to bake models into image at build time
COPY scripts ./scripts
COPY models  ./models

# Step 1: Download yolov8n.pt (validates HTTP status + file size — no more silent 404 writes)
# Step 2: Export yolov8n.pt → yolov8n.onnx and MobileNetV3-Large → mobilenet_v3.onnx
RUN node scripts/download-models.js && python3 scripts/export-models.py

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
