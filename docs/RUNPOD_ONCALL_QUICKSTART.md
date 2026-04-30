# RunPod On-Call Quickstart

Use this page during incidents for fast triage.

Primary reference: [RUNPOD_PRODUCTION_RUNBOOK.md](RUNPOD_PRODUCTION_RUNBOOK.md)

## 1. Golden mode

1. Keep Serverless as primary path.
2. Keep only one Pod when Pod mode is enabled.
3. Prefer image digests over mutable tags.

## 2. 60-second checks

### Serverless

- Endpoint: n0bp1ifmq01cx2
- Check:
  - POST https://api.runpod.ai/v2/n0bp1ifmq01cx2/runsync
  - Body: {"input":{"action":"ping"}}
- Healthy if HTTP 200 and online message in output.

### Pod

- Check health:
  - GET https://<pod-id>-3000.proxy.runpod.net/health
- Check helper API:
  - POST https://<pod-id>-3000.proxy.runpod.net/run
  - Body: {"input":{"action":"ping"}}
- Healthy if endpoints return HTTP 200.

## 3. Common symptom -> action

### Pod 404 on /health or /run

1. Verify startup command fields (dockerStartCmd/dockerEntrypoint or template startup config).
2. Verify exposed HTTP port matches app bind port.
3. Restart Pod once, then recheck.
4. If still failing, recreate from known-good template.

### Pod 502

1. Check startup logs for crash/bootstrap failure.
2. Confirm app binds 0.0.0.0 and expected internal port.
3. Validate bootstrap script does not hard-exit on non-critical tasks.
4. Restart or replace Pod.

### Pod restart loop

1. Inspect startup script fail points.
2. Remove brittle auth/bootstrap assumptions.
3. Rollout fixed image/template and recycle Pod.

### Zero GPU restart

1. If urgent, terminate and redeploy on available hardware.
2. Use network volume to preserve data portability.
3. Keep Serverless primary while waiting for capacity.

### Supply constraint

1. Retry with alternate GPU/cloud profiles.
2. Keep one candidate Pod only.
3. Continue production on Serverless path.

## 4. Quick rollback policy

1. Freeze Pod traffic when Pod path is unstable.
2. Keep Serverless serving production.
3. Roll endpoint/template/image back to last known-good digest if Serverless degrades.

## 5. One-command GitHub check

Run workflow: Ops - RunPod Quickcheck

It validates:

1. Serverless runsync ping
2. Optional Pod health/run checks
3. Control-plane state (endpoint, template, pod)

See workflow file: [.github/workflows/ops-runpod-quickcheck.yml](../.github/workflows/ops-runpod-quickcheck.yml)
