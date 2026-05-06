# RunPod On-Call Quickstart

Use this page during incidents for fast triage.

Primary reference: [RUNPOD_PRODUCTION_RUNBOOK.md](RUNPOD_PRODUCTION_RUNBOOK.md)

## 1. Golden mode

1. Keep Serverless as primary path.
2. Route all Bob inference traffic to serverless runsync URL.
3. Prefer image digests over mutable tags.

## 2. 60-second checks

### Serverless

- Endpoint: n0bp1ifmq01cx2
- Check:
  - POST https://api.runpod.ai/v2/n0bp1ifmq01cx2/runsync
  - Body: {"input":{"action":"ping"}}
- Healthy if HTTP 200 and online message in output.

## 3. Common symptom -> action

### Serverless returns 401 or 403

1. Verify `RUNPOD_API_KEY`/endpoint key is valid.
2. Verify endpoint ID is correct.
3. Confirm request is sent to `/runsync`.

### Zero GPU restart

1. Keep serverless as source of truth and retry across configured GPU tiers.
2. Re-apply endpoint GPU fallback order via endpoint GPU update workflow.
3. Keep traffic on serverless while capacity recovers.

### Supply constraint

1. Retry with alternate GPU/cloud profiles.
2. Continue production on serverless path.

## 4. Quick rollback policy

1. Freeze Pod traffic when Pod path is unstable.
2. Keep Serverless serving production.
3. Roll endpoint/template/image back to last known-good digest if Serverless degrades.

## 5. One-command GitHub check

Run workflow: Ops - RunPod Quickcheck

It validates:

1. Serverless runsync ping
2. Control-plane state (endpoint and template)

See workflow file: [.github/workflows/ops-runpod-quickcheck.yml](../.github/workflows/ops-runpod-quickcheck.yml)
