# Bob RunPod Playbook

Canonical setup and day-to-day operations guide for Bob's RunPod Serverless endpoint from GitHub Codespaces.

## What Bob is managing

- RunPod Serverless endpoint: `n0bp1ifmq01cx2`
- Endpoint name: `fieldops-ai-engine`
- Base URL: `https://api.runpod.ai/v2/n0bp1ifmq01cx2`
- Auth: RunPod API key starting with `rpa_`

Important repo rule:

- Store `INFERENCE_SERVICE_URL` as the base URL only: `https://api.runpod.ai/v2/n0bp1ifmq01cx2`
- This repository's Bob paths append `/runsync` in code and validation commands.
- Do not persist `/run-sync` in env for this repo.

## Codespace setup

### Recommended Codespaces secrets

GitHub repository -> Settings -> Secrets and variables -> Codespaces

Add:

- `INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/n0bp1ifmq01cx2`
- `INFERENCE_API_KEY=rpa_...`
- Optional: `RUNPOD_ENDPOINT_ID=n0bp1ifmq01cx2`

Optional compatibility aliases if you need them for older tooling:

- `RUNPOD_ENDPOINT_API_KEY=rpa_...`
- `RUNPOD_API_KEY=rpa_...`

### Optional local runtime file

If you want a local shell file for Bob session startup, create `.runtime/bob.env` with:

```bash
export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/n0bp1ifmq01cx2"
export INFERENCE_API_KEY="rpa_..."
export RUNPOD_ENDPOINT_ID="n0bp1ifmq01cx2"
```

Then load it in the Codespace terminal:

```bash
cd /workspaces/FreedomCamp-Manager
source .runtime/bob.env
```

Sanity check without leaking the full key:

```bash
echo "URL=$INFERENCE_SERVICE_URL"
echo "KEY_PREFIX=${INFERENCE_API_KEY:0:4} (should be rpa_)"
```

## Bob's first command

Before changing code, Bob should always run a tiny smoke test.

### Canonical repo path: `/runsync`

```bash
curl -i "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}' | head -80
```

Expected:

- HTTP `200`
- JSON response body
- Usually `status: "COMPLETED"`
- Usually `output.success: true`

### One-off diagnostic fallback: `/run-sync`

This is not the repo standard. Only try it if a raw manual curl to `/runsync` returns `404` and you need to prove the upstream route shape:

```bash
curl -i "${INFERENCE_SERVICE_URL}/run-sync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}' | head -80
```

If `/run-sync` works unexpectedly, treat that as an upstream mismatch to investigate. Do not change the repo's canonical env shape without updating the Bob inference docs and call sites together.

## Day-to-day worker management

### What Bob can do from Codespaces

- Send smoke-test requests
- Verify endpoint auth and route shape
- Confirm whether responses are healthy, queued, timing out, or failing
- Use the RunPod Console to inspect requests, workers, and logs

### What Bob cannot do with only the `rpa_...` inference key

RunPod uses separate auth surfaces:

- RunPod inference key (`rpa_...`): invoke endpoint traffic
- Console or GraphQL management auth: programmatic scaling and endpoint management

That means Bob should manage workers from the RunPod Console unless separate admin automation exists.

## Bob automation in this repo

This repository now includes a lightweight Bob supervisor for Codespaces or any container that can reach RunPod.

Available commands:

- `npm run runpod:bob:supervisor:once`
- `npm run runpod:bob:supervisor`
- `npm run runpod:bob:supervisor:start`
- `npm run runpod:bob:activity`
- `npm run runpod:bob:hook-server`
- `npm run runpod:bob:status`

What the supervisor does:

- smoke-tests `${INFERENCE_SERVICE_URL}/runsync`
- stores state in `.runtime/runpod-bob-supervisor-state.json`
- counts consecutive failures
- can trigger recovery or scale-up commands after repeated failures
- can scale down after inactivity when an activity file is used

### Supervisor environment knobs

- `BOB_SUPERVISOR_INTERVAL_MS` default `60000`
- `BOB_SUPERVISOR_FAILURE_THRESHOLD` default `3`
- `BOB_SUPERVISOR_SMOKE_TIMEOUT_MS` default `45000`
- `BOB_SUPERVISOR_ACTION_COOLDOWN_MS` default `300000`
- `BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS` default `1800000`
- `BOB_SUPERVISOR_STATE_FILE` default `.runtime/runpod-bob-supervisor-state.json`
- `BOB_SUPERVISOR_ACTIVITY_FILE` default `.runtime/runpod-bob-activity.touch`
- `BOB_SUPERVISOR_PING_MESSAGE` default `ping`

### Recovery and scaling hooks

The supervisor supports custom shell commands:

- `BOB_RUNPOD_RECOVER_CMD`
- `BOB_RUNPOD_SCALE_UP_CMD`
- `BOB_RUNPOD_SCALE_DOWN_CMD`

Recommended defaults in this repo:

```bash
export BOB_RUNPOD_RECOVER_CMD="node scripts/runpod-bob-action-hook.mjs --action recover"
export BOB_RUNPOD_SCALE_UP_CMD="node scripts/runpod-bob-action-hook.mjs --action scale-up"
export BOB_RUNPOD_SCALE_DOWN_CMD="node scripts/runpod-bob-action-hook.mjs --action scale-down"
```

If `RUNPOD_POD_ID` is set, the supervisor can fall back to the existing pod lifecycle script for:

- recovery/start
- scale-down/stop

That fallback applies to pods, not serverless worker counts.

### Activity-driven idle scale-down

Touch the activity file whenever Bob receives work:

```bash
npm run runpod:bob:activity
```

Automatic heartbeat integration:

- `scripts/invoke-runpod-endpoint.mjs` now touches the supervisor activity file automatically on successful endpoint invocation flows.
- This means `npm run runpod:endpoint:invoke` contributes activity without a separate manual touch command.

The supervisor compares the activity file age to `BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS`. If the endpoint is healthy and activity has been quiet long enough, it can run `BOB_RUNPOD_SCALE_DOWN_CMD`.

### Recommended usage pattern

For Codespaces or a long-running container session:

```bash
export BOB_SUPERVISOR_ACTIVITY_FILE=".runtime/runpod-bob-activity.touch"
export BOB_SUPERVISOR_FAILURE_THRESHOLD=3
export BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS=1800000

npm run runpod:bob:supervisor
```

Or use the startup wrapper that loads `.runtime/bob.env` and `.env` automatically with safe defaults:

```bash
npm run runpod:bob:supervisor:start
```

For a single health/recovery pass:

```bash
npm run runpod:bob:supervisor:once
```

For safe testing without executing any hooks:

```bash
node scripts/runpod-bob-supervisor.mjs --once --dryRun
```

### Hook server for external trigger or cron-style control

Run a token-protected local hook server:

```bash
export BOB_AUTOMATION_WEBHOOK_TOKEN="replace-with-strong-token"
npm run runpod:bob:hook-server
```

Default bind is local-only (`127.0.0.1:8787`).

Available endpoints:

- `GET /health`
- `POST /actions/run-once`
- `POST /actions/activity`
- `POST /actions/recover`
- `POST /actions/scale-up`
- `POST /actions/scale-down`

Example external trigger:

```bash
curl -sS -X POST http://127.0.0.1:8787/actions/run-once \
  -H "Authorization: Bearer ${BOB_AUTOMATION_WEBHOOK_TOKEN}"
```

To expose beyond localhost, start with `--allow-remote` and apply network controls in your host or reverse proxy.

### One-command automation dashboard

Use:

```bash
npm run runpod:bob:status
```

This reports:

- supervisor state counters and timestamps
- activity heartbeat age
- hook server health status
- best-effort `runpodDollars.formatted` value (for example `$123.45`) when the RunPod GraphQL key exposes a balance field

If RunPod does not expose balance fields for the current key scope, the dashboard returns `runpodDollars.available=false` with attempt diagnostics.

### Important limitation

This repo now automates:

- health checks
- failure detection
- recovery hooks
- idle-based scale-down hooks

What it does not yet do in a grounded way:

- directly change RunPod Serverless `workersMin` or `workersMax` by API from this repo

Use the RunPod Console for serverless worker-count changes unless you add a verified RunPod management integration for that exact endpoint surface.

## RunPod Console checklist

Open:

- `https://console.runpod.io/serverless`
- Endpoint: `fieldops-ai-engine` (`n0bp1ifmq01cx2`)

### Cost control

Recommended settings:

- Normal operation: `workersMin=0`, `workersMax=1`
- Pause completely: `workersMax=0`

### If jobs are stuck in queue

- Check the Workers tab and confirm a worker comes up when `workersMax=1`
- Check Logs for crash loops, missing env vars, or dependency failures
- Check Requests and cancel bad or stuck jobs if needed

### Stable default scaler settings

- `workersMin=0`
- `workersMax=1`
- `idleTimeout=60`
- Scaler: `QUEUE_DELAY`
- Queue delay target: about `2-4`

## Troubleshooting matrix

- `401 Unauthorized`: `INFERENCE_API_KEY` is wrong, expired, or not an `rpa_` key
- `404 Not Found`: wrong path or wrong base URL; try `/runsync` first, `/run-sync` only as a diagnostic probe
- `5xx` or timeout: worker crash, missing env vars, model cold start, model download, or overloaded worker
- Queue grows with no workers: `workersMax=0`, quota issue, or worker startup failure

## Repo alignment notes

- The canonical environment reference is in `docs/BOB_ENV_REFERENCE.md`
- The canonical operational playbook is this file
- If these ever disagree, update both in the same change

## Minimal daily Bob workflow

```bash
cd /workspaces/FreedomCamp-Manager

if [ -f .runtime/bob.env ]; then
  source .runtime/bob.env
fi

echo "URL=$INFERENCE_SERVICE_URL"
echo "KEY_PREFIX=${INFERENCE_API_KEY:0:4}"

curl -i "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}' | head -80
```