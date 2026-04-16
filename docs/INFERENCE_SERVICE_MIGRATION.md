# Inference Service Migration: Orc-AI-Inference → Bob Assistant

## Why we consolidated

Both Railway deployments below were serving the same `inference-service/` codebase:

- `https://focused-courage-production-ccee.up.railway.app` (Bob Assistant)
- `https://orc-ai-inference-service-production.up.railway.app` (duplicate)

To reduce cost, avoid configuration drift, and keep docs/secrets consistent, the project now standardizes on:

`https://focused-courage-production-ccee.up.railway.app`

## Manual steps required

### 1) Update Supabase Edge Function secret

```bash
supabase secrets set INFERENCE_SERVICE_URL=https://focused-courage-production-ccee.up.railway.app --project-ref mfqfqqewfpdxqmqnzrvi
```

Or via Dashboard:
https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/functions/secrets

### 2) (Optional) Update GitHub Actions production secret

Set `INFERENCE_SERVICE_URL_PRODUCTION` to:

`https://focused-courage-production-ccee.up.railway.app`

## Verification steps

### Verify Bob Assistant health

```bash
curl https://focused-courage-production-ccee.up.railway.app/health | jq
```

### Verify Edge Function integration

```bash
curl -X POST https://mfqfqqewfpdxqmqnzrvi.supabase.co/functions/v1/check-railway-health \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Feature validation checklist

- AI chat assistant (Bob Assistant Studio)
- Vehicle scanning (PlateScanner)
- Face recognition
- Document analysis

## Remove old Railway service

After verification passes:

1. Open Railway project: **Orc-AI-Inference**
2. Open service: **orc-ai-inference-service**
3. Settings → Danger → **Delete Service**
4. Confirm deletion to stop duplicate deployment cost
