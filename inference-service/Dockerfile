# Stage 0: Export ONNX models using Python
# We use python:3.11-slim to ensure compatibility with Ultralytics
FROM python:3.11-slim AS model-exporter

WORKDIR /export

# [FIX 1] Install system libraries required by OpenCV/Ultralytics
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# [FIX 2] Add 'onnxscript' to dependencies
# PyTorch's ONNX exporter requires onnxscript to function correctly
RUN pip install --no-cache-dir \
    "ultralytics>=8.0,<9.0" \
    "torch>=2.0,<3.0" \
    "torchvision>=0.15,<1.0" \
    "onnx>=1.14,<2.0" \
    "onnxscript" \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Run the export script
COPY scripts/export-models.py scripts/export-models.py
RUN python scripts/export-models.py

# Stage 1: Build Node.js Application
FROM node:18-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --prefer-offline

# Re-install only production dependencies
RUN npm prune --omit=dev

# Stage 2: Final Production Image
FROM node:18-slim

WORKDIR /app

# Copy node_modules and app source
COPY --from=builder /app/node_modules ./node_modules
COPY server.js ./

# Copy the VALID models generated in Stage 0
COPY --from=model-exporter /export/models ./models

# Security: Run as non-root
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -m nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"

CMD ["node", "server.js"]

