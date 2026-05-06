# FieldOps Manager — STT Worker (Faster-Whisper distil-large-v3)
# Base: CUDA 12.1 / Python 3.11
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip ffmpeg \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pip deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download model during build so first cold start is fast.
# device=cpu + int8 is used here only for the cache download step;
# WHISPER_DEVICE / WHISPER_COMPUTE env vars govern runtime behaviour.
ARG WHISPER_MODEL=distil-large-v3
ENV WHISPER_MODEL=${WHISPER_MODEL} \
    WHISPER_DEVICE=cuda \
    WHISPER_COMPUTE=float16 \
    MAX_AUDIO_SECONDS=120 \
    MAX_AUDIO_B64_MB=25
RUN python3 -c "\
from faster_whisper import WhisperModel; \
WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8'); \
print('Model pre-cached for', '${WHISPER_MODEL}');"

COPY handler.py .

CMD ["python3", "-u", "handler.py"]
