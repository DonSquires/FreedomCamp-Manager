# Railway Services Authority Map

**Updated:** April 14, 2026  
**Purpose:** Single source of truth for Railway service ownership and deployment authority.

> **For the complete secrets reference** (every secret name, alias, storage location, and setup checklist), see:
> **[docs/SECRETS_REGISTRY.md](SECRETS_REGISTRY.md)**

This doc defines:
- Which GitHub repo owns each Railway service
- Which secrets each service needs
- Where secrets should be stored
- What constitutes a valid deployment

---

## Required Secrets — Quick Reference

| Secret | GitHub Actions | Supabase Vault | Railway: Bob | Railway: Proxy | Railway: PTT |
|---|:---:|:---:|:---:|:---:|:---:|
| `RAILWAY_BOB_TOKEN` | ✅ | | | | |
| `RAILWAY_TOKEN` | ✅ | | | | |
| `RAILWAY_BOB_SERVICE_ID` | ✅ | | | | |
| `RAILWAY_OLLAMA_SERVICE_ID` | ✅ | | | | |
| `RAILWAY_PROXY_SERVICE_ID` | ✅ | | | | |
| `VITE_SUPABASE_URL` | ✅ | | | | |
| `VITE_SUPABASE_ANON_KEY` | ✅ | | | | |
| `SUPABASE_ACCESS_TOKEN` | ✅ | | | | |
| `SUPABASE_PROJECT_REF` | ✅ | | | | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | | | ✅ | ✅ |
| `SUPABASE_DB_PASSWORD` | ✅ | | | | |
| `INFERENCE_API_KEY` | ✅ | ✅ | ✅ | | |
| `VERCEL_TOKEN` | ✅ | | | | |
| `BOB_SYNC_PAT` | ✅ | | | | |
| `BOB_SERVICE_URL` | ✅ | | | | |
| `PROXY_SERVER_URL` | ✅ | ✅ | | | |
| `PTT_SERVER_URL` | ✅ | ✅ | | | |
| `PTT_PROXY_SECRET` | ✅ | ✅ | | | ✅ |
| `INTEL_HMAC_KEY` | ✅ | | ✅ | | |
| `OLLAMA_BASE_URL` | | | ✅ | | |
| `NZSCV_API_KEY` | | | | ✅ | |
| `PTT_JWT_SECRET` | | | | | ✅ |

See [SECRETS_REGISTRY.md](SECRETS_REGISTRY.md) for full details, aliases, and the setup checklist.

> **⚠️ Auth limitation in strict self-contained mode:** When `SELF_CONTAINED_STRICT_EGRESS=true` on Bob,
> user JWT verification (JWKS) is disabled because it requires an outbound network call.
> Edge Functions **must** authenticate to Bob using `INFERENCE_API_KEY` in the `x-inference-api-key` header
> (or `SUPABASE_SERVICE_ROLE_KEY`). User JWTs are **not** accepted by Bob in production.

---

## Services Inventory

### 1. Bob Inference Service (`inference-service/`)

| Property | Value |
|---|---|
| **Owns** | Bob AI inference runtime (llama/Ollama chat) |
| **Code Location** | `/inference-service/` in FreedomCamp-Manager source, synced to `DonSquires/Bob` |
| **Deploy Authority** | `DonSquires/Bob` (canonical) with sync mirrors from FreedomCamp-Manager |
| **Railway Project** | "Bob" project (separate from core) |
| **Railway Service** | `bob` or `bob-inference` or `orc-ai-inference-service` |
| **Deploy Workflow** | `.github/workflows/deploy-bob-railway.yml` (FreedomCamp-Manager) |
| **Internal URL** | `http://bob.railway.internal:3000` (Rail way private networking) |
| **Public URL** | `https://<railway-domain>.railway.app` |

**Required GitHub Actions Secrets (FreedomCamp-Manager):**
- `RAILWAY_BOB_TOKEN` — Railway project token for Bob project (required)
- `RAILWAY_BOB_SERVICE_ID` — Service ID for Bob inference (required if no PROJECT_ID)
- `RAILWAY_BOB_PROJECT_ID` — Project ID for Bob (required if no SERVICE_ID)
- `BOB_SERVICE_URL` — Public Bob URL for post-deploy health check (optional)

**Required Railway Environment Variables (Bob Railway Service):**
- `INFERENCE_API_KEY` — Shared secret for service auth (required for Edge Functions)
- `SELF_CONTAINED_MODE=true` — No outbound cloud calls
- `REQUIRE_SELF_CONTAINED_MODE=true` — Enforce privacy posture
- `SELF_CONTAINED_STRICT_EGRESS=true` — Block all cloud egress strictly
- `OLLAMA_BASE_URL=http://ollama.railway.internal:11434` — Ollama internal URL
- `OLLAMA_MODEL=llama3.1:8b` — Default LLM model
- `SUPABASE_SERVICE_ROLE_KEY` — JWT verification
- `SUPABASE_JWKS_URL` — Standard Supabase auth URL
- `SUPABASE_JWT_ISSUER` — Standard Supabase JWT issuer

---

### 2. Ollama LLM Service (`ollama/`)

| Property | Value |
|---|---|
| **Owns** | Large Language Model inference (llama3.1:8b, etc.) |
| **Code Location** | `/ollama/` (Dockerfile + container config) |
| **Deploy Authority** | FreedomCamp-Manager (push-triggered) |
| **Railway Project** | "Bob" project (shared with Bob service) |
| **Railway Service** | `ollama` or `ollama-production` |
| **Deploy Workflow** | `.github/workflows/deploy-ollama-railway.yml` |
| **Internal URL** | `http://ollama.railway.internal:11434` (Railway private networking) |
| **Public URL** | `https://<railway-domain>.railway.app` (if exposed, not recommended) |

**Required GitHub Actions Secrets (FreedomCamp-Manager):**
- `RAILWAY_BOB_TOKEN` — Railway project token (shared with Bob; required)
- `RAILWAY_OLLAMA_SERVICE_ID` — Service ID for Ollama (required if no PROJECT_ID)
- `RAILWAY_BOB_PROJECT_ID` — Project ID for Bob (required if no SERVICE_ID)
- `OLLAMA_SERVICE_URL` — Public Ollama URL for post-deploy health check (optional)

**Required Railway Environment Variables (Ollama Railway Service):**
- `OLLAMA_HOST=0.0.0.0:11434` — Listen on internal port
- `OLLAMA_NO_CLOUD=true` — No outbound telemetry
- `OLLAMA_KEEP_ALIVE=24h` — Keep model in memory

---

### 3. Proxy Server (`proxy-server/` — NZSCV/MotorWeb)

| Property | Value |
|---|---|
| **Owns** | Vehicle registration lookup (NZ NZSCV + MotorWeb) |
| **Code Location** | `/proxy-server/` (Node/Express) |
| **Deploy Authority** | FreedomCamp-Manager |
| **Railway Project** | Core/Admin project (separate from Bob) |
| **Railway Service** | `proxy` or `nzscv-proxy` or `proxy-server` |
| **Deploy Workflow** | `.github/workflows/deploy-proxy-railway.yml` |
| **Internal URL** | `http://proxy.railway.internal:3000` (if in same project) |
| **Public URL** | `https://<railway-domain>.railway.app` (published, used by app) |

**Required GitHub Actions Secrets (FreedomCamp-Manager):**
- `RAILWAY_TOKEN` — Railway project token for core project (required)
- `RAILWAY_PROXY_SERVICE_ID` — Service ID for proxy server (required)
- `PROXY_SERVICE_URL` — Public proxy URL for post-deploy health check (optional)

**Required Supabase Edge Function Secrets:**
- `PROXY_SERVER_URL` — Public proxy URL (set in Supabase vault)

---

### 4. Core Inference Service (`inference-service/` — ONNX fallback)

| Property | Value |
|---|---|
| **Owns** | ONNX-based local NLP (fallback if Bob/Ollama unavailable) |
| **Code Location** | `/inference-service/` (Node/Express with ONNX models) |
| **Deploy Authority** | FreedomCamp-Manager (also synced to `DonSquires/Bob` but deployed separately) |
| **Railway Project** | Core/Admin project (shared with proxy) |
| **Railway Service** | `inference` or `inference-service` |
| **Deploy Workflow** | `.github/workflows/deploy-railway.yml` |
| **Internal URL** | `http://inference.railway.internal:3000` (if in same project) |
| **Public URL** | `https://<railway-domain>.railway.app` |

**Required GitHub Actions Secrets (FreedomCamp-Manager):**
- `RAILWAY_TOKEN` or `RAILWAY_BOB_TOKEN` — Railway project token (required)
- `RAILWAY_INFERENCE_SERVICE_ID` — Service ID for inference (required)
- `INFERENCE_SERVICE_URL` — Public inference URL for post-deploy health check (optional)

**Required Supabase Edge Function Secrets:**
- `INFERENCE_SERVICE_URL` — Public inference URL
- `INFERENCE_API_KEY` — Shared secret for service auth

---

### 5. PTT Server (`ptt-server/` — Push-to-Talk WebRTC)

| Property | Value |
|---|---|
| **Owns** | Real-time voice communication (WebRTC signaling) |
| **Code Location** | `/ptt-server/` (Node/Express with WebRTC) |
| **Deploy Authority** | FreedomCamp-Manager |
| **Railway Project** | Core/Admin project (shared with proxy + inference) |
| **Railway Service** | `ptt` or `ptt-server` or `push-to-talk` |
| **Deploy Workflow** | `.github/workflows/deploy-ptt-railway.yml` |
| **Internal URL** | `http://ptt.railway.internal:3002` (if in same project) |
| **Public URL** | `https://<railway-domain>.railway.app` |

**Required GitHub Actions Secrets (FreedomCamp-Manager):**
- `RAILWAY_TOKEN` — Railway project token (required)
- `RAILWAY_PTT_SERVICE_ID` — Service ID for PTT server (required)
- `PTT_SERVER_URL` — Public PTT URL for post-deploy health check (optional)
- `PTT_PROXY_SECRET` — Shared PTT auth secret for Supabase sync (optional but strongly recommended)

**Required Supabase Edge Function Secrets:**
- `PTT_SERVER_URL` — Public PTT server URL

---

## Secret Storage Authority

### FreedomCamp-Manager GitHub Actions Secrets

Use these for deploys originating from FreedomCamp-Manager:

| Secret | Service(s) | Source | Type |
|---|---|---|---|
| `RAILWAY_BOB_TOKEN` | Bob + Ollama | Railway → Bob project → Settings → Tokens | Project Token |
| `RAILWAY_BOB_SERVICE_ID` | Bob | Railway → Bob project → Bob service → Settings → Service ID | String UUID |
| `RAILWAY_BOB_PROJECT_ID` | Bob | Railway → Bob project → Settings → Project ID | UUID |
| `RAILWAY_OLLAMA_SERVICE_ID` | Ollama | Railway → Bob project → Ollama service → Settings → Service ID | String UUID |
| `RAILWAY_TOKEN` | Proxy + Inference + PTT | Railway → Core project → Settings → Tokens | Project Token |
| `RAILWAY_PROXY_SERVICE_ID` | Proxy | Railway → Core project → Proxy service → Settings → Service ID | String UUID |
| `RAILWAY_INFERENCE_SERVICE_ID` | Inference | Railway → Core project → Inference service → Settings → Service ID | String UUID |
| `RAILWAY_PTT_SERVICE_ID` | PTT | Railway → Core project → PTT service → Settings → Service ID | String UUID |
| `BOB_SERVICE_URL` | Bob | Manual from Railway after deploy | HTTPS URL |
| `OLLAMA_SERVICE_URL` | Ollama | Optional; rarely exposed | HTTPS URL |
| `PROXY_SERVICE_URL` | Proxy | Manual from Railway after deploy | HTTPS URL |
| `INFERENCE_SERVICE_URL` | Inference | Manual from Railway after deploy | HTTPS URL |
| `PTT_SERVER_URL` | PTT | Manual from Railway after deploy | HTTPS URL |

### DonSquires/Bob GitHub Actions Secrets

Bob's canonical deploy repo should hold:

| Secret | Purpose | Value |
|---|---|---|
| `RAILWAY_TOKEN` | Deploy to Bob project | Railway → Bob project → Settings → Tokens |
| `RAILWAY_SERVICE_ID` | Bob service in Bob project | Railway → Bob project → Bob service → Settings → Service ID |
| `BOB_URL` | Post-deploy health check | Public Railway domain |

### Supabase Vault Secrets

Set via Supabase Dashboard → Edge Functions → Manage Secrets:

| Secret | Service(s) | Value |
|---|---|---|
| `PROXY_SERVER_URL` | onspace-ai-chat, sync functions | Public proxy Railway URL |
| `INFERENCE_SERVICE_URL` | onspace-ai-chat, others | Public inference Railway URL |
| `INFERENCE_API_KEY` | Edge Functions → Bob/Inference | Shared random secret (same on both sides) |
| `PTT_SERVER_URL` | Edge Functions for voice | Public PTT Railway URL |

---

## Deployment Rules

### Mandatory Requirements

1. **All services MUST have explicit service ID secrets.**
   - No fallback chains. (`SERVICE_ID` or `PROJECT_ID`, not both as fallback.)
   - If ID is missing, deploy fails with `::error::` (not warning).

2. **Production tokens MUST be project-scoped, not personal.**
   - Personal tokens are insecure and have different expiry/scope rules.
   - Generate at: Railway → Project → Settings → Tokens

3. **Every deploy MUST validate the token BEFORE attempting push.**
   - Invalid token → hard failure, no silent skip.
   - See `.github/workflows/deploy-railway.yml` for pattern.

4. **Service URLs MUST be published to Supabase Vault after successful deploy.**
   - Automation: post-deploy health check captures URL → Supabase secret update
   - Manual: set in Supabase dashboard if URL is static/known

5. **No ambiguous ownership.**
   - Clear: "Bob deploy authority is DonSquires/Bob"
   - Sync mirrors code, but deploy is canonical in Bob repo
   - FreedomCamp-Manager triggers sync + optional cross-checks only

---

## Missing or Invalid Secrets

If a secret is missing:
- Workflow MUST print the exact secret name needed
- Link to this doc or relevant setup guide
- Exit with non-zero status (`exit 1`)

Example output:
```
::error::Required Bob deploy secrets not configured (RAILWAY_BOB_TOKEN-or-RAILWAY_BOB_TOKEN, RAILWAY_BOB_SERVICE_ID-or-RAILWAY_BOB_PROJECT_ID) — deployment skipped.

Add these GitHub Actions secrets to this repository:
  RAILWAY_BOB_TOKEN       - Railway project token for the Bob project (required)
  RAILWAY_BOB_SERVICE_ID  - Railway service ID for Bob inference service (required if no PROJECT_ID)
  RAILWAY_BOB_PROJECT_ID  - Railway project ID for Bob (required if no SERVICE_ID)

See docs/BOB_PRODUCTION_RAILWAY_SETUP.md for setup instructions.
```

---

## Validation Checklist

Run this before any production deploys:

- [ ] All `RAILWAY_*_SERVICE_ID` secrets are set and non-empty
- [ ] All `RAILWAY_*_TOKEN` / `RAILWAY_TOKEN` secrets are set and non-empty
- [ ] No service is misconfigured to use another service's token (tokenscope mismatch)
- [ ] `RAILWAY_BOB_TOKEN` allows access to "Bob" project (test via `railway service list --json`)
- [ ] `RAILWAY_TOKEN` allows access to core/admin project
- [ ] Each service has its own explicit service ID (no ambiguous fallbacks)
- [ ] Supabase vault has `PROXY_SERVER_URL`, `INFERENCE_SERVICE_URL`, `PTT_SERVER_URL`
- [ ] `INFERENCE_API_KEY` is set identically on: Bob service env + Supabase vault
- [ ] Wiring audit passes all checks (see `ops-railway-wiring-audit.yml`)

---

## Refresh / Rollover Procedure

When a service token expires or needs rotation:

1. Generate new project token in Railway (Project → Settings → Tokens)
2. Update corresponding `RAILWAY_*_TOKEN` secret in GitHub Actions
3. Run post-deploy health check to validate token scope
4. Run wiring audit to confirm Supabase can reach all services
5. Monitor logs for 30 minutes post-rollover

---

## References

- [BOB_PRODUCTION_RAILWAY_SETUP.md](BOB_PRODUCTION_RAILWAY_SETUP.md) — Bob-specific setup
- [RAILWAY_DEPLOYMENT_GUIDE.md](RAILWAY_DEPLOYMENT_GUIDE.md) — General Railway guide
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) — Env var reference
- `.github/workflows/deploy-*.yml` — Deploy workflow implementations
- `.github/workflows/ops-railway-wiring-audit.yml` — Validation wiring audit
