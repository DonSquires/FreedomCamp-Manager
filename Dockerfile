# Node.js 23 Alpine for Bob/Service
FROM node:23-alpine

# Set working directory
WORKDIR /app

# Copy package and lock files if present
COPY package.json ./
COPY bun.lock ./

# Install dependencies (prefer Bun if present, fallback to npm)
RUN if [ -f bun.lock ]; then \
    npm install -g bun && bun install; \
  else \
    npm install; \
  fi

# Copy the rest of the app
COPY . .

# Expose default app port (change as needed)
EXPOSE 3000

# Default command (change as needed)
CMD ["bun", "run", "start"]
