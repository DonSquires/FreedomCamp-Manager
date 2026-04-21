FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies including zstd required by Ollama installer
RUN apt-get update && apt-get install -y \
    curl ca-certificates zstd \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Pre-pull model at build time so workers start instantly (no runtime download)
ENV OLLAMA_MODEL=llama3.1:8b
RUN ollama serve & \
    sleep 8 && \
    until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do sleep 1; done && \
    ollama pull llama3.1:8b && \
    pkill ollama || true

WORKDIR /app

COPY handler.js start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
