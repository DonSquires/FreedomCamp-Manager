# PTT Bridge Service — Audio Translation Pipeline

**Real-time voice-to-voice translation** for Push-to-Talk (PTT) communications in FieldOps Manager.

Converts speech in one language → transcription → translation → synthesized speech in target language.

## Architecture

```
User Audio (English)
    ↓
[Whisper STT] → English Transcript
    ↓
[Seamless MT] → Translated Text (e.g., Māori)
    ↓
[Piper TTS] → Audio File (Māori)
    ↓
Translated Audio back to User
```

## Deployment Models

### 1. Local Development (Docker + Ollama)

```bash
# Start Ollama with models
docker run --gpus=all -p 11434:11434 ollama/ollama
ollama pull whisper-small
ollama pull seamless-smoll
ollama pull piper

# Start PTT Bridge service
cd ptt-bridge
npm install
OLLAMA_PTT_BASE_URL=http://localhost:11434 npm start
```

### 2. RunPod Serverless (Production)

Deploy as a RunPod worker with GPU acceleration:

```bash
# Build container
docker build -t ptt-bridge:latest .

# Push to RunPod registry
docker tag ptt-bridge:latest runpod.io/YOUR_USERNAME/ptt-bridge:latest
docker push runpod.io/YOUR_USERNAME/ptt-bridge:latest

# Create Serverless endpoint
# Use RunPod console: create new endpoint
#   Image: ptt-bridge:latest
#   GPU: 1x A100 or RTX 4090
#   Env vars:
#     OLLAMA_PTT_BASE_URL=http://ollama:11434    (sidecar container)
#     BOB_SERVICE_URL=https://your-bob-service
```

### 3. Docker Compose (Full Stack)

```yaml
version: '3.8'
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    environment:
      - OLLAMA_MODELS=/models
    volumes:
      - ./models:/models

  ptt-bridge:
    build: ./ptt-bridge
    ports:
      - "8273:8273"
    depends_on:
      - ollama
    environment:
      OLLAMA_PTT_BASE_URL: http://ollama:11434
      PORT: 8273
```

## API Endpoints

### 1. Health Check

```bash
GET /health

Response:
{
  "status": "ready",
  "timestamp": "2026-05-01T...",
  "ollama_online": true,
  "whisper_available": true,
  "seamless_available": true,
  "piper_available": true,
  "bob_online": false
}
```

### 2. Full Pipeline (Audio → Audio Translation)

```bash
POST /translate-audio

Request:
{
  "audio_base64": "...",               # base64-encoded audio
  "audio_mime_type": "audio/wav",      # or audio/webm, audio/mp3
  "source_lang": "en",                 # BCP-47 code (e.g., en, mi, fr)
  "target_lang": "mi"                  # Target language
}

Response:
{
  "original_transcript": "Hello, how are you?",
  "translated_text": "Kia ora, kumaha koe?",
  "synthesized_audio_base64": "...",
  "audio_mime_type": "audio/wav",
  "pipeline_id": "550e8400-e29b-41d4-a716-446655440000",
  "timing": {
    "transcribe_ms": 3200,
    "translate_ms": 1100,
    "synthesize_ms": 2400,
    "total_ms": 6700
  }
}
```

### 3. Transcription Only (ASR)

```bash
POST /transcribe-only

Request:
{
  "audio_base64": "...",
  "audio_mime_type": "audio/wav",
  "source_lang": "en"
}

Response:
{
  "transcript": "Hello, how are you?",
  "language": "en",
  "confidence": 0.95
}
```

### 4. Translation Only (MT)

```bash
POST /translate-text

Request:
{
  "text": "Hello, how are you?",
  "source_lang": "en",
  "target_lang": "mi"
}

Response:
{
  "translated_text": "Kia ora, kumaha koe?",
  "source_lang": "en",
  "target_lang": "mi"
}
```

### 5. Synthesis Only (TTS)

```bash
POST /synthesize-only

Request:
{
  "text": "Kia ora, kumaha koe?",
  "target_lang": "mi"
}

Response:
{
  "audio_base64": "...",
  "audio_mime_type": "audio/wav",
  "format": "wav"
}
```

### 6. Service Configuration (Admin)

```bash
GET /config

Response:
{
  "port": 8273,
  "ollama_ptt_base_url": "http://ollama:11434",
  "bob_service_url": "http://bob-service:8000",
  "models": {
    "whisper": "whisper-small",
    "seamless": "seamless-smoll",
    "piper_voice": "en_NZ-fiona-medium"
  },
  "features": {
    "caching_enabled": true,
    "max_audio_size_mb": 50
  },
  "log_level": "info",
  "timestamp": "2026-05-01T..."
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8273` | Server port |
| `OLLAMA_PTT_BASE_URL` | — | **Required**. Ollama backend (http://ollama:11434) |
| `BOB_SERVICE_URL` | — | Optional backup translation service |
| `BOB_API_KEY` | — | API key for Bob backup service |
| `WHISPER_MODEL` | `whisper-small` | ASR model |
| `SEAMLESS_MODEL` | `seamless-smoll` | MT model |
| `PIPER_VOICE` | `en_NZ-fiona-medium` | TTS voice profile |
| `ENABLE_CACHING` | `true` | Cache translation results |
| `MAX_AUDIO_SIZE_MB` | `50` | Max audio upload size |
| `LOG_LEVEL` | `info` | Logging verbosity |

## Integration with FieldOps Manager

### From Field Officer Portal (Web)

```typescript
// src/pages/PTTRadio.tsx or Translation Rail component

const translateOfficerMessage = async (audioBlob: Blob, targetLang: string) => {
  const audioBase64 = await blobToBase64(audioBlob)
  
  const response = await fetch('https://ptt-bridge.your-domain.io/translate-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64: audioBase64,
      audio_mime_type: 'audio/webm',
      source_lang: 'en',
      target_lang: targetLang,
    }),
  })
  
  const result = await response.json()
  
  // Play synthesized audio
  const audioElement = new Audio()
  audioElement.src = `data:audio/wav;base64,${result.synthesized_audio_base64}`
  audioElement.play()
  
  // Display transcript & translation for review
  console.log('Original:', result.original_transcript)
  console.log('Translated:', result.translated_text)
}
```

### From Supabase Edge Function

```typescript
// supabase/functions/translate-officer-message/index.ts

import { withCors } from '../_shared/withCors.ts'

const PTT_BRIDGE_URL = Deno.env.get('PTT_BRIDGE_URL') || 'http://ptt-bridge:8273'

Deno.serve(withCors(async (req: Request) => {
  const { audio_base64, source_lang, target_lang } = await req.json()
  
  const res = await fetch(`${PTT_BRIDGE_URL}/translate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64,
      audio_mime_type: 'audio/webm',
      source_lang: source_lang || 'en',
      target_lang: target_lang || 'mi',
    }),
  })
  
  return res
}))
```

## Performance Tuning

### Optimize Model Sizes

- **Fast**: `whisper-tiny` (39M), `seamless-small` (481M), `piper` (20M)
- **Balanced**: `whisper-small` (140M), `seamless-smoll` (481M), `piper` (20M)
- **Accurate**: `whisper-base` (140M), `seamless-medium` (2.1B), `piper-high` (60M)

### GPU Memory Requirements

| Config | VRAM | GPU | Suitable For |
|--------|------|-----|--------------|
| Tiny | 8GB | RTX 3070 | Development |
| Small | 16GB | RTX 4090 | Regional ops |
| Base | 24GB | A100 40GB | National scale |

### RunPod Configuration

For FieldOps pilot deployment:

```
GPU: 1x RTX 4090 (24GB)
vCPU: 8
RAM: 30GB
Storage: 50GB (model cache)
Network: 100Mbps connection
Estimated cost: $0.44/hour on-demand
```

## Monitoring & Observability

### Health Endpoint

Continuously poll `/health` to detect:

- Model availability (whisper, seamless, piper)
- Ollama backend connectivity
- Bob backup service status

```bash
# Example monitoring
while true; do
  curl -s http://ptt-bridge:8273/health | jq '.status'
  sleep 30
done
```

### Logs

Set `LOG_LEVEL=debug` to capture:

- Pipeline execution traces (IDs, timing)
- Model inference requests/responses
- Fallback service activations
- Cache hits/misses

```bash
# Tail logs
docker logs -f --since 5m ptt-bridge
```

### Metrics to Expose

Future enhancements:

- `ptt_translate_total` (counter)
- `ptt_translate_duration_ms` (histogram)
- `ptt_transcribe_confidence` (gauge)
- `ptt_cache_hit_ratio` (gauge)

## Troubleshooting

### "OLLAMA_PTT_BASE_URL is not configured"

```bash
# Verify Ollama is running
curl http://ollama:11434/api/tags

# Set env var correctly
export OLLAMA_PTT_BASE_URL=http://ollama:11434
```

### Models not available

```bash
# Download models into Ollama
curl -X POST http://ollama:11434/api/pull -d '{"name":"whisper-small"}'
curl -X POST http://ollama:11434/api/pull -d '{"name":"seamless-smoll"}'
curl -X POST http://ollama:11434/api/pull -d '{"name":"piper"}'

# List available
curl http://ollama:11434/api/tags
```

### Slow transcription / synthesis

- Reduce model size: `whisper-tiny`, `seamless-small`
- Increase GPU memory allocation
- Check system load: `nvidia-smi`

### Memory leaks in long-running sessions

- Restart service every 24 hours
- Monitor cache size (`ENABLE_CACHING=false` if needed)
- Clear old job logs

## Future Enhancements

1. **Real-time Streaming**: WebSocket endpoint for continuous voice streams
2. **Language Detection**: Auto-detect source language instead of requiring input
3. **Voice Cloning**: Preserve officer's voice characteristics across translation
4. **Accent Adaptation**: Regional NZ English → Māori accent matching
5. **Context Awareness**: Pre-load domain terms (enforcement, compliance, etc.)
6. **Feedback Loop**: Store user corrections to improve future translations

## Support

For issues or feature requests:

1. Check `/config` endpoint for service state
2. Enable `LOG_LEVEL=debug` and capture logs
3. Test each step independently (`/transcribe-only`, `/translate-text`, `/synthesize-only`)
4. Report with pipeline ID from failed request
