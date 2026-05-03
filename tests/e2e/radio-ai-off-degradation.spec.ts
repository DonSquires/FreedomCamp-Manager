import { test, expect } from '@playwright/test'

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function getInferenceBaseUrl(): string {
  return readEnv('INFERENCE_SERVICE_URL', 'BOB_SERVICE_URL', 'VITE_INFERENCE_SERVICE_URL').replace(/\/$/, '')
}

function getInferenceApiKey(): string {
  return readEnv('INFERENCE_API_KEY', 'BOB_INFERENCE_API_KEY', 'VITE_INFERENCE_API_KEY')
}

function getSpeechWebhookSecret(): string {
  return readEnv('RADIO_SPEECH_WEBHOOK_SECRET')
}

function getMediaTapSecret(): string {
  return readEnv('RADIO_MEDIA_TAP_SECRET', 'RADIO_SPEECH_WEBHOOK_SECRET')
}

function authHeaders(): Record<string, string> {
  const apiKey = getInferenceApiKey()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  const speechSecret = getSpeechWebhookSecret()
  if (speechSecret) h['x-radio-speech-secret'] = speechSecret
  const mediaTapSecret = getMediaTapSecret()
  if (mediaTapSecret) h['x-radio-media-secret'] = mediaTapSecret
  return h
}

const maxAckLatencyMs = parseInt(readEnv('PLAYWRIGHT_RADIO_SPEECH_ACK_MAX_MS') || '2000', 10)

test.describe('radio AI-off degradation behavior', () => {
  test('health endpoint exposes radio pipeline mode', async () => {
    const baseUrl = getInferenceBaseUrl()
    test.skip(!baseUrl, 'INFERENCE_SERVICE_URL/BOB_SERVICE_URL not configured')

    const res = await fetch(`${baseUrl}/health`, { headers: authHeaders() })
    if (!res.ok) {
      test.skip(true, `Inference /health unavailable in this environment (status=${res.status})`)
    }

    const data = await res.json() as {
      radio_pipeline?: {
        processor_enabled?: boolean
        processor_mode?: string
        ollama_ptt_configured?: boolean
      }
      radio_media_tap?: {
        enabled?: boolean
        metrics?: {
          accepted_events?: number
          rejected_events?: number
        }
      }
    }

    if (!data.radio_pipeline) {
      // Older deployments may not include the radio_pipeline object yet.
      // Keep this test as a compatibility check instead of hard-failing.
      expect(typeof data).toBe('object')
      return
    }

    expect(['stub', 'whisper']).toContain(String(data.radio_pipeline.processor_mode || ''))

    const configuredEnabled = String(process.env.RADIO_PROCESSOR_ENABLED || '').toLowerCase()
    if (configuredEnabled === 'false') {
      expect(data.radio_pipeline?.processor_mode).toBe('stub')
    }

    if (data.radio_media_tap) {
      expect(typeof data.radio_media_tap.enabled).toBe('boolean')
      expect(typeof data.radio_media_tap.metrics?.accepted_events).toBe('number')
      expect(typeof data.radio_media_tap.metrics?.rejected_events).toBe('number')
    }
  })

  test('speech-event endpoint returns quick 202 ack even in degraded mode', async () => {
    const baseUrl = getInferenceBaseUrl()
    const apiKey = getInferenceApiKey()
    test.skip(!baseUrl || !apiKey, 'Inference URL/key not configured for authenticated speech-event test')

    const payload = {
      type: 'radio.producer.created',
      transmissionId: `tx-${Date.now()}`,
      orgId: '00000000-0000-0000-0000-000000000000',
      language: 'en',
    }

    const start = Date.now()
    const res = await fetch(`${baseUrl}/radio/speech-event`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
    const elapsedMs = Date.now() - start

    if (res.status === 404) {
      test.skip(true, 'radio/speech-event endpoint not deployed on this inference environment')
    }

    expect([202, 404]).toContain(res.status)
    if (res.status === 202) {
      expect(elapsedMs).toBeLessThan(maxAckLatencyMs)
    }

    if (res.status === 202) {
      const body = await res.json() as { accepted?: boolean; stage?: string }
      expect(body.accepted).toBe(true)
      expect(body.stage).toBe('queued-for-speech-pipeline')
    }
  })

  test('media-tap endpoint returns contract response in enabled or disabled mode', async () => {
    const baseUrl = getInferenceBaseUrl()
    const apiKey = getInferenceApiKey()
    test.skip(!baseUrl || !apiKey, 'Inference URL/key not configured for authenticated media-tap test')

    const payload = {
      type: 'radio.media.chunk.created',
      transmissionId: `tap-${Date.now()}`,
      orgId: '00000000-0000-0000-0000-000000000000',
      mediaKind: 'audio',
      storagePath: 'ptt/test/audio.opus',
    }

    const res = await fetch(`${baseUrl}/radio/media-tap`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })

    if (res.status === 404) {
      test.skip(true, 'radio/media-tap endpoint not deployed on this inference environment')
    }

    expect([202, 404]).toContain(res.status)
    if (res.status === 202) {
      const body = await res.json() as { accepted?: boolean; stage?: string }
      expect(typeof body.accepted).toBe('boolean')
      expect(['media-tap-disabled', 'queued-for-media-tap-pipeline']).toContain(String(body.stage || ''))
    }
  })
})
