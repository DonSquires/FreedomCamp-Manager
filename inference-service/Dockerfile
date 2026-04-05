# Stage 0: Export ONNX models using Python
FROM python:3.11-slim AS model-exporter

WORKDIR /export

# [FIX] Install system libraries for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# [FIX] Install onnxscript for PyTorch exporter
RUN pip install --no-cache-dir \
    "ultralytics>=8.0,<9.0" \
    "torch>=2.0,<3.0" \
    "torchvision>=0.15,<1.0" \
    "onnx>=1.14,<2.0" \
    "onnxscript" \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY scripts/export-models.py scripts/export-models.py
RUN python scripts/export-models.py

# Stage 1: Build Node.js Application
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --prefer-offline
COPY data ./data
COPY lib ./lib
COPY scripts/pretrain-self-learning.js ./scripts/pretrain-self-learning.js
RUN node scripts/pretrain-self-learning.js

# Stage 2: Final Production Image
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY server.js ./
COPY lib ./lib
COPY --from=builder /app/data ./data
COPY --from=model-exporter /export/models ./models

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -m nodejs && \
    chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"
CMD ["node", "server.js"]
