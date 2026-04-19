FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    libgomp1 \
    jq \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

ENV SUPABASE_DEBUG=false
ENV BOB_ROLE=service_provider
