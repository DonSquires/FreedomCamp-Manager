FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

COPY handler.js ./

CMD ["node", "handler.js"]
