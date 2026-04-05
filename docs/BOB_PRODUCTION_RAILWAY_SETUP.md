# Bob Production Railway Setup

Bob is an independent AI inference service with his own repository: **DonSquires/Bob**.

Code lives in `inference-service/` inside FreedomCamp-Manager and is automatically
mirrored to DonSquires/Bob whenever `inference-service/` changes on `main`.
Railway deploys from DonSquires/Bob.

Recommended architecture: Bob + Ollama in the same Bob Railway project, but as
separate services.

## Repository Setup (one-time)

### 1. Enable sync from FreedomCamp-Manager -> Bob repo

Add a secret to **DonSquires/FreedomCamp-Manager** -> Settings -> Secrets -> Actions:

| Secret | Value |
|---|---|
| `BOB_SYNC_PAT` | GitHub PAT (classic or fine-grained) with **Contents: Read & Write** on `DonSquires/Bob` |

Once set, any push to `main` that touches `inference-service/` automatically syncs
to the Bob repo via `.github/workflows/sync-bob-repo.yml`.

To trigger a one-off sync without a code change, run the workflow manually:
`Actions -> Sync Bob Repo -> Run workflow`.

### 2. Add secrets to the Bob repo

Add these secrets to **DonSquires/Bob** -> Settings -> Secrets -> Actions:

| Secret | Value |
|---|---|
| `RAILWAY_TOKEN` | Railway project token with deploy access to Bob's service |
| `RAILWAY_SERVICE_ID` | Railway project -> Bob service -> Settings -> Service ID |
| `BOB_URL` | Bob's Railway domain (e.g. `https://bob-production.up.railway.app`). Optional; enables post-deploy health check. |

## Current Status

| Component | Status | Domain / Notes |
|---|---|---|
| Bob Inference | ✅ Deployed | `https://focused-courage-production-ccee.up.railway.app` |
| Ollama | ✅ Deployed | `ollama-production-8631.up.railway.app` (us-west2, CPU, 22 GiB RAM, Ollama v0.20.2) |

## Ollama Service Details

- **Image**: `ollama/ollama` (v0.20.2)
- **Region**: us-west2
- **Replicas**: 1
- **Compute**: CPU-only (22.4 GiB RAM available)
- **Internal port**: 11434 (configured via `OLLAMA_HOST=http://0.0.0.0:11434`)
- **Internal URL**: `http://ollama.railway.internal:11434`
- **Keep-alive**: 24 hours (`OLLAMA_KEEP_ALIVE=24h0m0s`)
- **Default context**: 4096 tokens

> **Note**: Railway's Ollama service listens on port **11434**.
> Bob must use `http://ollama.railway.internal:11434` as `OLLAMA_BASE_URL`.

## Setup Steps

### 1. Pull the LLM Model in Ollama

Shell into the Ollama service and pull the model:
```bash
ollama pull llama3.1:8b
```

### 2. Configure Bob Inference Environment Variables

In **Bob Inference service → Settings → Variables**, add exactly these variables:

```
INFERENCE_API_KEY=<strong random secret>
CHAT_PROVIDER=ollama
TABULAR_NLP_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama.railway.internal:11434
OLLAMA_MODEL=llama3.1:8b
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
```

In the Ollama service, also set:

```
OLLAMA_NO_CLOUD=true
```

Plus from your **Supabase dashboard** (Settings → API):
```
SUPABASE_SERVICE_ROLE_KEY=<copy from Supabase>
SUPABASE_JWKS_URL=https://<PROJECT_ID>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://<PROJECT_ID>.supabase.co/auth/v1
```

### 3. Redeploy Bob Inference

In **Bob Inference service → click Redeploy** (or push to `main` on DonSquires/Bob).

### 4. Verify Bob + Ollama

```bash
BOB_URL="https://focused-courage-production-ccee.up.railway.app"

# Test Bob health
curl -sS "$BOB_URL/health" | jq .

# Test Bob chat with Ollama
curl -sS -X POST "$BOB_URL/chat" \
  -H 'Content-Type: application/json' \
  -H 'x-inference-api-key: <your-api-key>' \
  -d '{"message":"hello"}'
```

Expected response: `{"status":"ok","message":"chat response",...}` or similar (non-404).

## Docker and ONNX Build Notes

The Bob image build already performs ONNX export and bundles model artifacts.
No manual model upload step is required.

## Environment Variables

Choose one of the supported runtime profiles below.

### Profile A: Bob + separate Ollama service (recommended)

Use this when Ollama runs as another Railway service via internal DNS.

```env
# --- Core runtime ---
NODE_ENV=production
PORT=3000

# --- Security / auth ---
INFERENCE_API_KEY=REPLACE_WITH_STRONG_RANDOM_SECRET
SUPABASE_URL=https://REPLACE_WITH_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWKS_URL=https://REPLACE_WITH_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://REPLACE_WITH_PROJECT_REF.supabase.co/auth/v1
# Optional:
# SUPABASE_JWT_AUDIENCE=authenticated

# --- Egress mode for separate Ollama service ---
SELF_CONTAINED_MODE=false
REQUIRE_SELF_CONTAINED_MODE=false
SELF_CONTAINED_STRICT_EGRESS=false

# --- Bob chat/nlp via Ollama ---
CHAT_PROVIDER=ollama
TABULAR_NLP_PROVIDER=ollama
CHAT_TIMEOUT_MS=30000
TABULAR_NLP_TIMEOUT_MS=2500

# --- Vision / inference defaults ---
VEHICLE_ATTRS_PROVIDER=basic
SIMILARITY_THRESHOLD=0.85
SIMILARITY_THRESHOLD_MIN=0.65
SIMILARITY_THRESHOLD_MAX=0.95
SELF_LEARNING_ENABLED=true
SELF_HEALING_ENABLED=true

# --- Internal Ollama URL (port 3000 matches OLLAMA_HOST on Railway) ---
OLLAMA_BASE_URL=http://ollama.railway.internal:11434
OLLAMA_MODEL=llama3.1:8b
```

### Profile B: strict self-contained Bob

Use this when you want strict local-only behavior. In this profile, a separate
Railway Ollama hostname is not treated as local by current code, so keep chat/NLP
heuristic unless Ollama is available on localhost in the same container.

```env
# --- Core runtime ---
NODE_ENV=production
PORT=3000

# --- Security / auth ---
INFERENCE_API_KEY=REPLACE_WITH_STRONG_RANDOM_SECRET
SUPABASE_URL=https://REPLACE_WITH_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWKS_URL=https://REPLACE_WITH_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://REPLACE_WITH_PROJECT_REF.supabase.co/auth/v1
# Optional:
# SUPABASE_JWT_AUDIENCE=authenticated

# --- Self-contained posture ---
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true

# --- Bob chat/nlp defaults ---
CHAT_PROVIDER=heuristic
TABULAR_NLP_PROVIDER=heuristic
CHAT_TIMEOUT_MS=30000
TABULAR_NLP_TIMEOUT_MS=2500

# --- Vision / inference defaults ---
VEHICLE_ATTRS_PROVIDER=basic
SIMILARITY_THRESHOLD=0.85
SIMILARITY_THRESHOLD_MIN=0.65
SIMILARITY_THRESHOLD_MAX=0.95
SELF_LEARNING_ENABLED=true
SELF_HEALING_ENABLED=true

# --- Optional same-container Ollama mode ---
# CHAT_PROVIDER=ollama
# TABULAR_NLP_PROVIDER=ollama
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=llama3.1:8b
```

## Verify Deployment

After deploy:

1. GET /health on Bob domain must return healthy JSON.
2. POST /chat on Bob domain must return non-404.
3. Ensure Supabase `INFERENCE_SERVICE_URL` points to Bob domain.
4. If using Profile A, confirm Bob can reach the internal Ollama URL.

Example checks:

```bash
curl -sS https://focused-courage-production-ccee.up.railway.app/health

curl -sS -X POST https://focused-courage-production-ccee.up.railway.app/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"ping"}'
```

For Profile A, also verify Bob logs indicate `CHAT_PROVIDER=ollama`.

## Service Separation Rules

1. Bob inference URL and proxy URL must be different services.
2. Do not use proxy domain for Bob chat endpoints.
3. Keep preview and production endpoints isolated.
4. Keep Ollama private inside the Bob project network.

## GitHub Secrets Alignment

**DonSquires/Bob** (Bob deploy workflow):

| Secret | Purpose |
|---|---|
| `RAILWAY_TOKEN` | Railway token for Bob's service |
| `RAILWAY_SERVICE_ID` | Bob's Railway service ID |
| `BOB_URL` | Bob's public Railway URL (for health check) |

**DonSquires/FreedomCamp-Manager** (sync + core deploy workflows):

| Secret | Purpose |
|---|---|
| `BOB_SYNC_PAT` | GitHub PAT to push changes to DonSquires/Bob |
| `RAILWAY_BOB_TOKEN` | Railway project token for the Bob project (shared by Bob + Ollama services) |
| `RAILWAY_BOB_SERVICE_ID` | Railway service ID for Bob inference |
| `RAILWAY_BOB_PROJECT_ID` | Optional Railway project ID for Bob auto-resolution |
| `BOB_SERVICE_URL` | Optional Bob public URL for post-deploy health check |
| `RAILWAY_OLLAMA_SERVICE_ID` | Railway service ID for the Ollama service |
| `OLLAMA_SERVICE_URL` | Optional public Ollama URL for post-deploy health check |
| `RAILWAY_INFERENCE_SERVICE_ID` | Legacy: kept for backward compatibility during transition |
| `RAILWAY_PROXY_SERVICE_ID` | Railway service ID for the proxy service |
| `RAILWAY_TOKEN` | Railway token with access to proxy and other core services |

> Bob's own `RAILWAY_TOKEN` and `RAILWAY_SERVICE_ID` live in DonSquires/Bob, not in FreedomCamp-Manager.
> Ollama shares the Bob project token (`RAILWAY_BOB_TOKEN`) but has its own service ID (`RAILWAY_OLLAMA_SERVICE_ID`).

## CI/CD Workflows

| Workflow | Trigger | Service |
|---|---|---|
| `deploy-bob-railway.yml` | Push to `main` (inference-service/) or manual | Bob inference |
| `deploy-ollama-railway.yml` | Manual only | Ollama LLM server |
| `sync-bob-repo.yml` | Push to `main` (inference-service/) | Syncs to DonSquires/Bob |

### Deploying Ollama via CI

1. Go to **Actions → Deploy Ollama to Railway → Run workflow**
2. Optionally enter a model name (e.g. `llama3.1:8b`) to pull after deploy
3. The workflow deploys `ollama/Dockerfile` to the Ollama Railway service
4. If `OLLAMA_SERVICE_URL` is set, it verifies health via `/api/tags`

## Troubleshooting

### Bob returns HTTP 502
1. Check **Bob Inference → Deploy tab → logs**. Look for startup errors.
2. Common causes:
   - Missing or invalid `SUPABASE_SERVICE_ROLE_KEY` (if required by code)
   - Ollama not reachable at `OLLAMA_BASE_URL` yet
   - Port binding issue (verify port 3000 is exposed)
3. Solution: Tail the logs, fix variables, redeploy.

### Bob starts but `/health` returns `INFERENCE_API_KEY_SET: false`
- This is **expected** if `INFERENCE_API_KEY` is not set. It is optional.
- If Edge Functions call `/chat`, they need either `INFERENCE_API_KEY` header or a valid Supabase JWT.
- Either set `INFERENCE_API_KEY` (recommended for service-to-service) or ensure `SUPABASE_SERVICE_ROLE_KEY` is set for service auth.

### Bob `/chat` returns 404
- Likely Bob container didn't start—check logs.
- If deployment succeeded but `/chat` still 404, the server may be using an old image.
- Try `docker layers` or check `git log` on Bob repo to confirm the right commit was deployed.

### Ollama not responding
1. Verify Ollama service is running: **Railway → Ollama → Deploy tab** should show status **Running**.
2. Model may not be pulled yet. SSH into Ollama container and run: `ollama pull llama3.1:8b`
3. Confirm Bob can reach Ollama: In Bob logs, look for messages about Ollama connection state.
4. Confirm `OLLAMA_BASE_URL` uses port **11434**. Railway Ollama listens on 11434 via `OLLAMA_HOST`.

### Bob calls Ollama but gets timeout
1. Ollama may be overloaded or model is still loading.
2. Increase **Ollama service → Resources** (CPU/memory) if available on plan.
3. Check Ollama logs for OOM or compute issues.
4. As fallback, Bob will use heuristic providers if `SELF_CONTAINED_MODE=true` and Ollama fails.

### Updating Ollama version
1. Edit `ollama/Dockerfile` — change the image tag (e.g. `ollama/ollama:0.20.2` → `0.21.0`)
2. Merge to `main`
3. Run **Actions → Deploy Ollama to Railway → Run workflow**
4. Verify health: `curl https://<ollama-url>/api/tags`
