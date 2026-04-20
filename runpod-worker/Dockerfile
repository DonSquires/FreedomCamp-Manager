FROM node:20-slim

WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Copy package.json (no dependencies, so no npm install needed)
COPY package.json ./

COPY handler.js ./

CMD ["node", "handler.js"]
