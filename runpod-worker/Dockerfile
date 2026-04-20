FROM node:20-slim

WORKDIR /app

# Copy package.json (no dependencies, so no npm install needed)
COPY package.json ./

COPY handler.js ./

CMD ["node", "handler.js"]
