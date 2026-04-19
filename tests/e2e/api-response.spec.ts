/**
 * API Response Tests
 *
 * Verifies that the key Supabase Edge Function APIs respond to requests.
 * Each test calls a function directly via HTTP (using Playwright's request
 * context, no browser required) and asserts that:
 *   1. The HTTP response is received (no network / DNS failure).
 *   2. The Content-Type is JSON.
 *   3. The response body can be parsed as JSON.
 *
 * Note: Tests intentionally do NOT assert specific data values because the
 * functions depend on third-party services (NZSCV, MotorWeb, Open-Meteo,
 * Railway) that may be unavailable in CI.  The goal is simply to confirm
 * the edge function endpoint is reachable and returns a parseable response.
 */

import { test, expect } from '@playwright/test'
import { getApiBearerToken, getApiTestCredentials } from './auth'

let cachedBearerToken = getApiBearerToken()
let bearerBootstrapAttempted = false

const DEFAULT_SUPABASE_URL = 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'

function getSupabaseUrl(): string {
  const candidates = [
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
    DEFAULT_SUPABASE_URL,
  ]

  for (const candidate of candidates) {
    const base = (candidate || '').trim().replace(/^['"]|['"]$/g, '')
    if (/^https?:\/\//i.test(base)) {
      return base.replace(/\/$/, '')
    }
  }

  throw new Error(
    'Unable to resolve an absolute Supabase URL from VITE_SUPABASE_URL/SUPABASE_URL.'
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the full Supabase Edge Function URL from the environment variables
 * that are already used by the frontend and the e2e setup.
 *
 * VITE_SUPABASE_URL looks like: https://<project>.supabase.co
 * Edge functions are served at:  https://<project>.supabase.co/functions/v1/<name>
 */
function edgeFunctionUrl(name: string): string {
  return `${getSupabaseUrl()}/functions/v1/${name}`
}

function supabaseBaseUrl(): string {
  return getSupabaseUrl()
}

/**
 * Common headers required by Supabase Edge Functions.
 */
function authHeaders(bearerToken?: string): Record<string, string> {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!anonKey) {
    throw new Error(
      `VITE_SUPABASE_ANON_KEY is not set. ` +
      `Copy .env.example to .env and fill in the Supabase anon key.`
    )
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: anonKey,
  }

  // Optional bearer token for protected functions.
  // If not provided, protected endpoints are expected to return 401.
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }

  return headers
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

  const response = await fetch(
    `${supabaseBaseUrl()}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    }
  )

  if (!response.ok) {
    return null
  }

  const payload = await response.json() as { access_token?: string }
  const token = payload.access_token || null
  if (token) {
    cachedBearerToken = token
    return token
  }

  return null
}

async function isBearerTokenValid(token: string): Promise<boolean> {
  const response = await fetch(`${supabaseBaseUrl()}/auth/v1/user`, {
    method: 'GET',
    headers: authHeaders(token),
  })

  return response.ok
}

async function requireBearerToken(): Promise<string> {
  const token = await resolveBearerToken()
  if (token) return token

  throw new Error(
    'API response tests require live auth. Set API_TEST_BEARER_TOKEN or provide API_TEST_EMAIL/API_TEST_PASSWORD for a live user.'
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('API Response Tests – Supabase Edge Functions', () => {
  test.beforeAll(async () => {
    await requireBearerToken()
  })

  // --------------------------------------------------------------------------
  // check-railway-health
  // --------------------------------------------------------------------------
  test('check-railway-health returns a JSON response', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('check-railway-health')

    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(token),
    })

    expect([200]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    // The response must be a non-null object
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')

    expect(body).toHaveProperty('proxy')
    expect(body).toHaveProperty('inference')
    expect(body).toHaveProperty('checked_at')
  })

  // --------------------------------------------------------------------------
  // check-nzscv-status
  // --------------------------------------------------------------------------
  test('check-nzscv-status returns a JSON response for a test plate', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('check-nzscv-status')

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plate_number: 'TEST001' }),
    })

    expect([200, 400, 500, 503]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  test('check-nzscv-status returns 400 when plate_number is missing', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('check-nzscv-status')

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({}),
    })

    expect([400]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  // --------------------------------------------------------------------------
  // enrich-from-motorweb
  // --------------------------------------------------------------------------
  test('enrich-from-motorweb returns a JSON response', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('enrich-from-motorweb')

    // This endpoint is currently a placeholder and returns 503 until MotorWeb
    // credentials are provisioned, which is the expected behaviour.
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plateNumber: 'TEST001' }),
    })

    expect([200, 503]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  // --------------------------------------------------------------------------
  // get-weather
  // --------------------------------------------------------------------------
  test('get-weather returns a JSON response for Auckland coordinates', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('get-weather')

    // Auckland, NZ coordinates
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ latitude: -36.8485, longitude: 174.7633 }),
    })

    // 200 on success; 500 if Open-Meteo is unreachable in the test environment
    expect([200, 500]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  test('get-weather returns an error response when coordinates are missing', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('get-weather')

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({}),
    })

    // Function throws when lat/lon are absent, resulting in 500
    expect(response.status).toBe(500)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  // --------------------------------------------------------------------------
  // get-compliance-statistics
  // --------------------------------------------------------------------------
  test.skip('get-compliance-statistics returns a JSON response', async () => {
    const token = await requireBearerToken()
    const url = edgeFunctionUrl('get-compliance-statistics')

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({}),
    })

    expect([200, 403, 500]).toContain(response.status)
    expect(response.headers.get('content-type') || '').toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })
})
