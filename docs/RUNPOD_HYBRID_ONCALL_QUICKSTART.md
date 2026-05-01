# RunPod Hybrid On-Call Quickstart

Primary reference: [RUNPOD_HYBRID_RUNBOOK.md](RUNPOD_HYBRID_RUNBOOK.md)

## 1. Golden Mode

1. Serverless first.
2. Single pod only.
3. Route through `inference-service` hybrid endpoints, not ad hoc direct calls.

## 2. 60-Second Checks

1. Serverless quick ping:
   - `POST https://api.runpod.ai/v2/<endpoint-id>/runsync`
   - body: `{"input":{"action":"ping"}}`
2. Hybrid API health (if pod service is up):
   - `GET <bob-service-url>/health`
3. Pod control snapshot:
   - `GET <bob-service-url>/runpod/pod`

## 3. Fast Routing Decision

1. Core text actions (`chat/review/assess/translate/training_note`) -> serverless.
2. Unsupported serverless action (`Unknown action`) -> pod fallback.
3. Payload contract error (for example `image_b64 required`) -> return client fix guidance, no fallback.

## 4. Immediate Escalation Rules

1. One-off runtime failure:
   - retry once and include error context.
2. Repeated capability mismatch:
   - queue `POST /ask-copilot` for diagnostic research.
3. Repeated implementation gap:
   - queue `POST /code/task` for permanent fix and PR automation.

## 5. Incident Workflows To Run

1. `.github/workflows/ops-runpod-quickcheck.yml`
2. `.github/workflows/ops-runpod-serverless-smoke.yml`
3. `.github/workflows/ops-bob-capability-watchdog.yml`

## 6. Current High-Signal Failure Patterns

1. `Unknown action: run_playwright` on live serverless means deployment capability drift.
2. HTTP 200 with failed payload means transport is healthy but action execution failed.
3. Pod control-plane `RUNNING` does not guarantee app endpoint readiness.
