import { test, expect } from '@playwright/test'
import { getApiBearerToken, getApiTestCredentials } from './auth'

type TokenResponse = {
  access_token?: string
}

type JsonRecord = Record<string, unknown>

const DEFAULT_SUPABASE_URL = 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'
const CHAT_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_BOB_CHAT_TIMEOUT_MS || 120000)
const ASK_BOB_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_BOB_ASK_TIMEOUT_MS || 180000)
const VOICE_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_BOB_VOICE_TIMEOUT_MS || 90000)

let cachedBearerToken = getApiBearerToken()
let bearerBootstrapAttempted = false

function getSupabaseUrl(): string {
  const candidates = [
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
    DEFAULT_SUPABASE_URL,
  ]

  for (const candidate of candidates) {
    const base = String(candidate || '').trim().replace(/^['"]|['"]$/g, '')
    if (/^https?:\/\//i.test(base)) {
      return base.replace(/\/$/, '')
    }
  }

  throw new Error('Unable to resolve Supabase URL from environment.')
}

function edgeFunctionUrl(name: string): string {
  return `${getSupabaseUrl()}/functions/v1/${name}`
}

function authHeaders(bearerToken?: string): Record<string, string> {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!anonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is not set.')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: anonKey,
  }

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }

  return headers
}

function parseJsonSafe(text: string): JsonRecord | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    return null
  }
}

async function isBearerTokenValid(token: string): Promise<boolean> {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    method: 'GET',
    headers: authHeaders(token),
  })

  return response.ok
}

async function resolveBearerToken(): Promise<string | null> {
  if (cachedBearerToken) {
    const isValid = await isBearerTokenValid(cachedBearerToken)
    if (isValid) return cachedBearerToken
    cachedBearerToken = null
  }

  if (bearerBootstrapAttempted) return null
  bearerBootstrapAttempted = true

  const { email, password } = getApiTestCredentials()
  if (!email || !password) return null

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) return null

  const payload = await response.json() as TokenResponse
  const token = payload.access_token || null
  if (token) {
    cachedBearerToken = token
    return token
  }

  return null
}

async function requireBearerToken(): Promise<string> {
  const token = await resolveBearerToken()
  if (token) return token

  throw new Error(
    'Live auth unavailable. Set API_TEST_BEARER_TOKEN or API_TEST_EMAIL/API_TEST_PASSWORD.',
  )
}

async function callJsonFunction(
  name: string,
  token: string,
  body: JsonRecord,
  timeoutMs: number,
): Promise<{ status: number; body: JsonRecord | null; rawBody: string; contentType: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(edgeFunctionUrl(name), {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const rawBody = await response.text()
    return {
      status: response.status,
      body: parseJsonSafe(rawBody),
      rawBody,
      contentType: String(response.headers.get('content-type') || ''),
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      const rawBody = JSON.stringify({ error: `request_timeout_${name}_${timeoutMs}ms` })
      return {
        status: 504,
        body: parseJsonSafe(rawBody),
        rawBody,
        contentType: 'application/json',
      }
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function callJsonFunctionWithRetry(
  name: string,
  token: string,
  body: JsonRecord,
  timeoutMs: number,
  attempts: number,
): Promise<{ status: number; body: JsonRecord | null; rawBody: string; contentType: string }> {
  let lastResult = await callJsonFunction(name, token, body, timeoutMs)

  for (let i = 1; i < attempts && lastResult.status === 504; i += 1) {
    // Retry only timeout-shaped failures; keep all other statuses strict.
    lastResult = await callJsonFunction(name, token, body, timeoutMs)
  }

  return lastResult
}

async function callBinaryCapableFunction(
  name: string,
  token: string,
  body: JsonRecord,
  timeoutMs: number,
): Promise<{ status: number; rawBody: string; body: JsonRecord | null; contentType: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(edgeFunctionUrl(name), {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const contentType = String(response.headers.get('content-type') || '')
    if (contentType.includes('audio/')) {
      const buffer = await response.arrayBuffer()
      return {
        status: response.status,
        rawBody: `audio-bytes:${buffer.byteLength}`,
        body: { byteLength: buffer.byteLength },
        contentType,
      }
    }

    const rawBody = await response.text()
    return {
      status: response.status,
      rawBody,
      body: parseJsonSafe(rawBody),
      contentType,
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      const rawBody = JSON.stringify({ error: `request_timeout_${name}_${timeoutMs}ms` })
      return {
        status: 504,
        rawBody,
        body: parseJsonSafe(rawBody),
        contentType: 'application/json',
      }
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function bodyError(body: JsonRecord | null, rawBody: string): string {
  const fromBody = typeof body?.error === 'string'
    ? body.error
    : typeof body?.message === 'string'
      ? body.message
      : ''
  return fromBody || rawBody || 'unknown error'
}

test.describe('Bob endpoint reliability', () => {
  test.describe.configure({ timeout: Number(process.env.PLAYWRIGHT_BOB_ENDPOINT_TEST_TIMEOUT_MS || 180000) })

  test('onspace-ai-chat returns a model-backed response without timing out', async () => {
    const token = await requireBearerToken()

    const result = await callJsonFunction(
      'onspace-ai-chat',
      token,
      {
        provider: 'inference',
        model: 'qwen2.5:7b',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are Bob. Reply in one short sentence.' },
          { role: 'user', content: 'Confirm you are connected to the model.' },
        ],
      },
      CHAT_TIMEOUT_MS,
    )

    expect(result.status, result.rawBody).toBe(200)
    expect(result.contentType).toContain('application/json')
    expect(typeof result.body?.response).toBe('string')
    expect(String(result.body?.response || '').trim().length).toBeGreaterThan(0)
    expect(typeof result.body?.provider).toBe('string')
    expect(String(result.body?.provider || '').trim().length).toBeGreaterThan(0)
    expect(typeof result.body?.model).toBe('string')
    expect(String(result.body?.model || '').trim().length).toBeGreaterThan(0)
    if (result.body?.conversation_id !== undefined) {
      expect(typeof result.body?.conversation_id).toBe('string')
      expect(String(result.body?.conversation_id || '').trim().length).toBeGreaterThan(0)
    }
    expect(String(result.body?.response || '').toLowerCase()).not.toContain('timed out')
  })

  test('ask-bob returns an answer from the live Bob model surface', async () => {
    const token = await requireBearerToken()

    const result = await callJsonFunctionWithRetry(
      'ask-bob',
      token,
      {
        prompt: 'Reply with exactly: Bob route operational.',
      },
      ASK_BOB_TIMEOUT_MS,
      2,
    )

    expect(result.status, result.rawBody).toBe(200)
    expect(result.contentType).toContain('application/json')
    expect(typeof result.body?.answer).toBe('string')
    expect(String(result.body?.answer || '').trim().length).toBeGreaterThan(0)
    expect(typeof result.body?.provider).toBe('string')
    expect(String(result.body?.provider || '').trim().length).toBeGreaterThan(0)
    expect(typeof result.body?.model).toBe('string')
    expect(String(result.body?.model || '').trim().length).toBeGreaterThan(0)
    expect(bodyError(result.body, result.rawBody).toLowerCase()).not.toContain('timed out')
  })

  test('synthesize-speech returns playable audio or explicit bounded fallback', async () => {
    const token = await requireBearerToken()

    const result = await callBinaryCapableFunction(
      'synthesize-speech',
      token,
      {
        text: 'Synthetic Bob voice reliability check.',
        style: 'bridge_lead',
      },
      VOICE_TIMEOUT_MS,
    )

    expect(result.status, result.rawBody).toBe(200)
    const isAudio = result.contentType.includes('audio/')
    const isJson = result.contentType.includes('application/json')
    expect(isAudio || isJson, result.contentType).toBe(true)

    if (isAudio) {
      expect(Number(result.body?.byteLength || 0)).toBeGreaterThan(0)
      return
    }

    expect(result.body?.success).not.toBe(false)
    expect(typeof result.body?.provider).toBe('string')
    expect(String(result.body?.provider || '').trim().length).toBeGreaterThan(0)
  })

  test('transcribe-audio responds within bounds and returns structured output', async () => {
    const token = await requireBearerToken()

    const result = await callJsonFunction(
      'transcribe-audio',
      token,
      {
        audio_base64: 'UklGRiQAAABXQVZFZm10',
        audio_mime_type: 'audio/wav',
        language: 'en',
      },
      VOICE_TIMEOUT_MS,
    )

    expect([200, 400, 502, 503]).toContain(result.status)
    expect(result.contentType).toContain('application/json')
    expect(result.status, result.rawBody).not.toBe(504)

    if (result.status === 200) {
      const hasTranscript = typeof result.body?.transcript === 'string' || result.body?.transcript === null
      const hasFallbackDirective = typeof result.body?.client_action === 'string'
      expect(hasTranscript || hasFallbackDirective, result.rawBody).toBe(true)
      return
    }

    expect(bodyError(result.body, result.rawBody).length).toBeGreaterThan(0)
  })
})