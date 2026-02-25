# Multi-stage build for optimized production image
# NOTE: We use node:18-slim (Debian) NOT node:18-alpine.
# onnxruntime-node ships pre-built glibc binaries; they crash on Alpine (musl libc).

# Stage 1: Build dependencies
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
# Using npm install (not npm ci) so this works even if package-lock.json is absent
RUN npm install --omit=dev --no-audit --prefer-offline || npm install --omit=dev --no-audit

# Stage 2: Production image
FROM node:18-slim

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY server.js ./
# Create models directory - ONNX model files are downloaded at first startup
# (they are too large to commit to git; see scripts/download-models.js)
RUN mkdir -p ./models

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
