# Bob Production Railway Setup

> DEPRECATED - REFERENCE ONLY
>
> Bob/Ollama primary inference has moved to RunPod Serverless.
> This file is retained for migration history only and should not be used as active deployment guidance.
>
> Canonical runtime authority is:
> - `docs/BOB_MASTER_RUNTIME_TRUTH.md`
> - `docs/RAILWAY_SERVICES_AUTHORITY.md`

Bob is an independent AI inference service with his own repository: **DonSquires/Bob**.

Code lives in `inference-service/` inside FreedomCamp-Manager and is automatically
mirrored to DonSquires/Bob whenever `inference-service/` changes on `main`.
Railway deploys from DonSquires/Bob.

Recommended architecture: Bob + Ollama in the same Bob Railway project, but as
separate services.

**⚠️ Authority Reference:** See [RAILWAY_SERVICES_AUTHORITY.md](RAILWAY_SERVICES_AUTHORITY.md) for:
- Authoritative list of all Railway services and their ownership
- Required secrets for each service (no ambiguous fallbacks)
- Validation rules and deployment standards
- Secret storage locations (GitHub Actions vs. Supabase Vault)

## Repository Setup (one-time)

## Container Bootstrap Sequence (Bob + Railway)

Use this deterministic sequence inside the dev container to ensure Bob works with
the active Railway credentials.

1. Load credentials into environment (for example `.runtime/railway-secrets.env`
  and `.runtime/bob-local-credentials.env`).
2. Run the bootstrap script:

```bash
bash scripts/bob-container-bootstrap.sh --load-runtime --chat "status check"
```

What this script does:
- Normalizes alias names to canonical env vars (`load-railway-secrets-from-github-env.sh`).
- Validates Railway tokens, service IDs, and service health URLs.
- Verifies Bob `/health` and authenticated `/chat` from inside this container.
- Probes Railway GraphQL API token validity (when tokens are present).

If the bootstrap fails, fix the missing/invalid variable and rerun the same command.
This avoids ad-hoc ordering drift during incident response.

### 1. Enable sync from FreedomCamp-Manager -> Bob repo

Add a secret to **DonSquires/FreedomCamp-Manager** -> Settings -> Secrets -> Actions:

| Secret | Value |
|---|---|
| `BOB_SYNC_PAT` | GitHub PAT (classic or fine-grained) with **Contents: Read & Write** on `DonSquires/Bob` |

Once set, any push to `main` that touches `inference-service/` automatically syncs
to the Bob repo via `.github/workflows/sync-bob-repo.yml`.

To trigger a one-off sync without a code change, run the workflow manually:
`Actions -> Sync Bob Repo -> Run workflow`.

### 2. Add secrets to FreedomCamp-Manager for Bob + Ollama deploys

Add these secrets to **DonSquires/FreedomCamp-Manager** -> Settings -> Secrets -> Actions:

| Secret | Value |
|---|---|
| `RAILWAY_BOB_TOKEN` | Railway project token for the Bob project (from Railway → Bob project → Settings → Tokens) |
| `RAILWAY_BOB_SERVICE_ID` | Railway project → Bob service → Settings → Service ID |
| `RAILWAY_BOB_PROJECT_ID` | Railway project ID for Bob (optional; for auto-resolution if SERVICE_ID not set) |
| `RAILWAY_OLLAMA_SERVICE_ID` | Railway project → Ollama service → Settings → Service ID |
| `BOB_SERVICE_URL` | Bob's Railway domain (e.g. `https://bob-production.up.railway.app`). Optional; enables post-deploy health check. |
| `OLLAMA_SERVICE_URL` | Ollama service Railway domain. Optional. |

### 3. Add secrets to DonSquires/Bob for Bob's own deploy workflow

Bob's own canonical deploy repo (`DonSquires/Bob`) should have:

| Secret | Value |
|---|---|
| `RAILWAY_TOKEN` | Railway project token for Bob's Railway project (same as RAILWAY_BOB_TOKEN above) |
| `RAILWAY_SERVICE_ID` | Bob service ID (same as RAILWAY_BOB_SERVICE_ID above) |
| `BOB_URL` | Bob's Railway domain. Optional; enables post-deploy health check. |

## Current Status

| Component | Status | Domain / Notes |
|---|---|---|
| Bob Inference | ✅ Deployed | `https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync` |
| Ollama | ✅ Deployed | `ollama-production-3ab0.up.railway.app` (us-west2, CPU, 22 GiB RAM, Ollama v0.20.2) |

## Ollama Service Details

- **Image**: `ollama/ollama` (v0.20.2)
- **Region**: us-west2
- **Replicas**: 1
- **Compute**: CPU-only (22.4 GiB RAM available)
- **Internal port**: 11434 (configured via `OLLAMA_HOST=http://0.0.0.0:11434`)
- **Internal URL**: `http://127.0.0.1:11434` (Ollama is co-located with Bob on the same RunPod pod)
- **Keep-alive**: 24 hours (`OLLAMA_KEEP_ALIVE=24h0m0s`)
- **Default context**: 4096 tokens

> **Note**: Ollama runs co-located with Bob on the RunPod pod.
> Bob must use `http://127.0.0.1:11434` (or `http://ollama:11434` in multi-container dev) as `OLLAMA_BASE_URL`.

## Setup Steps

### 1. Pull the LLM Model in Ollama

Shell into the Ollama service and pull the required models:
```bash
ollama pull qwen2.5:7b
ollama pull llama3.2-vision:11b
```

### 2. Configure Bob Inference Environment Variables

In **Bob Inference (RunPod) → Template → Environment Variables**, add exactly these variables:

```
INFERENCE_API_KEY=<strong random secret>
CHAT_PROVIDER=ollama
TABULAR_NLP_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
```

In the Ollama service, also set:

```
OLLAMA_NO_CLOUD=true
OLLAMA_PREPULL_MODE=blocking
OLLAMA_EXTRA_MODELS=llama3.2-vision:11b
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
BOB_URL="https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync"

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

# --- Internal Ollama URL (Ollama is co-located on the RunPod pod) ---
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
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
# OLLAMA_MODEL=qwen2.5:7b
```

## Verify Deployment

After deploy:

1. GET /health on Bob domain must return healthy JSON.
2. POST /chat on Bob domain must return non-404.
3. Ensure Supabase `INFERENCE_SERVICE_URL` points to Bob domain.
4. If using Profile A, confirm Bob can reach the internal Ollama URL.

Example checks:

```bash
curl -sS https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync/health

curl -sS -X POST https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync/chat \
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
| `build-ai-worker.yml` | Push to `main` (inference-service/) or manual | Bob inference |
| `build-ai-worker.yml` | Manual only | Ollama LLM server |
| `sync-bob-repo.yml` | Push to `main` (inference-service/) | Syncs to DonSquires/Bob |

### Deploying Ollama via CI

1. Go to **Actions → Deploy Ollama to Railway → Run workflow**
2. Optionally enter a model name (e.g. `qwen2.5:7b`) to pull after deploy
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
2. Model may not be pulled yet. SSH into Ollama container and run: `ollama pull qwen2.5:7b`
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

---

## Validating Secrets Without Admin Access

If you need to check which secrets are configured and valid **without requiring GitHub Actions admin permissions**, use the credential validation workaround:

```bash
# Load secrets from your local environment or .env file
source .env.local

# Run the validator
./scripts/validate-railway-credentials.sh
```

The script will:
- Test Railway tokens via the `railway` CLI (if available)
- Check service IDs exist in token scope
- Test service connectivity via HTTP health checks
- Report which secrets are valid, invalid, or missing
- Mask sensitive values in output (safe to share logs)

**Requirements:**
- `railway` CLI installed (or skip token validation)
- `curl` and `jq` available

---

## References

- **[RAILWAY_SERVICES_AUTHORITY.md](RAILWAY_SERVICES_AUTHORITY.md)** — Authoritative list of all Railway services, required secrets, and deployment standards (all services, not just Bob)
- **[RAILWAY_DEPLOYMENT_GUIDE.md](RAILWAY_DEPLOYMENT_GUIDE.md)** — General Railway deployment guide
- **[ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)** — Comprehensive environment variable reference
- **scripts/validate-railway-credentials.sh** — Workaround for validating secrets without admin access
- **DonSquires/Bob** — Bob's canonical deploy repository
