# Stage 1: Build Node.js Application + download ONNX runtime assets
FROM node:22-slim AS builder
WORKDIR /app
ARG SKIP_MODEL_DOWNLOADS=false
ARG YOLO_MODEL_URL
ARG EMBEDDING_MODEL_URL
COPY package*.json ./
RUN npm install --omit=dev --no-audit --prefer-offline
COPY models ./models
COPY data ./data
COPY lib ./lib
COPY scripts/download-models.js ./scripts/download-models.js
COPY scripts/pretrain-self-learning.js ./scripts/pretrain-self-learning.js
ENV SKIP_MODEL_DOWNLOADS=${SKIP_MODEL_DOWNLOADS}
ENV YOLO_MODEL_URL=${YOLO_MODEL_URL}
ENV EMBEDDING_MODEL_URL=${EMBEDDING_MODEL_URL}
RUN mkdir -p models && \
  if [ "$SKIP_MODEL_DOWNLOADS" = "true" ]; then \
    echo "Skipping model downloads during image build"; \
  else \
    node scripts/download-models.js; \
  fi
RUN node scripts/pretrain-self-learning.js

# Stage 1b: Build whisper.cpp CLI + download base English model
FROM debian:bookworm-slim AS whisper-builder
WORKDIR /tmp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
WORKDIR /tmp/whisper.cpp
RUN cmake -B build -DWHISPER_BUILD_EXAMPLES=ON && cmake --build build -j2

RUN mkdir -p /out/models && \
    cp build/bin/whisper-cli /out/whisper-cli && \
    curl -L --retry 3 --retry-delay 2 \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true" \
      -o /out/models/ggml-base.en.bin

# Stage 2: Final Production Image
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  espeak-ng \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY server.js ./
COPY lib ./lib
COPY --from=builder /app/data ./data
COPY --from=builder /app/models ./models
COPY --from=whisper-builder /out /app/whisper

ENV WHISPER_CLI_PATH=/app/whisper/whisper-cli
ENV WHISPER_MODEL_PATH=/app/whisper/models/ggml-base.en.bin
ENV AUDIO_TRANSCRIBE_TIMEOUT_MS=20000
ENV AUDIO_SYNTH_TIMEOUT_MS=15000
ENV TTS_ENGINE=espeak-ng
ENV TTS_DEFAULT_VOICE=en-nz
ENV TTS_DEFAULT_RATE=160

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -m nodejs && \
    chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"
CMD ["node", "server.js"]
