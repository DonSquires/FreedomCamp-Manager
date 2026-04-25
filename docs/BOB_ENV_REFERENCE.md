# Bob Inference and Ollama Environment Reference

This document is the canonical environment map for Bob, RunPod, Ollama, UI, and Supabase Edge Functions.

## Canonical Endpoint Rules

- RunPod serverless base URL format: `https://api.runpod.ai/v2/<endpoint-id>`
- RunPod sync route used by this repo: `/runsync`
- Invalid route for this endpoint style: `/run-sync`

## UI (Vite) Variables

These are consumed by browser code and test helpers.

- `VITE_INFERENCE_SERVICE_URL`
- `VITE_INFERENCE_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Edge Function Inference Variables

Use these in Supabase Edge Function secrets.

- Primary:
  - `INFERENCE_SERVICE_URL`
  - `INFERENCE_API_KEY`
- Supported aliases (for compatibility):
  - `RUNPOD_ENDPOINT_API_KEY`
  - `RUNPOD_API_KEY`
  - `BOB_SERVICE_URL`
  - `BOB_INFERENCE_API_KEY`

## Runtime Retry Controls

Used by `onspace-ai-chat` for resilient inference calls.

- RunPod `/runsync` path:
  - `BOB_RUNPOD_RETRIES` (default `2`)
  - `BOB_RUNPOD_BACKOFF_MS` (default `700`)
  - `BOB_RUNPOD_MAX_BACKOFF_MS` (default `5000`)
  - `BOB_RUNPOD_TIMEOUT_MS` (default `90000`)
- Standard inference `/chat` path:
  - `BOB_INFERENCE_CHAT_RETRIES` (default `2`)
  - `BOB_INFERENCE_CHAT_BACKOFF_MS` (default `500`)
  - `BOB_INFERENCE_CHAT_MAX_BACKOFF_MS` (default `4000`)
  - `BOB_INFERENCE_CHAT_TIMEOUT_MS` (default `60000`)
- Ollama `/api/chat` fallback path:
  - `BOB_OLLAMA_CHAT_RETRIES` (default `2`)
  - `BOB_OLLAMA_CHAT_BACKOFF_MS` (default `500`)
  - `BOB_OLLAMA_CHAT_MAX_BACKOFF_MS` (default `4000`)
  - `BOB_OLLAMA_CHAT_TIMEOUT_MS` (default `60000`)

## Supervisor Automation Controls

Used by `scripts/runpod-bob-supervisor.mjs`.

- `BOB_SUPERVISOR_INTERVAL_MS` (default `60000`)
- `BOB_SUPERVISOR_FAILURE_THRESHOLD` (default `3`)
- `BOB_SUPERVISOR_SMOKE_TIMEOUT_MS` (default `45000`)
- `BOB_SUPERVISOR_ACTION_COOLDOWN_MS` (default `300000`)
- `BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS` (default `1800000`)
- `BOB_SUPERVISOR_STATE_FILE` (default `.runtime/runpod-bob-supervisor-state.json`)
- `BOB_SUPERVISOR_ACTIVITY_FILE` (default `.runtime/runpod-bob-activity.touch`)
- `BOB_SUPERVISOR_PING_MESSAGE` (default `ping`)

Optional action hooks:

- `BOB_RUNPOD_RECOVER_CMD`
- `BOB_RUNPOD_SCALE_UP_CMD`
- `BOB_RUNPOD_SCALE_DOWN_CMD`
- `RUNPOD_POD_ID` for built-in pod start/stop fallback

## Supervisor Hook Server Controls

Used by `scripts/runpod-bob-hook-server.mjs`.

- `BOB_AUTOMATION_WEBHOOK_TOKEN` (required)
- `BOB_AUTOMATION_WEBHOOK_HOST` (default `127.0.0.1`; local-only by default)
- `BOB_AUTOMATION_WEBHOOK_PORT` (default `8787`)

## Ollama Variables

Used by `onspace-ai-chat` and `inference-service`.

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_API_KEY`
- `OLLAMA_GATEWAY_KEY`

## RunPod Gateway Variables

Used by `runpod-gateway`.

- `BOB_GATEWAY_KEY`
- `BOB_GATEWAY_ADMIN_KEY` (optional)
- `OLLAMA_HOST`

## Recommended Minimal Working Set

For this repository to operate Bob via RunPod serverless and UI:

- `INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<endpoint-id>`
- `INFERENCE_API_KEY=rpa_...`
- `RUNPOD_ENDPOINT_API_KEY=rpa_...` (same as above)
- `RUNPOD_API_KEY=rpa_...` (same as above)
- `VITE_INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<endpoint-id>`
- `VITE_INFERENCE_API_KEY=rpa_...`

## Validation Checklist

1. RunPod smoke ping succeeds:

```bash
curl -sS "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}'
```

2. Expect HTTP `200` and JSON with:
- `status: "COMPLETED"`
- `output.success: true`
- `output.response` text

3. Build and lint:

```bash
bun run build
bun run lint
```

## Security Notes

- Do not commit real API keys to tracked files.
- Keep production secrets in Supabase Edge Function secrets and deployment secret stores.
- Rotate compromised keys immediately.
