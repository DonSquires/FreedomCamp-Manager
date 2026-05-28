import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { supabaseAdmin } from './setup'

type AuthFixture = {
  userId: string
  token: string
  email: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim()

function functionUrl(name: string) {
  return `${supabaseUrl}/functions/v1/${name}`
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

async function createAuthFixture(): Promise<AuthFixture> {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  if (!supabaseUrl || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY required')

  const email = `d2-${crypto.randomUUID()}@test.local`
  const password = `D2!${crypto.randomUUID()}aa`

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) throw createError ?? new Error('create user failed')

  const anonClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  })
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError || !signInData.session?.access_token) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    throw signInError ?? new Error('sign in failed')
  }

  return {
    userId: created.user.id,
    token: signInData.session.access_token,
    email,
  }
}

async function createAuthFixtureWithRetry(): Promise<AuthFixture> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await createAuthFixture()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isRateLimit = /rate limit/i.test(message)
      if (!isRateLimit || attempt === 3) break
      await sleep(1_500 * (attempt + 1))
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'createAuthFixture failed')))
}

async function deleteAuthFixture(fixture?: AuthFixture) {
  if (!fixture?.userId || !supabaseAdmin) return
  await supabaseAdmin.auth.admin.deleteUser(fixture.userId)
}

async function callAuthedFunction(
  name: string,
  token: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number },
) {
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 25_000)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(functionUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const rawBody = await response.text()
    return {
      response,
      body: parseJsonSafe(rawBody),
      rawBody,
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      const rawBody = JSON.stringify({ error: `request_timeout_${name}_${timeoutMs}ms` })
      const response = new Response(rawBody, {
        status: 504,
        headers: { 'content-type': 'application/json' },
      })

      return {
        response,
        body: parseJsonSafe(rawBody),
        rawBody,
      }
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function errorMessage(body: Record<string, unknown> | null, rawBody: string): string {
  const fromBody = typeof body?.error === 'string'
    ? body.error
    : typeof body?.message === 'string'
      ? body.message
      : ''
  return fromBody || rawBody || 'unknown error'
}

test.describe('Phase D2 — Translation/Speech boundaries and degraded-mode controls', () => {
  let sharedFixture: AuthFixture | undefined

  test.beforeAll(async () => {
    test.skip(!supabaseAdmin || !supabaseUrl || !anonKey, 'Supabase URL/keys required')
    sharedFixture = await createAuthFixtureWithRetry()
  })

  test.afterAll(async () => {
    await deleteAuthFixture(sharedFixture)
  })

  test('translate-message returns either translation contract or bounded degraded error', async () => {
    test.skip(!supabaseAdmin || !supabaseUrl || !anonKey, 'Supabase URL/keys required')
    if (!sharedFixture) throw new Error('shared auth fixture unavailable')

    const { response, body, rawBody } = await callAuthedFunction('translate-message', sharedFixture.token, {
      text: 'Unit six is en route to the northern zone',
      target_language: 'mi-NZ',
    })

    expect([200, 502, 503, 504]).toContain(response.status)
    if (response.status === 200) {
      expect(typeof body?.translated_text).toBe('string')
      expect(String(body?.translated_text || '').trim().length).toBeGreaterThan(0)
      expect(typeof body?.target_language).toBe('string')
      expect(typeof body?.provider).toBe('string')
      expect(typeof body?.fallback).toBe('boolean')
    } else {
      expect(errorMessage(body, rawBody).length).toBeGreaterThan(0)
    }
  })

  test('synthesize-speech returns playable output contract or bounded degraded error', async () => {
    test.skip(!supabaseAdmin || !supabaseUrl || !anonKey, 'Supabase URL/keys required')
    if (!sharedFixture) throw new Error('shared auth fixture unavailable')

    const response = await fetch(functionUrl('synthesize-speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${sharedFixture.token}`,
      },
      body: JSON.stringify({
        text: 'Synthetic relay test message',
        style: 'bridge_lead',
      }),
    })

    expect([200, 502, 503]).toContain(response.status)

    if (response.status === 200) {
      const contentType = String(response.headers.get('content-type') || '')
      const isAudio = contentType.includes('audio/wav')
      const isJson = contentType.includes('application/json')
      expect(isAudio || isJson).toBe(true)
      if (isJson) {
        const json = parseJsonSafe(await response.text())
        expect(json?.success).toBe(true)
        expect(typeof json?.provider).toBe('string')
      }
    } else {
      const rawBody = await response.text()
      const body = parseJsonSafe(rawBody)
      expect(errorMessage(body, rawBody).length).toBeGreaterThan(0)
    }
  })

  test('transcribe-audio returns transcript/fallback contract or bounded degraded error', async () => {
    test.skip(!supabaseAdmin || !supabaseUrl || !anonKey, 'Supabase URL/keys required')
    if (!sharedFixture) throw new Error('shared auth fixture unavailable')

    const { response, body, rawBody } = await callAuthedFunction('transcribe-audio', sharedFixture.token, {
      audio_base64: 'UklGRiQAAABXQVZFZm10',
      audio_mime_type: 'audio/wav',
      language: 'en',
    })

    expect([200, 400, 502, 503, 504]).toContain(response.status)
    if (response.status === 200) {
      const hasTranscript = typeof body?.transcript === 'string' || body?.transcript === null
      const hasFallbackDirective = body?.client_action === 'web_speech_recognition'
      expect(hasTranscript || hasFallbackDirective).toBe(true)
    } else {
      expect(errorMessage(body, rawBody).length).toBeGreaterThan(0)
    }
  })

  test('speech-to-intent keeps response bounded and writes an audit event when router path executes', async () => {
    test.skip(!supabaseAdmin || !supabaseUrl || !anonKey, 'Supabase URL/keys required')
    if (!sharedFixture) throw new Error('shared auth fixture unavailable')

    const { count: beforeCount } = await supabaseAdmin!
      .from('speech_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', sharedFixture.userId)

    const { response, body, rawBody } = await callAuthedFunction(
      'speech-to-intent',
      sharedFixture.token,
      {
        audio_base64: 'UklGRiQAAABXQVZFZm10',
        language: 'en',
      },
      { timeoutMs: 20_000 },
    )

    expect([200, 502, 503, 504]).toContain(response.status)

    const { count: afterCount } = await supabaseAdmin!
      .from('speech_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', sharedFixture.userId)

    const msg = errorMessage(body, rawBody)
    const routerNotConfigured = response.status === 503 && msg.includes('SPEECH_ROUTER_URL is not configured')
    const shouldRequireAuditIncrement = response.status === 200 && !routerNotConfigured
    if (shouldRequireAuditIncrement) {
      expect(afterCount ?? 0).toBeGreaterThan((beforeCount ?? 0))
    }
  })
})
