FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

# Install Node.js 20 and curl
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY handler.js start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
