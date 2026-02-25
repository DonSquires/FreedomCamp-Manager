# Multi-stage build for optimized production image

# Stage 1: Build dependencies
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Stage 2: Production image
FROM node:18-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    libc6-compat \
    libgcc \
    libstdc++

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY server.js ./
# Create models directory - ONNX model files are downloaded at first startup
# (they are too large to commit to git; see scripts/download-models.js)
RUN mkdir -p ./models

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"

# Start server
CMD ["node", "server.js"]
