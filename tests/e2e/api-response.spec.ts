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
  const base = process.env.VITE_SUPABASE_URL || ''
  if (!base) {
    throw new Error(
      `VITE_SUPABASE_URL is not set. ` +
      `Copy .env.example to .env and fill in the Supabase project URL.`
    )
  }
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`
}

/**
 * Common headers required by Supabase Edge Functions.
 */
function authHeaders(): Record<string, string> {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('API Response Tests – Supabase Edge Functions', () => {
  // --------------------------------------------------------------------------
  // check-railway-health
  // --------------------------------------------------------------------------
  test('check-railway-health returns a JSON response', async ({ request }) => {
    const url = edgeFunctionUrl('check-railway-health')

    const response = await request.get(url, { headers: authHeaders() })

    // The function always returns 200 even when Railway services are offline
    // (it reports { status: 'offline' } rather than throwing).
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    // The response must be a non-null object
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
    // Core shape: must contain proxy and inference keys
    expect(body).toHaveProperty('proxy')
    expect(body).toHaveProperty('inference')
    expect(body).toHaveProperty('checked_at')
  })

  // --------------------------------------------------------------------------
  // check-nzscv-status
  // --------------------------------------------------------------------------
  test('check-nzscv-status returns a JSON response for a test plate', async ({ request }) => {
    const url = edgeFunctionUrl('check-nzscv-status')

    const response = await request.post(url, {
      headers: authHeaders(),
      data: { plate_number: 'TEST001' },
    })

    // Function returns 200 whether the plate is found or not; 4xx/5xx only on
    // misconfiguration or bad request.
    expect([200, 400, 500, 503]).toContain(response.status())
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  test('check-nzscv-status returns 400 when plate_number is missing', async ({ request }) => {
    const url = edgeFunctionUrl('check-nzscv-status')

    const response = await request.post(url, {
      headers: authHeaders(),
      data: {},
    })

    expect(response.status()).toBe(400)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  // --------------------------------------------------------------------------
  // enrich-from-motorweb
  // --------------------------------------------------------------------------
  test('enrich-from-motorweb returns a JSON response', async ({ request }) => {
    const url = edgeFunctionUrl('enrich-from-motorweb')

    // This endpoint is currently a placeholder and returns 503 until MotorWeb
    // credentials are provisioned, which is the expected behaviour.
    const response = await request.post(url, {
      headers: authHeaders(),
      data: { plateNumber: 'TEST001' },
    })

    // Accept 200 (future full implementation) or 503 (placeholder)
    expect([200, 503]).toContain(response.status())
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  // --------------------------------------------------------------------------
  // get-weather
  // --------------------------------------------------------------------------
  test('get-weather returns a JSON response for Auckland coordinates', async ({ request }) => {
    const url = edgeFunctionUrl('get-weather')

    // Auckland, NZ coordinates
    const response = await request.post(url, {
      headers: authHeaders(),
      data: { latitude: -36.8485, longitude: 174.7633 },
    })

    // 200 on success; 500 if Open-Meteo is unreachable in the test environment
    expect([200, 500]).toContain(response.status())
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })

  test('get-weather returns an error response when coordinates are missing', async ({ request }) => {
    const url = edgeFunctionUrl('get-weather')

    const response = await request.post(url, {
      headers: authHeaders(),
      data: {},
    })

    // Function throws when lat/lon are absent, resulting in 500
    expect(response.status()).toBe(500)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  // --------------------------------------------------------------------------
  // get-compliance-statistics
  // --------------------------------------------------------------------------
  test('get-compliance-statistics returns a JSON response', async ({ request }) => {
    const url = edgeFunctionUrl('get-compliance-statistics')

    const response = await request.post(url, {
      headers: authHeaders(),
      data: {},
    })

    // 200 on success; 401/403 if the anon key lacks access; 500 on DB errors
    expect([200, 401, 403, 500]).toContain(response.status())
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).not.toBeNull()
    expect(typeof body).toBe('object')
  })
})
