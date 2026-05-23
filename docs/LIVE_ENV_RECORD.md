# Live Env Record

Snapshot source: workspace `.env` and current service templates in the repo.

## RunPod endpoint live state (verified via REST API)

Endpoint: `fieldops-ai-engine` (`n0bp1ifmq01cx2`)

- `workersMin`: `0`
- `workersMax`: `10`
- `workersStandby`: `10`
- `gpuCount`: `1`
- `idleTimeout`: `10`
- `flashboot`: `true`
- `scalerType`: `QUEUE_DELAY`
- `scalerValue`: `4`

Current endpoint env block still reports:

- `OLLAMA_HOST=https://ollama-production-3ab0.up.railway.app`
- `OLLAMA_RETRY_ATTEMPTS=5`
- `OLLAMA_RETRY_BACKOFF_MS=800`

Railway API verification: `ollama-production-3ab0.up.railway.app` was discovered in project `fieldops-ollama` (environment `production`, service `ollama`) using the configured `RAILWAY_TOKEN`.

Important API constraint discovered live: RunPod `PATCH /v1/endpoints/{endpointId}` rejects `env` and `workersStandby` keys with schema validation errors. Re-applying `templateId` triggers a rolling release/version bump, but does not overwrite the endpoint env block.

Operator notes from this session:

- MotorWeb is not yet onboarded with live credentials (`MOTORWEB_API_KEY`/`MOTORWEB_ID_KEY` pending).
- Business email is managed through hPanel/Hostinger mailboxes; `POSTAL_API_URL` should stay blank unless a Postal API server is deployed.

## Authoritative connectivity audit (2026-05-23)

Probe method:

- Core services: `GET /health` (or canonical health endpoint)
- Supabase Edge Functions: `OPTIONS /functions/v1/<function-name>` (non-mutating reachability test)

Observed results:

- Core endpoints tested: `7`
- Core endpoints healthy (`2xx`): `7`
- Edge function routes tested: `101`
- Edge function routes with non-`404` responses: `101`
- Edge function failures (`000`/network): `0`

Current actionable non-2xx finding: none.

Translator serverless-mode checks:

- `translate-message` edge route reachable (`OPTIONS 200`).
- `translate-text` edge route reachable (`OPTIONS 200`).
- `translate-transcript-segments` edge route reachable (`OPTIONS 200`).
- Dedicated translator pod URLs are deprecated in this deployment mode.

## Live non-secret endpoints

| Service | Variable | Current value |
|---|---|---|
| Supabase | `VITE_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| RunPod / Bob inference | `INFERENCE_SERVICE_URL` | `https://api.runpod.ai/v2/n0bp1ifmq01cx2` |
| RunPod / Bob inference | `VITE_INFERENCE_SERVICE_URL` | `https://api.runpod.ai/v2/n0bp1ifmq01cx2` |
| PTT HTTPS endpoint | `PTT_SERVER_URL` | `https://ptt.fcmanager.co.nz` |
| PTT websocket endpoint | `PTT_WS_URL` | `wss://fieldops-railway-stt-production.up.railway.app/ws` |
| Mobile PTT websocket alias | `EXPO_PUBLIC_PTT_SERVER_URL` | `wss://fieldops-railway-stt-production.up.railway.app/ws` |
| Bob translator websocket | `VITE_BOB_TRANSLATOR_WS_URL` | *(blank in serverless-only mode)* |
| Bob translator REST | `BOB_TRANSLATOR_REST_URL` | *(legacy pod-only; not used in serverless mode)* |
| Bob translator pod | `BOB_TRANSLATOR_POD_ID` | *(legacy pod-only; not used in serverless mode)* |
| Whisper proxy | `VITE_WHISPER_PROXY_URL` | `https://fieldops-railway-stt-production.up.railway.app` |
| Bob manager UI/API | `VITE_BOB_MANAGER_URL` | `https://fieldops-backend-production.up.railway.app` |

## Live secret-bearing variables present in workspace `.env`

These are present in the live workspace environment record but are intentionally not reproduced in full here:

- `VITE_SUPABASE_ANON_KEY`
- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_API_KEY`
- `INFERENCE_API_KEY`
- `VITE_INFERENCE_API_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

## Still required from external services

These values were not available through the repo/workspace tools and must be set in the live services or secret managers:

- `RAILWAY_TOKEN`
- `RAILWAY_PROXY_SERVICE_ID`
- `RAILWAY_INFERENCE_SERVICE_ID`
- `RAILWAY_PTT_SERVICE_ID`
- `BOB_GATEWAY_KEY`
