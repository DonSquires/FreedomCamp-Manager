# RunPod Ollama Gateway

Lightweight authenticated reverse proxy that sits in front of Ollama on the RunPod pod.

## Purpose

RunPod exposes containers to the internet.  We can't leave port 11434 open without auth.  
This gateway:
- Validates `Authorization: Bearer <BOB_GATEWAY_KEY>` on every request
- Rate-limits per-IP (120 req/min default)
- Adds security headers (helmet)
- Provides an unauthenticated `/gateway/health` endpoint for RunPod health checks
- Restricts `/api/pull` and `/api/delete` (model management) to an optional `BOB_GATEWAY_ADMIN_KEY`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOB_GATEWAY_KEY` | ✅ | Shared secret; callers must send `Authorization: Bearer <key>` |
| `BOB_GATEWAY_ADMIN_KEY` | Optional | Elevated key that also allows model pull/delete |
| `OLLAMA_HOST` | Optional | Ollama base URL inside pod (default: `http://127.0.0.1:11434`) |
| `PORT` | Optional | Gateway listen port (default: `8080`) |
| `NODE_ENV` | Optional | Set to `production` on RunPod |

## Starting on RunPod

RunPod pods run a start script from the Docker image or via the web UI "Start Command" field.  
The simplest approach is to add the gateway to the pod's startup command:

```bash
# In RunPod → Pod → Settings → Start Command
cd /workspace/runpod-gateway && npm install && node server.js &
# Then start Ollama as normal
ollama serve
```

Alternatively, build the gateway into a custom Docker image based on `madiator2011/better-ollama:cuda12.4`:

```dockerfile
FROM madiator2011/better-ollama:cuda12.4
COPY runpod-gateway /opt/gateway
RUN cd /opt/gateway && npm install --production
# Expose gateway + Ollama
EXPOSE 8080 11434
CMD ["/opt/gateway/start.sh"]
```

## RunPod Exposed Port

In RunPod pod settings, expose **port 8080** (the gateway), NOT port 11434 directly.  
Your public URL will look like:
```
https://<pod-id>-8080.proxy.runpod.net
```

Set this as `OLLAMA_BASE_URL` in Railway's inference-service environment.  
The inference-service will send `Authorization: Bearer <BOB_GATEWAY_KEY>` with each request.

## Proxied Endpoints

| Method | Path | Auth tier |
|---|---|---|
| GET | `/gateway/health` | None (liveness probe) |
| GET | `/health` | Standard |
| GET | `/api/tags` | Standard |
| GET | `/api/show` | Standard |
| POST | `/api/generate` | Standard |
| POST | `/api/chat` | Standard |
| POST | `/api/embeddings` | Standard |
| POST | `/api/pull` | Admin only |
| DELETE | `/api/delete` | Admin only |
