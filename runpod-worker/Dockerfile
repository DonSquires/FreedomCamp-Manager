FROM ubuntu:22.04

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "handler.js"]
