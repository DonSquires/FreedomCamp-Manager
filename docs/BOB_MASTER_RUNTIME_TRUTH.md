# Bob Master Runtime Truth

Status: Authoritative runtime source for Bob production operations.
Last updated: 2026-05-24

## Canonical Three-Tier Architecture

1. RunPod Serverless is the primary cognitive engine.
   - Runs Bob inference and model workloads.
   - Canonical endpoint style in this repo: `https://api.runpod.ai/v2/<endpoint-id>` with `/runsync` invocation.

2. Railway backend/proxy is the orchestration brain.
   - Hosts control-plane services, webhook receivers, operational APIs, and routing logic.
   - Does not host Bob primary model execution.

3. Supabase is the memory and auth boundary.
   - Stores durable app data, reasoning ledgers, training context, and user/session authority.
   - Edge Functions orchestrate authenticated workflows and data-plane integration.

## Runtime Authority Rules

1. Bob chat/tasks must run through RunPod as primary provider.
2. Railway is for service orchestration and integration APIs, not primary model hosting.
3. Supabase is the source of truth for session/auth, persistence, and ledgers.
4. If documentation conflicts with these rules, this file takes precedence.

## Required Env/Secret Contract (High-Level)

1. RunPod layer:
   - `INFERENCE_SERVICE_URL`
   - `INFERENCE_API_KEY`
   - Optional aliases used by compatibility paths: `RUNPOD_ENDPOINT_API_KEY`, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`

2. Railway orchestration layer:
   - Backend and proxy service URLs/tokens relevant to orchestration workflows.
   - Keep inference ownership mapped to RunPod.

3. Supabase layer:
   - URL and keys for auth/persistence.
   - Edge Function secrets must point inference to RunPod canonical endpoint.

## Operational Verification Checklist

1. RunPod smoke check returns HTTP 200 for `/runsync` with auth.
2. Backend health is green and Bob provider path resolves to RunPod config.
3. Supabase edge secrets reference RunPod inference endpoint and API key.
4. Session unlock/login flows work without lockout spam.

## Deprecated Reference Documents

The following are retained for migration history only and are not active architecture authority:

1. `docs/RAILWAY_INTEGRATION.md`
2. `docs/BOB_PRODUCTION_RAILWAY_SETUP.md`
