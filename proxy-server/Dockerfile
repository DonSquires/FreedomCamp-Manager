# NZSCV / MotorWeb Proxy Server — Railway Deployment
# Node 20 LTS slim image for minimal attack surface.
FROM node:20-slim

# Create non-root user for least-privilege operation
RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

# Copy package files first for cache-efficient layer ordering
COPY package.json ./

# Install production-only dependencies and clear npm cache
RUN npm install --omit=dev && npm cache clean --force

# Copy application source
COPY server.js ./

# Set ownership to non-root user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Railway assigns $PORT dynamically; default to 3000 for local dev
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Health check — Railway uses this to confirm the service is up
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', ()=>process.exit(1))"

CMD ["node", "server.js"]
