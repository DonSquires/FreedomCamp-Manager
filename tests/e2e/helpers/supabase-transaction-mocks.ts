import type { Page, Route } from '@playwright/test'

export type SupabaseMockState = {
  restHits: number
  authHits: number
  functionHits: number
}

type MockResponse = {
  status: number
  contentType: string
  body: string
}

function jsonResponse(body: unknown, status = 200): MockResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

function buildAuthTokenResponse() {
  const now = Math.floor(Date.now() / 1000)

  return {
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'mock-refresh-token',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'mock.user@onspace.ai',
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  }
}

function buildAuthUserResponse() {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'mock.user@onspace.ai',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  }
}

async function fulfillFromPath(route: Route, state: SupabaseMockState): Promise<void> {
  const request = route.request()
  const method = request.method()
  const url = new URL(request.url())
  const pathname = url.pathname

  if (method === 'OPTIONS') {
    await route.fulfill(jsonResponse({ ok: true }))
    return
  }

  if (pathname.includes('/auth/v1/')) {
    state.authHits += 1

    if (pathname.endsWith('/auth/v1/token')) {
      await route.fulfill(jsonResponse(buildAuthTokenResponse()))
      return
    }

    if (pathname.endsWith('/auth/v1/user')) {
      await route.fulfill(jsonResponse(buildAuthUserResponse()))
      return
    }

    await route.fulfill(jsonResponse({ ok: true }))
    return
  }

  if (pathname.includes('/functions/v1/')) {
    state.functionHits += 1
    await route.fulfill(jsonResponse({ mocked: true, status: 'ok' }))
    return
  }

  if (pathname.includes('/rest/v1/')) {
    state.restHits += 1

    // The Supabase PostgREST API commonly returns arrays for select queries.
    if (method === 'GET' || method === 'HEAD') {
      await route.fulfill(jsonResponse([]))
      return
    }

    await route.fulfill(jsonResponse([]))
    return
  }

  await route.continue()
}

export async function installSupabaseTransactionMocks(page: Page): Promise<SupabaseMockState> {
  const state: SupabaseMockState = {
    restHits: 0,
    authHits: 0,
    functionHits: 0,
  }

  await page.context().route('**/auth/v1/**', async (route) => {
    await fulfillFromPath(route, state)
  })

  await page.context().route('**/rest/v1/**', async (route) => {
    await fulfillFromPath(route, state)
  })

  await page.context().route('**/functions/v1/**', async (route) => {
    await fulfillFromPath(route, state)
  })

  return state
}
