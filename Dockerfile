# Node.js 23 Alpine for Bob/Service
FROM node:23-alpine

# Set working directory
WORKDIR /app

# Copy package and lock files if present
COPY package.json ./
COPY package-lock.json ./

# Install dependencies with npm
RUN npm ci

# Copy the rest of the app
COPY . .

# Expose default app port (change as needed)
EXPOSE 3000

# Default command (change as needed)
CMD ["npm", "run", "start"]
