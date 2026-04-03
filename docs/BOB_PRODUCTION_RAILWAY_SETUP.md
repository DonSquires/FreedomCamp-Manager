# Bob Production Railway Setup

Bob is an independent AI inference service with his own repository: **DonSquires/Bob**.

Code lives in `inference-service/` inside FreedomCamp-Manager and is automatically
mirrored to DonSquires/Bob whenever `inference-service/` changes on `main`.
Railway deploys from DonSquires/Bob.

## Repository Setup (one-time)

### 1. Enable sync from FreedomCamp-Manager → Bob repo

Add a secret to **DonSquires/FreedomCamp-Manager** → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `BOB_SYNC_PAT` | GitHub PAT (classic or fine-grained) with **Contents: Read & Write** on `DonSquires/Bob` |

Once set, any push to `main` that touches `inference-service/` automatically syncs
to the Bob repo via `.github/workflows/sync-bob-repo.yml`.

To trigger a one-off sync without a code change, run the workflow manually:
`Actions → Sync Bob Repo → Run workflow`.

### 2. Add secrets to the Bob repo

Add these secrets to **DonSquires/Bob** → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `RAILWAY_TOKEN` | Railway project token with deploy access to Bob's service |
| `RAILWAY_SERVICE_ID` | Railway project → Bob service → Settings → Service ID |
| `BOB_URL` | Bob's Railway domain (e.g. `https://bob-production.up.railway.app`). Optional; enables post-deploy health check. |

## Create Railway Service

1. In Railway production, create a new service from GitHub repository.
2. Select repository: **DonSquires/Bob**.
3. Set service name: `bob` (or `bob-inference-service`).
4. Set branch: `main`.
5. Leave root directory empty (Bob's repo root is the service root).
6. Use Dockerfile build.
7. Set healthcheck path: `/health`.
8. Set healthcheck timeout: 60.
9. Expose HTTP domain on port 3000.

## Environment Variables

Use this exact baseline block.

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

# --- Self-contained posture (recommended for Bob production) ---
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true

# --- Bob chat/nlp defaults (safe baseline) ---
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

# --- Optional local Ollama mode (enable only if local/internal Ollama exists) ---
# CHAT_PROVIDER=ollama
# TABULAR_NLP_PROVIDER=ollama
# OLLAMA_BASE_URL=http://ollama.railway.internal:11434
# OLLAMA_MODEL=llama3.1:8b
```

## Verify Deployment

After deploy:

1. GET /health on Bob domain must return healthy JSON.
2. POST /chat on Bob domain must return non-404.
3. Ensure Supabase INFERENCE_SERVICE_URL points to Bob domain.

Example checks:

```bash
curl -sS https://YOUR_BOB_DOMAIN/health

curl -sS -X POST https://YOUR_BOB_DOMAIN/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"ping"}'
```

## Service Separation Rules

1. Bob inference URL and proxy URL must be different services.
2. Do not use proxy domain for Bob chat endpoints.
3. Keep preview and production endpoints isolated.

## GitHub Secrets Alignment

**DonSquires/Bob** (Bob's own deploy workflow):

| Secret | Purpose |
|---|---|
| `RAILWAY_TOKEN` | Railway token for Bob's service |
| `RAILWAY_SERVICE_ID` | Bob's Railway service ID |
| `BOB_URL` | Bob's public Railway URL (for health check) |

**DonSquires/FreedomCamp-Manager** (sync + proxy/other workflows):

| Secret | Purpose |
|---|---|
| `BOB_SYNC_PAT` | GitHub PAT to push changes to DonSquires/Bob |
| `RAILWAY_INFERENCE_SERVICE_ID` | Legacy: kept for backward compat during transition |
| `RAILWAY_PROXY_SERVICE_ID` | Railway service ID for the proxy service |
| `RAILWAY_TOKEN` | Railway token with access to proxy/other services |

> Bob's own RAILWAY_TOKEN and RAILWAY_SERVICE_ID live in DonSquires/Bob, not here.
