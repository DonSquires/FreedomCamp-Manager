# Modular Self-Hosted Speech Stack Runbook

Date: 2026-05-06
Owner: Platform / Master Systems Manager

## Bob Assistant User-Only Policy

1. Bob assistant behavior is strictly user-scoped, not organization-scoped.
2. Access to Bob speech capabilities follows authenticated user identity, even if a user moves between organizations.
3. Organization context may be carried only as optional metadata for analytics or routing hints, never as an access restriction.

## Objective

Replace proprietary wake-word + intent lock-in with a modular stack that you control end-to-end using open model formats and self-hosted runtimes.

## Deployment Decision (grounded in current repo)

1. Railway: STT service (`railway-stt/`, Faster-Whisper `distil-small.en`, CPU).
   - Replaces RunPod serverless STT which suffered persistent GPU supply constraints.
   - Deployed via `.github/workflows/deploy-railway-stt.yml`.
   - ~$3–6/mo, absorbed by Railway Pro $20 credit, no cold-start GPU scarcity.
2. RunPod: AI/Bob inference only (`fieldops-ai-engine`, endpoint `n0bp1ifmq01cx2`).
   - STT endpoint `qufsywq39klcma` kept idle (`workersMax=0`) as emergency GPU fallback.
3. hPanel VPS: speech-router orchestration and optional local TTS endpoint.
4. Railway: proxy-server + new railway-stt service.

STT_URL in speech-router now points to Railway: `https://<railway-stt>.up.railway.app/transcribe`

## Model and Format Strategy

1. Wake word:
   - Primary: Sherpa-ONNX keyword spotting for universal ONNX compatibility.
   - Alternative: openWakeWord for custom phrase training workflows.
2. STT:
   - `distil-small.en` on Railway CPU (primary — ~1s/clip, no GPU scarcity).
   - `distil-large-v3` on RunPod GPU (fallback — higher quality, subject to supply).
3. Intent:
   - Llama 3.1 8B Instruct (RunPod vLLM) for natural language intent mapping.
   - Optional fallback: Phi-3 mini for lower-cost latency-sensitive intents.
4. TTS:
   - Kokoro-82M ONNX (default self-hosted voice).
   - Optional phase-gated voice clone track remains governed by ADR constraints.

## Service Layout

- `ops/speech-intent/speech-router/`: FastAPI orchestrator.
- `ops/speech-intent/docker-compose.yml`: hPanel-ready deployment for speech-router.
- `ops/speech-intent/.env.example`: endpoint and key wiring.

API contracts exposed by speech-router:

1. `GET /health`
2. `POST /v1/speech-to-intent`
3. `POST /v1/tts`

## Request Flow

1. Client wake-word module detects activation (`Hey Bob` or custom phrase).
2. Client sends captured audio buffer to speech-router.
3. speech-router calls configured STT endpoint.
4. speech-router calls configured Intent endpoint with transcript and context.
5. Optional speech response generated via configured TTS endpoint.
6. Response returns transcript + structured intent + optional audio.

## hPanel Deployment

From repo root:

```bash
cd ops/speech-intent
cp .env.example .env
# Fill STT_URL / INTENT_URL / TTS_URL and API keys

docker compose up -d --build
curl -sS http://127.0.0.1:8080/health
```

## RunPod Endpoint Guidance

Use dedicated endpoints per function when possible:

1. STT endpoint: optimized for Whisper/Faster-Whisper batch or short-stream jobs.
2. Intent endpoint: optimized for chat completion + JSON schema output.
3. Optional TTS endpoint if local VPS TTS throughput is insufficient.

## Wake Word Training (openWakeWord lane)

Recommended process:

1. Capture phrase samples for target wake phrase and accent variants.
2. Generate synthetic augmentations (noise, distance, reverberation).
3. Train and export ONNX artifact.
4. Validate false-accept and false-reject rates with field audio.
5. Promote model to production only after threshold gate passes.

## Operational Guardrails

1. Keep mutation/execution policy enforcement in existing Bob gateway + edge contract checks.
2. Keep synthetic audio clearly labeled in UI and logs.
3. Keep user-scoped checks before executing intents.
4. Prefer fail-soft behavior: if STT/Intent/TTS fails, radio and core workflows must continue.

## Next Integration Steps

1. Add client wake-word adapter abstraction (`sherpa-onnx` vs `openwakeword`).
2. Add Supabase edge function shim that calls speech-router and enforces auth/user context.
3. Add Playwright/API tests for speech-to-intent and degraded-mode behavior.
4. Add governance gate check to ensure speech endpoints remain self-hosted and not vendor-locked.
