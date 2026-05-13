FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    libssl-dev libbz2-dev libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
COPY requirements.whisper.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt -r requirements.whisper.txt

COPY main.py ./

ENV PORT=8274
EXPOSE 8274

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8274"]
