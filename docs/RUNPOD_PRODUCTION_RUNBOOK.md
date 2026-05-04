# RunPod Production Runbook

Last updated: 2026-04-30
Owner: FieldOps AI Platform Ops

Hybrid reference: [RUNPOD_HYBRID_RUNBOOK.md](RUNPOD_HYBRID_RUNBOOK.md)

## 1. Scope

This runbook defines production operations for the FieldOps AI stack on RunPod:

- Serverless primary path for request execution.
- Pod path for heavy/stateful diagnostics and fallback workflows.
- Template and image promotion process.
- Incident handling for 404/502/restart loops/zero-GPU restarts.

## 2. Current Production Topology

### Serverless (primary)

- Endpoint ID: n0bp1ifmq01cx2
- Endpoint name: fieldops-ai-engine
- Endpoint template ID: mve4hl7rxv
- workersMin: 0
- workersMax: 2
- scalerType: QUEUE_DELAY
- scalerValue: 4
- idleTimeout: 180
- executionTimeoutMs: 600000

GPU preference order currently configured:

Tier 1 — 24 GB, high supply (primary):
1. NVIDIA GeForce RTX 4090
2. NVIDIA L4
3. NVIDIA RTX A5000

Tier 2 — 24 GB professional:
4. NVIDIA RTX A4500
5. NVIDIA RTX 4000 Ada Generation

Tier 3 — 48 GB, moderate supply:
6. NVIDIA RTX A6000
7. NVIDIA A40

Tier 4 — 80 GB HPC, lower supply:
8. NVIDIA A100 80GB PCIe
9. NVIDIA A100-SXM4-80GB

Tier 5 — original enterprise preference (last-resort fallback):
10. NVIDIA RTX 6000 Ada Generation
11. NVIDIA L40
12. NVIDIA L40S

> **Note:** Use `scripts/update-runpod-endpoint-gpus.mjs` or the
> `Ops – RunPod Update Endpoint GPU Types` GitHub Actions workflow to apply
> changes to the live endpoint when supply on the current tier is low.

### Templates

- Serverless template: mve4hl7rxv (fieldops-ai-serverless)
- Worker/pod template: qv0q50yvka (fieldops-ai-worker)
- Both currently point to image digest:
  - ghcr.io/donsquires/freedomcamp-manager-ai@sha256:d024aa6930f47095ecbe574b305b248edc425269c092c25f538eb6e2453c46fb

### Pod inventory

- Pod: 0ua9n24yxpvvrw (bob-automation-pod-v2-a40)
- Current desiredStatus: EXITED
- Last observed image: ghcr.io/donsquires/freedomcamp-manager-ai@sha256:d024aa6930f47095ecbe574b305b248edc425269c092c25f538eb6e2453c46fb

## 3. Golden Operating Mode

Use this mode unless there is an explicit incident override:

1. Serverless is primary for all production traffic.
2. Maintain only one pod when pod mode is required.
3. Pod startup behavior must be controlled via template or schema-supported dockerStartCmd fields (not unsupported ad hoc patch fields).
4. Use image digests (not mutable latest tags) for promoted runtime paths.
5. Keep durable data off ephemeral container disk.

## 4. Standard Health Checks

### 4.1 Serverless quick checks

- Sync ping:
  - POST https://api.runpod.ai/v2/n0bp1ifmq01cx2/runsync
  - Body: {"input":{"action":"ping"}}
- Success criteria:
  - HTTP 200
  - output.message indicates online status

### 4.2 Pod quick checks

- Proxy health:
  - GET https://<pod-id>-3000.proxy.runpod.net/health
- Pod API ping (if helper API enabled):
  - POST https://<pod-id>-3000.proxy.runpod.net/run
  - Body: {"input":{"action":"ping"}}
- Success criteria:
  - HTTP 200 from health
  - run endpoint returns action output

### 4.3 Control-plane checks

- REST endpoint state:
  - GET /v1/endpoints/{endpointId}
- Pod state:
  - GET /v1/pods/{podId}
- Template image alignment:
  - GET /v1/templates

## 5. Deployment and Promotion Workflow

### 5.1 Build and publish image

- Merge to main updates runpod-worker paths and triggers image build pipeline.
- Prefer immutable digests for production references.

### 5.2 Promote template image

1. Update template imageName to digest on serverless template.
2. Update template imageName to same digest on worker/pod template.
3. Verify with GET /v1/templates.

### 5.3 Refresh endpoint workers

- Patch endpoint (or trigger update flow) so fresh workers pick up the promoted template/image.
- Re-run runsync ping and one representative workload request.

### 5.4 Pod rollout

- Start or recreate a single pod from the worker template.
- Verify health endpoint and startup readiness before any pod traffic.

## 6. Incident Runbooks

### 6.1 404 on pod /health or /run

Likely causes:

- Wrong startup command/entrypoint.
- Service never bound to expected port.
- Pod running but app not launched.

Actions:

1. Confirm pod image and startup command fields (dockerStartCmd, dockerEntrypoint).
2. Prefer startup command fallback form:
  - `bash -lc 'if [ -x /usr/local/bin/pod_start.sh ]; then exec /usr/local/bin/pod_start.sh; elif [ -x /app/pod_start.sh ]; then exec /app/pod_start.sh; elif [ -x /app/start.sh ]; then exec /app/start.sh; else ls -la /app || true; exit 1; fi'`
3. Validate exposed HTTP port includes internal app port.
4. Restart pod once.
5. If still failing, recreate pod from known-good template.
6. Keep serverless primary during pod outage.

### 6.2 502 from pod proxy

Likely causes:

- App crash during bootstrap.
- Slow startup not yet ready behind proxy.
- Runtime dependency/start script failure.

Actions:

1. Inspect pod logs and startup script output.
2. Confirm app binds 0.0.0.0 and expected internal port.
3. Validate startup script is resilient (non-critical failures do not hard-exit).
4. Restart pod and re-check health.
5. If repeatable, redeploy template with fixed startup scripts.

### 6.3 Pod restart loop / flapping

Likely causes:

- Strict startup failure path exits container.
- Auth/bootstrap steps fail and terminate entrypoint.
- Pod is using serverless worker startup path (`start.sh`) so worker exits after no job/test payload.

Actions:

1. Validate repo/bootstrap auth path is robust.
2. Remove brittle tokenized URL patterns where possible.
3. Make startup script tolerant to non-critical install/model-fetch failures.
4. Recycle pod after applying mitigation.
5. If unresolved, replace pod from fixed template and keep one-pod policy.

Pod startup command guardrail:

1. Prefer image default CMD routed through `/usr/local/bin/start_mode.sh`.
2. If overriding startup command in RunPod Console, force pod mode explicitly:
  - `bash -lc 'export RUNPOD_RUNTIME_MODE=pod; exec /usr/local/bin/start_mode.sh'`
3. Avoid direct pod startup commands that run only the serverless worker path.

### 6.4 Zero GPU on restart

Cause:

- Original machine GPU no longer available after pod stop.

Actions:

1. If immediate recovery needed, terminate and redeploy pod on available hardware.
2. Keep data on network volume to avoid machine-coupled loss.
3. If redeploy blocked by capacity, remain on serverless primary and retry with alternate GPU tiers.

### 6.5 Supply constraint on pod creation

Actions:

1. Try alternate cloud type and GPU type list.
2. Keep one active candidate request at a time.
3. Continue production on serverless primary.
4. Re-attempt pod creation on a timed retry cadence.

## 7. Capacity Fallback Matrix

When preferred GPU is unavailable, fallback in this order for serverless endpoint classes:

1. RTX 6000 Ada / L40 / L40S class
2. RTX PRO 6000 Blackwell class
3. A40 / A6000 class (if endpoint config is expanded to include it)
4. L4 / 4090 class for lighter workloads

Pod fallback policy:

1. Preferred: A40/L40S class for current workload profile
2. Then: RTX 6000 Ada class
3. Then: L4/4090 class for non-critical or degraded mode

## 8. Security and Secrets

1. Never hardcode API keys in source.
2. Use RunPod secrets/template env mapping for sensitive values.
3. Avoid embedding long-lived tokens in GITHUB_REPO_URL.
4. Rotate secrets on suspected exposure.

## 9. Cost Controls

1. Keep serverless workersMin at 0 unless low-latency needs justify active workers.
2. Keep single-pod policy for pod mode.
3. Stop non-essential pods promptly.
4. Track storage spend separately from compute spend.

## 10. Operational Commands (Reference)

### REST base

- https://rest.runpod.io/v1

### Core pod operations

- POST /pods
- PATCH /pods/{podId}
- POST /pods/{podId}/start
- POST /pods/{podId}/stop
- POST /pods/{podId}/restart
- POST /pods/{podId}/reset
- DELETE /pods/{podId}

### Core template operations

- GET /templates
- PATCH /templates/{templateId}

### Core endpoint operations

- GET /endpoints/{endpointId}
- PATCH /endpoints/{endpointId}

## 11. Change Validation Gate

Before and after each production change:

1. Confirm intended runtime path (serverless or pod) and expected user-visible result.
2. Verify endpoint/template/pod IDs and image digest consistency.
3. Run serverless ping and one representative request.
4. If pod involved, verify pod health endpoint and API endpoint.
5. Confirm no duplicate running pods.

## 12. Recovery Policy

If pod path is unstable:

1. Keep serverless as production path.
2. Freeze pod traffic.
3. Repair via template/image/startup updates.
4. Re-enable pod only after health and run checks pass.

If serverless path is degraded:

1. Roll endpoint to known-good template/image.
2. Temporarily raise workersMin if cold-start pressure is the issue.
3. If needed, activate one healthy pod for controlled fallback workloads.
