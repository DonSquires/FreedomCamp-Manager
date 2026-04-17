# Ollama LLM Server - Railway Deployment
# Provides local LLM inference for Bob (inference-service) via Railway private network.
# Pin the image version to avoid surprise upgrades; bump deliberately.
FROM ollama/ollama:0.20.2

# Default port for local/manual runs. On Railway, start.sh maps OLLAMA_HOST
# to 0.0.0.0:${PORT} at runtime so healthchecks hit the correct port.
ENV PORT=11434

# Allow requests from any origin (Bob connects via Railway private network).
ENV OLLAMA_ORIGINS=*

# Keep models loaded in memory for 24 hours to minimize cold-start latency.
ENV OLLAMA_KEEP_ALIVE=24h

# Explicitly disable Ollama cloud connectivity for privacy-safe operation.
ENV OLLAMA_NO_CLOUD=true

# Model to pre-pull on first startup. Override this Railway env var to switch
# models without rebuilding the image (e.g. llama3.1:8b, mistral:7b).
ENV OLLAMA_MODEL=llama3.1:8b

# Optional additional models to pre-pull (comma-separated).
# Default includes a stronger writing model used by Bob for long-form generation.
ENV OLLAMA_EXTRA_MODELS=qwen2.5:14b

EXPOSE 11434

# Copy and enable the startup script that pre-pulls the model so the first
# /api/chat request from Bob does not block while the model downloads.
COPY start.sh /start.sh
RUN chmod +x /start.sh

# The upstream image sets ENTRYPOINT to the `ollama` binary. Clear it so
# Railway executes our startup script instead of passing `/start.sh` as an
# argument to `ollama`.
ENTRYPOINT []

CMD ["/bin/sh", "/start.sh"]
