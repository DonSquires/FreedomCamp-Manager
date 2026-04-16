# PTT Signaling Server - Railway Deployment
FROM node:20-slim

WORKDIR /app

# Default to production — Railway can override via environment variables if needed
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --no-audit --prefer-offline

# Copy server code
COPY server.js ./

# Expose port (Railway auto-assigns via $PORT)
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3002) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server
CMD ["node", "server.js"]
