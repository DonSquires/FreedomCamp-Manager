# Railway Services Authority Map

**Updated:** April 19, 2026  
**Purpose:** Current source of truth for Railway ownership after the Voice VPS + RunPod Serverless migration.

## Active Railway Scope

Railway is now used **strictly for the Proxy service / IP address hosting**.

### Active Service: Proxy Server (`proxy-server/` — NZSCV/MotorWeb)

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
| Bob inference | RunPod Serverless endpoint | Active on RunPod |
| Ollama inference | RunPod Serverless endpoint | Active on RunPod |
| PTT signaling | Voice VPS (`72.61.123.97`) | Active on Voice VPS |

## Secrets (Railway)

Only proxy-related Railway secrets should be used for active deploys:

| Secret | Service(s) | Purpose |
|---|---|---|
| `RAILWAY_TOKEN` / `RAILWAY_PROXY_TOKEN` | Proxy | Railway project token |
| `RAILWAY_PROXY_SERVICE_ID` | Proxy | Railway service ID |
| `PROXY_SERVICE_URL` | Proxy | Public proxy URL |

## Guardrail

Do not add new Railway deploy workflows/config for Bob, Ollama, or PTT.
