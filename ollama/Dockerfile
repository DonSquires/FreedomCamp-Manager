# Ollama LLM Server - Railway Deployment
# Provides local LLM inference for Bob (inference-service) via Railway private network.
# Pin the image version to avoid surprise upgrades; bump deliberately.
FROM ollama/ollama:0.20.2

# Railway assigns $PORT; Ollama uses OLLAMA_HOST for its listen address.
ENV OLLAMA_HOST=0.0.0.0:11434

# Allow requests from any origin (Bob connects via Railway private network).
ENV OLLAMA_ORIGINS=*

# Keep models loaded in memory for 24 hours to minimize cold-start latency.
ENV OLLAMA_KEEP_ALIVE=24h

# Explicitly disable Ollama cloud connectivity for privacy-safe operation.
ENV OLLAMA_NO_CLOUD=true

EXPOSE 11434
