# Stack Access Map

Last updated: 2026-04-23

This document maps the active stack, what each part does, and the fastest access paths for:

- edit
- test
- view
- review

It is grounded in repository structure, active workflows, and a live Supabase schema snapshot.

## 1) Live schema baseline (not docs-only)

Live snapshot command used:

```bash
supabase gen types typescript --project-id kxwjcupuxnnbnzcgmkoi > /tmp/live-schema.types.ts
```

Observed from live snapshot:

- `public` tables: 218
- `public` views: 14
- `public` functions: 346

Key domain tables confirmed live:

- `smoke_jobs`, `smoke_assessments`, `smoke_notices`
- `biosecurity_jobs`, `biosecurity_assessments`, `biosecurity_notices`
- `noise_jobs`, `noise_assessments`, `noise_notices`, `noise_seizures`
- `ptt_channels`, `ptt_messages`, `ptt_presence`, `ptt_transmission_log`
- `incidents`, `observations`, `organizations`, `user_profiles`

## 2) Stack and purpose map

### Frontend SPA

- Path: [src](src)
- Purpose: operator/admin UX, officer portals, Bob Studio, workflows and dashboards.
- Build/runtime: Vite + React + TypeScript.

### Supabase backend

- Paths: [supabase/functions](supabase/functions), [supabase/migrations](supabase/migrations)
- Purpose: edge APIs, auth/RLS data access, DB migrations.
- Project ref: `kxwjcupuxnnbnzcgmkoi`.

### Bob inference runtime (RunPod)

- Worker path: [runpod-worker](runpod-worker)
- Gateway path: [runpod-gateway](runpod-gateway)
- Purpose: Bob chat/review actions, Ollama model execution, endpoint inference.

### Inference service logic

- Path: [inference-service](inference-service)
- Purpose: central AI endpoints and orchestration, including speech path `/infer/speak`.

### Proxy service

- Path: [proxy-server](proxy-server)
- Purpose: controlled external API integrations (NZSCV and related lookups).

### Voice/PTT service

- Path: [ptt-server](ptt-server)
- Purpose: signaling + voice transport and half-duplex PTT operations.

### Mobile app

- Path: [mobile-app](mobile-app)
- Purpose: Expo client and mobile workflows.

## 3) Entry points by task type

### A) Edit paths

Frontend edits:

- Feature pages: [src/pages](src/pages)
- Reusable feature components: [src/components/features](src/components/features)
- UI primitives: [src/components/ui](src/components/ui)
- Shared API wrappers: [src/lib/edgeFunctions.ts](src/lib/edgeFunctions.ts)
- Client state: [src/stores](src/stores)

Backend edits:

- Edge functions: [supabase/functions](supabase/functions)
- SQL schema changes: [supabase/migrations](supabase/migrations)

AI/runtime edits:

- Bob RunPod worker: [runpod-worker/handler.py](runpod-worker/handler.py), [runpod-worker/handler.js](runpod-worker/handler.js)
- Inference API server: [inference-service/server.js](inference-service/server.js)
- RunPod gateway: [runpod-gateway](runpod-gateway)

### B) Test paths

Local frontend quality gates:

```bash
bun run build
bun run lint
```

Targeted test runners:

- Test wrapper with Bob assist: [scripts/run-test-with-bob-assist.mjs](scripts/run-test-with-bob-assist.mjs)
- Playwright suite: [tests](tests), workflow [.github/workflows/playwright-deep-functional-cross-browser.yml](.github/workflows/playwright-deep-functional-cross-browser.yml)

RunPod endpoint smoke:

- Script: [scripts/invoke-runpod-endpoint.mjs](scripts/invoke-runpod-endpoint.mjs)
- Workflow: [.github/workflows/ops-runpod-serverless-smoke.yml](.github/workflows/ops-runpod-serverless-smoke.yml)

Supabase function deploy + health confidence:

- Workflow: [.github/workflows/deploy-edge-functions.yml](.github/workflows/deploy-edge-functions.yml)

### C) View / inspect paths

Runtime docs and topology:

- System overview: [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md)
- Secrets source of truth: [docs/SECRETS_REGISTRY.md](docs/SECRETS_REGISTRY.md)
- Setup checklist: [docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)
- Deployment procedures: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)

Codespaces startup behavior:

- Guard script: [.devcontainer/postStart.sh](.devcontainer/postStart.sh)

Live schema inspection commands:

```bash
supabase projects list --output pretty
supabase gen types typescript --project-id kxwjcupuxnnbnzcgmkoi > /tmp/live-schema.types.ts
```

### D) Review / release paths

Primary release workflows:

- AI worker publish (RunPod): [.github/workflows/build-ai-worker.yml](.github/workflows/build-ai-worker.yml)
- Edge function deploy: [.github/workflows/deploy-edge-functions.yml](.github/workflows/deploy-edge-functions.yml)
- Frontend deploy: [.github/workflows/deploy-frontend.yml](.github/workflows/deploy-frontend.yml)
- Proxy deploy: [.github/workflows/deploy-proxy-railway.yml](.github/workflows/deploy-proxy-railway.yml)
- Voice/PTT deploy: [.github/workflows/deploy-voice-server.yml](.github/workflows/deploy-voice-server.yml)

Operational review workflows:

- RunPod smoke: [.github/workflows/ops-runpod-serverless-smoke.yml](.github/workflows/ops-runpod-serverless-smoke.yml)
- Synthetic monitor: [.github/workflows/synthetic-monitor.yml](.github/workflows/synthetic-monitor.yml)
- Wiring audit: [.github/workflows/ops-railway-wiring-audit.yml](.github/workflows/ops-railway-wiring-audit.yml)

## 4) Access control matrix (practical)

### GitHub Actions

- Needed for deploy/review workflows and release operations.
- If workflow dispatch returns `403 Resource not accessible by integration`, local token lacks `actions:write` scope.

### Supabase CLI

- Used for live schema generation and edge deploys.
- Working commands in this environment:
  - `supabase projects list --output pretty`
  - `supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi`

### RunPod API

- Used for endpoint smoke and job status checks.
- Scripted via [scripts/invoke-runpod-endpoint.mjs](scripts/invoke-runpod-endpoint.mjs).

## 5) Fast operator flows

### Edit + ship edge function

1. Edit under [supabase/functions](supabase/functions)
2. Deploy:

```bash
supabase functions deploy <function-name> --project-ref kxwjcupuxnnbnzcgmkoi
```

### Edit + ship Bob worker (RunPod)

1. Edit under [runpod-worker](runpod-worker)
2. Trigger [.github/workflows/build-ai-worker.yml](.github/workflows/build-ai-worker.yml)
3. Validate endpoint with [scripts/invoke-runpod-endpoint.mjs](scripts/invoke-runpod-endpoint.mjs)

### Validate voice conversation path

1. UI source: [src/pages/BobAssistantStudio.tsx](src/pages/BobAssistantStudio.tsx)
2. Edge proxy: [supabase/functions/synthesize-speech/index.ts](supabase/functions/synthesize-speech/index.ts)
3. Runtime synth endpoint: [inference-service/server.js](inference-service/server.js)
4. RunPod endpoint smoke with `action: ping` and `action: chat`

## 6) Known environment caveats

- Codespaces can show multiple `devcontainer up` entries in startup logs; this is expected lifecycle behavior.
- `.devcontainer/postStart.sh` is intentionally idempotent to avoid duplicate dev server startup.
- Do not assume workflow dispatch permissions from Codespaces token; validate per run.

## 7) Secrets by control plane

This is the practical secret-placement split for this stack.

### GitHub Actions secrets

Use for CI/CD workflows, deployment automation, and workflow-triggered health checks.

Examples:

- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_ID`
- `RUNPOD_TEMPLATE_ID`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INFERENCE_API_KEY`
- `BOB_SERVICE_URL`
- `PROXY_SERVER_URL`
- `PTT_SERVER_URL`
- `RAILWAY_TOKEN`
- `RAILWAY_PROXY_SERVICE_ID`

Primary reference: [docs/SECRETS_REGISTRY.md](docs/SECRETS_REGISTRY.md)

### Supabase Edge Function secrets

Use for runtime values consumed by edge functions via `Deno.env.get(...)`.

Examples:

- `INFERENCE_SERVICE_URL`
- `INFERENCE_API_KEY`
- `PROXY_SERVER_URL`
- `PTT_SERVER_URL`
- `PTT_PROXY_SECRET`

Operational rule:

- after changing these, redeploy affected edge functions.

### RunPod runtime secrets and env

Use for Bob/Ollama runtime behavior and endpoint-level execution.

Examples:

- `INFERENCE_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_VISION_MODEL`
- `CHAT_PROVIDER`
- `TABULAR_NLP_PROVIDER`
- `BOB_ATTITUDE_PROFILE`
- `BOB_ATTITUDE_INSTRUCTIONS`

Primary runtime surfaces:

- [runpod-worker](runpod-worker)
- [runpod-gateway](runpod-gateway)
- [inference-service](inference-service)

### Railway proxy secrets

Railway is proxy-only in this stack.

Examples:

- `PROXY_SECRET`
- `NZSCV_API_KEY`
- `NZSCV_ID_KEY`
- `NZSCV_ENDPOINT_URL`

Primary runtime surface:

- [proxy-server](proxy-server)

### hPanel VPS secrets

Use for PTT/voice server runtime and related service auth.

Examples:

- `PROXY_SECRET`
- `PTT_PROXY_SECRET`
- `PTT_JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Primary runtime surface:

- [ptt-server](ptt-server)

### Fast secret-placement rule

1. GitHub Actions secrets: deploy and automation only.
2. Supabase secrets: edge runtime only.
3. RunPod env: Bob/Ollama runtime only.
4. Railway env: proxy runtime only.
5. hPanel VPS env: PTT/voice runtime only.

## 8) Verify access from Codespaces

Use these commands to confirm what this Codespaces session can actually access.

### GitHub Actions control plane

```bash
gh auth status
gh workflow list
gh run list --limit 10
```

Use this to confirm:

- authenticated GitHub identity
- workflow visibility
- whether workflow dispatch/read is available

If dispatch fails with `403 Resource not accessible by integration`, the token can read but not trigger workflows.

### Supabase control plane

```bash
supabase projects list --output pretty
supabase gen types typescript --project-id kxwjcupuxnnbnzcgmkoi > /tmp/live-schema.types.ts
supabase functions deploy <function-name> --project-ref kxwjcupuxnnbnzcgmkoi
```

Use this to confirm:

- project access
- live schema access
- edge deployment permission

### RunPod control plane

```bash
env | rg '^RUNPOD_'
RUNPOD_ENDPOINT_URL="$RUNPOD_API_URL" RUNPOD_ENDPOINT_API_KEY="$RUNPOD_API_KEY" \
node /workspaces/FreedomCamp-Manager/scripts/invoke-runpod-endpoint.mjs \
  --input '{"action":"ping"}' --poll true --timeoutMs 120000 --intervalMs 3000
```

Use this to confirm:

- endpoint URL/key present in environment
- live endpoint reachability
- current deployed worker response shape and model

### Railway proxy control plane

```bash
railway whoami
```

If the repo is not linked locally, `railway status` may fail even while the account is authenticated.

Use this to confirm:

- Railway CLI auth exists
- local project linkage exists or is absent

### hPanel / VPS control plane

This repo documents the VPS runtime path, but live access from Codespaces depends on SSH material being available in this session.

Typical verification commands when keys are loaded:

```bash
ssh -T root@72.61.123.97
ssh root@72.61.123.97 'hostname && systemctl status ptt-server --no-pager | cat'
```

Use this to confirm:

- SSH reachability
- server identity
- PTT runtime/service status

If SSH keys are not present in Codespaces, VPS access cannot be verified from this container without additional credentials.
