# PTT Bridge Service Docker Configuration
# Use with RunPod Serverless for deployed TTT translation

FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy server code
COPY server.js .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8273/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Run service
EXPOSE 8273
CMD ["node", "server.js"]
