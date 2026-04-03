# Bob Production Railway Setup

This guide provisions Bob as a dedicated inference service in its own Railway project for production isolation.

Recommended target state: Bob plus Ollama in the same Bob-only Railway project.

## Recommended Project Layout

Use a separate Railway project for Bob so it does not compete with proxy, PTT, or other operational services.

1. Railway project: bob-production
2. Service: bob-inference (or orc-ai-inference-service)
3. Companion service: ollama
4. Source repository: DonSquires/FreedomCamp-Manager
5. Root directory for Bob: /inference-service

The existing inference-service Docker build already exports and bundles ONNX models during image build. No separate model image is required.

This layout gives Bob his own compute boundary while still allowing a private internal LLM service for richer responses.

## Create Bob Service

1. In Railway, create a new project for Bob, for example bob-production.
2. Inside that project, create a new service from GitHub repository.
3. Select repository: DonSquires/FreedomCamp-Manager.
4. Set service name: bob-inference (or orc-ai-inference-service).
5. Set branch: main.
6. Set root directory: /inference-service.
7. Use Dockerfile build.
8. Set healthcheck path: /health.
9. Set healthcheck timeout: 60.
10. Expose HTTP domain on port 3000.

## Create Ollama Service

Add Ollama as a second service in the same bob-production project.

1. Create a new service named ollama.
2. Use an Ollama-compatible Docker image or Railway template.
3. Keep Ollama on private networking only.
4. Do not expose Ollama publicly unless you explicitly need that.
5. Size Ollama separately from Bob so model memory usage does not starve Bob's HTTP runtime.

Recommended internal URL:

```env
OLLAMA_BASE_URL=http://ollama.railway.internal:11434
```

Use the actual private Railway hostname if it differs.

## Docker and ONNX Build Notes

The Bob image build already performs ONNX export and bundles the model artifacts.

1. Python stage exports ONNX models via scripts/export-models.py.
2. Node builder stage installs production dependencies and pretrains self-learning state.
3. Final image copies server.js, lib, data, and generated /models into the runtime container.

This means a fresh Bob Railway project can deploy directly from /inference-service without any manual model upload step.

## Environment Variables

Use this exact baseline block for Bob with Ollama.

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

# --- Bob chat/nlp defaults (Bob + Ollama) ---
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

# --- Local Ollama (same Bob project, private networking only) ---
OLLAMA_BASE_URL=http://ollama.railway.internal:11434
OLLAMA_MODEL=llama3.1:8b
```

If you want the lowest-risk first deploy, use this reduced mode instead:

```env
CHAT_PROVIDER=heuristic
TABULAR_NLP_PROVIDER=heuristic
```

## Why Add Ollama

Ollama gives Bob a local/private LLM for:

1. Better conversational responses
2. Better summarization and explanation quality
3. More assistant-like answers for open-ended operational questions

Ollama is not required for Bob to run, but it is the right add-on if you want Bob to feel like a real assistant rather than a heuristic responder.

## Resource Guidance

Keep Bob and Ollama as separate services in the same Bob project.

1. Bob handles HTTP API, auth, ONNX inference, and orchestration.
2. Ollama handles LLM inference.
3. Scale them independently.
4. Do not co-locate Ollama inside the Bob process.

## Verify Deployment

After deploy:

1. GET /health on Bob domain must return healthy JSON.
2. POST /chat on Bob domain must return non-404.
3. Ensure Supabase INFERENCE_SERVICE_URL points to Bob domain.
4. Ensure Bob is not sharing CPU/memory with proxy-server or ptt-server.
5. If using Ollama, confirm Bob can reach the internal Ollama URL.

Example checks:

```bash
curl -sS https://YOUR_BOB_DOMAIN/health

curl -sS -X POST https://YOUR_BOB_DOMAIN/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"ping"}'
```

Expected result with Ollama enabled:

1. `/chat` returns non-404 and uses the configured LLM path after auth succeeds.
2. Bob logs show `CHAT_PROVIDER=ollama` and a private `OLLAMA_BASE_URL`.

## Service Separation Rules

1. Bob inference URL and proxy URL must be different services.
2. Do not use proxy domain for Bob chat endpoints.
3. Keep preview and production endpoints isolated.
4. Keep Ollama private inside the Bob project.
5. Do not point Bob to a public Ollama URL in self-contained mode.

## GitHub Secrets Alignment

For deploy workflows:

1. RAILWAY_INFERENCE_SERVICE_ID must be the Railway service ID (not public domain).
2. RAILWAY_PROXY_SERVICE_ID must be the proxy Railway service ID.
3. RAILWAY_TOKEN must have access to the target production project.
4. Avoid legacy RAILWAY_SERVICE_ID when dedicated IDs are available.

## Dedicated Bob Deploy Workflow

The repository includes a dedicated workflow for a separate Bob Railway project:

1. .github/workflows/deploy-bob-railway.yml

Configure these GitHub Actions secrets for that workflow:

1. RAILWAY_BOB_TOKEN
2. RAILWAY_BOB_SERVICE_ID
3. BOB_SERVICE_URL
