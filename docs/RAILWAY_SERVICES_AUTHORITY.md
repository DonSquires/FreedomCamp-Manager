# Railway Services Authority Map

**Updated:** May 6, 2026  
**Purpose:** Current source of truth for Railway ownership after the Voice VPS + RunPod Serverless migration.

## Active Railway Scope

Railway hosts two active production services: the Proxy and the Ollama inference instance.

### Active Service: Proxy Server (`proxy-server/` — NZSCV/MotorWeb)

> Manages vehicle registration lookups.

### Active Service: Ollama (`ollama-production-3ab0.up.railway.app`)

| Property | Value |
|---|---|
| **Owns** | LLM inference for Bob chat and speech intent |
| **Runtime** | Ollama v0.20.2, CPU, 22 GiB RAM, us-west2 |
| **Used by** | `runpod-worker/handler.py` via `OLLAMA_EXTERNAL_URL`; speech-router `INTENT_URL` |
| **Public URL** | `https://ollama-production-3ab0.up.railway.app` |

> This is a live production service. Do not retire without a validated replacement.

| Property | Value |
|---|---|
| **Owns** | Vehicle registration lookup (NZ NZSCV + MotorWeb) |
| **Code Location** | `/proxy-server/` (Node/Express) |
| **Deploy Authority** | FreedomCamp-Manager |
| **Railway Project** | Core/Admin project |
| **Railway Service** | `proxy` / `proxy-server` |
| **Deploy Workflow** | `.github/workflows/deploy-proxy-railway.yml` |
| **Public URL** | `https://<railway-domain>.railway.app` |

## Retired Railway Services (Do Not Restore)

These workloads were intentionally migrated off Railway:

| Service | New Home | Status |
|---|---|---|
| Bob inference gateway | RunPod Serverless endpoint | Active on RunPod |
| PTT signaling | Voice VPS (`72.61.123.97`) | Active on Voice VPS |

## Secrets (Railway)

Only proxy-related Railway secrets should be used for active deploys:

| Secret | Service(s) | Purpose |
|---|---|---|
| `RAILWAY_TOKEN` / `RAILWAY_PROXY_TOKEN` | Proxy | Railway project token |
| `RAILWAY_PROXY_SERVICE_ID` | Proxy | Railway service ID |
| `PROXY_SERVICE_URL` | Proxy | Public proxy URL |

## Guardrail

- Do not add new Railway deploy workflows for PTT (lives on Voice VPS).
- Ollama on Railway is intentional and production. Changes to it require an ADR.
- Do not move Ollama off Railway without benchmarking the replacement first.
