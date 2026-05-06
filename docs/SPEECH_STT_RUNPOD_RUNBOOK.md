# Speech STT RunPod Endpoint — Provisioning Runbook

**Image**: `ghcr.io/donsquires/freedomcamp-manager-stt:latest`  
**Model**: Faster-Whisper `distil-large-v3`  
**Purpose**: Real-time field-officer speech-to-text for intent routing

## Bob Assistant User-Only Policy

1. Bob assistant behavior is strictly user-scoped, not organization-scoped.
2. Access to Bob speech capabilities follows authenticated user identity, even if a user moves between organizations.
3. Organization context may be carried only as optional metadata for analytics or routing hints, never as an access restriction.

---

## 1. Build the Image (automated via CI)

The GitHub Actions workflow `.github/workflows/ops-stt-worker-build.yml` builds and pushes the image automatically on every merge to `main` that touches `runpod-stt-worker/`.

To trigger a manual rebuild (e.g. to bake a different model):

```
Actions → "Build & Push STT Worker" → Run workflow
  whisper_model: distil-large-v3   ← default
```

The image is published to `ghcr.io/donsquires/freedomcamp-manager-stt:latest`.

---

## 2. Create the RunPod Serverless Endpoint

1. Go to [RunPod Console → Serverless](https://www.runpod.io/console/serverless)
2. Click **New Endpoint**
3. Settings:

| Field | Value |
|---|---|
| Name | `fieldops-stt` |
| Container Image | `ghcr.io/donsquires/freedomcamp-manager-stt:latest` |
| GPU Type | **RTX 4000 Ada** (16 GB) — or any 16 GB+ VRAM GPU |
| Min Workers | 0 (serverless, scale-to-zero) |
| Max Workers | 3 |
| Idle Timeout | 5 seconds |
| Container Disk | 20 GB (model is ~1.5 GB, leave headroom) |

4. Under **Environment Variables**, add:

| Var | Value |
|---|---|
| `WHISPER_MODEL` | `distil-large-v3` |
| `WHISPER_DEVICE` | `cuda` |
| `WHISPER_COMPUTE` | `float16` |
| `MAX_AUDIO_SECONDS` | `120` |

5. Click **Deploy**.
6. Copy the **Endpoint ID** (format: `xxxxxxxxxxxxxxxx`).

---

## 3. Configure speech-router

In `ops/speech-intent/.env` on the hPanel VPS (`72.61.123.97`):

```env
STT_URL=https://api.runpod.ai/v2/<endpoint-id>/runsync
# STT_API_KEY is used as the Bearer token for RunPod API calls by speech-router
STT_API_KEY=<your-runpod-api-key>
```

Then restart the speech-router container:
```bash
cd /opt/fieldops/speech-intent
docker compose restart speech-router
```

---

## 4. Smoke Test

```bash
# From hPanel VPS or any machine with curl + base64 audio handy
AUDIO_B64=$(base64 -w0 test_audio.wav)

curl -X POST https://api.runpod.ai/v2/<endpoint-id>/runsync \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"input\": {\"audio_b64\": \"$AUDIO_B64\", \"language\": \"en\"}}"
```

Expected response:
```json
{
  "id": "...",
  "status": "COMPLETED",
  "output": {
    "transcript": "officer on scene at campsite 7",
    "language": "en",
    "duration_s": 3.1,
    "processing_ms": 280
  }
}
```

---

## 5. End-to-End Flow

```
Browser mic → useSpeechIntent hook
  → base64 audio → supabase edge fn  speech-to-intent
    → speech-router  POST /v1/speech-to-intent
      → RunPod STT endpoint  (this runbook)
        ← transcript
      → Railway Ollama  llama3.1:8b  intent JSON
    ← { intent_name, confidence, needs_confirmation, entities }
  ← SpeechIntentResult
→ UI advisory display (no DB mutations in Ticket 8 pilot)
```

---

## 6. Cost Estimate

Distil-large-v3 on RTX 4000 Ada:
- ~0.3s to transcribe a 5s clip (real-time factor ~0.06×)
- RunPod RTX 4000 Ada billing: ~\$0.00028/s GPU-active time
- A 5s field report costs < \$0.001 per call
- 10,000 field calls/month ≈ \$10 NZD

---

## 7. Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `{"error": "Model not available"}` | Container failed to load model at startup | Check RunPod logs; verify VRAM ≥ 8 GB |
| `{"error": "payload too large"}` | Audio >25 MB base64 | Enforce `maxDurationMs` in `useSpeechIntent` hook (already 30 s default) |
| HTTP 5xx from RunPod | Cold start > 30s timeout | Increase `SPEECH_ROUTER_TIMEOUT_SECONDS` or warm the endpoint |
| Circuit opens in speech-router | 3 consecutive RunPod failures | Check `GET /health` on speech-router; RunPod endpoint may be scaling down |
