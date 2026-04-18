# RunPod Serverless from Codespaces

This workflow is for invoking RunPod Serverless endpoints from a GitHub Codespace.
Use this when you want stateless HTTPS inference calls instead of managing GPU pods from the Codespace.

## Required secrets (Codespaces)

In repository settings, add these Codespaces secrets:

- RUNPOD_ENDPOINT_URL
- RUNPOD_ENDPOINT_API_KEY
- RUNPOD_ENDPOINT_ID (recommended, optional if URL is standard)

Optional for management automation (not required for endpoint invocation):

- RUNPOD_API_KEY

## Verify environment in Codespace

Run this check in terminal:

```bash
for k in RUNPOD_ENDPOINT_URL RUNPOD_ENDPOINT_API_KEY RUNPOD_ENDPOINT_ID; do
  if [ -n "${!k}" ]; then
    echo "$k=present"
  else
    echo "$k=missing"
  fi
done
```

## Invoke endpoint (default payload)

```bash
npm run runpod:endpoint:invoke
```

Default payload:

```json
{
  "input": {
    "prompt": "Hello from Codespaces"
  }
}
```

## Invoke endpoint with custom input

```bash
npm run runpod:endpoint:invoke -- --input '{"prompt":"Summarize NZ freedom camping policy risks"}'
```

## Invoke endpoint with full payload

```bash
npm run runpod:endpoint:invoke -- --payload '{"input":{"prompt":"hello"},"webhook":null}'
```

## Async polling behavior

The script auto-polls if the invoke response returns a job id and non-terminal status.

Tunable polling parameters:

```bash
npm run runpod:endpoint:invoke -- --input '{"prompt":"hello"}' --poll true --intervalMs 3000 --timeoutMs 180000
```

To check an existing job id directly:

```bash
npm run runpod:endpoint:status -- <jobId>
```

You can also pass an explicit status URL template if needed:

```bash
npm run runpod:endpoint:invoke -- --statusJobId <jobId> --statusUrl 'https://api.runpod.ai/v2/<endpointId>/status/{id}'
```

## Notes

- Do not commit endpoint API keys in code or docs.
- Rotate any key that was ever pasted into chat or logs.
- If workersMin is 0, expect occasional cold-start latency.
- If low latency is critical, set workersMin to 1 in RunPod endpoint settings.
