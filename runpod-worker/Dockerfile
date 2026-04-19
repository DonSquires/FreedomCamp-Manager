FROM node:20-slim

WORKDIR /app

# Copy lockfile first for layer-caching of dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY handler.js ./

CMD ["node", "handler.js"]
