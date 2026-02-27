# Multi-stage build for optimized production image
# NOTE: We use node:18-slim (Debian) NOT node:18-alpine.
# onnxruntime-node ships pre-built glibc binaries; they crash on Alpine (musl libc).

# Stage 0: Export ONNX models using Python (ultralytics + torchvision)
# Pre-built ONNX download URLs no longer exist; we must export locally.
FROM python:3.11-slim AS model-exporter

WORKDIR /export

RUN pip install --no-cache-dir \
    "ultralytics>=8.0,<9.0" \
    "torch>=2.0,<3.0" \
    "torchvision>=0.15,<1.0" \
    "onnx>=1.14,<2.0" \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY scripts/export-models.py scripts/export-models.py
RUN python scripts/export-models.py

# Stage 1: Build Node.js dependencies
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for scripts)
COPY package*.json ./
RUN npm install --no-audit --prefer-offline || npm install --no-audit

# Re-install production-only deps
RUN npm prune --omit=dev

# Stage 2: Production image
FROM node:18-slim

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY server.js ./

# Copy baked-in ONNX models from Python exporter (~27 MB total)
COPY --from=model-exporter /export/models ./models

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
