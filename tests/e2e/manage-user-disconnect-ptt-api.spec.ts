import { test, expect } from '@playwright/test'
import { getTestUser } from './auth'

const DEFAULT_SUPABASE_URL = 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'

function getSupabaseUrl(): string {
  const candidates = [
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
    DEFAULT_SUPABASE_URL,
  ]

  for (const candidate of candidates) {
    const value = (candidate || '').trim().replace(/^['"]|['"]$/g, '')
    if (/^https?:\/\//i.test(value)) {
      return value.replace(/\/$/, '')
    }
  }

  throw new Error('Unable to resolve Supabase URL for manage-user disconnect_ptt test.')
}

function getAnonKey(): string {
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!anonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required for manage-user disconnect_ptt test.')
  }
  return anonKey
}

async function loginMasterAccessToken(): Promise<string> {
  const { email, password } = getTestUser('master')
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const payload = await response.json() as { access_token?: string; error_description?: string }
  expect(response.ok, payload.error_description || 'master login should succeed').toBeTruthy()
  expect(typeof payload.access_token).toBe('string')
  return payload.access_token as string
}

async function resolveTargetUserId(accessToken: string): Promise<string> {
  const baseUrl = getSupabaseUrl()
  const anonKey = getAnonKey()

  const meResponse = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const me = await meResponse.json() as { id?: string }
  expect(meResponse.ok).toBeTruthy()
  expect(me.id).toBeTruthy()

  const usersResponse = await fetch(
    `${baseUrl}/rest/v1/user_profiles?select=id,is_active&is_active=eq.true&id=neq.${me.id}&limit=10`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  const users = await usersResponse.json() as Array<{ id: string; is_active: boolean }>
  expect(usersResponse.ok).toBeTruthy()

  const target = users.find((u) => !!u.id)
  expect(target?.id).toBeTruthy()
  return target!.id
}

async function fetchUserActiveFlag(accessToken: string, userId: string): Promise<boolean> {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/user_profiles?select=id,is_active&id=eq.${userId}&limit=1`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  const profiles = await response.json() as Array<{ id: string; is_active: boolean }>
  expect(response.ok).toBeTruthy()
  expect(profiles[0]?.id).toBe(userId)
  return !!profiles[0]?.is_active
}

test.describe('manage-user disconnect_ptt action', () => {
  test('master can request PTT disconnect without deactivating user', async () => {
    const accessToken = await loginMasterAccessToken()
    const targetUserId = await resolveTargetUserId(accessToken)
    const wasActiveBefore = await fetchUserActiveFlag(accessToken, targetUserId)
    expect(wasActiveBefore).toBe(true)

    const response = await fetch(`${getSupabaseUrl()}/functions/v1/manage-user`, {
      method: 'POST',
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'disconnect_ptt',
        userId: targetUserId,
      }),
    })

    const payload = await response.json() as {
      ok?: boolean
      message?: string
      error?: string
      data?: {
        id?: string
      }
      pttRevoke?: {
        attempted?: boolean
        ok?: boolean
        status?: number
        message?: string
      }
    }

    expect(response.ok, payload.error || 'disconnect_ptt request should succeed').toBeTruthy()
    expect(payload.ok).toBe(true)

    const hasNewContractMessage =
      typeof payload.message === 'string' && /PTT disconnect requested/i.test(payload.message)
    const hasLegacyContractData = payload.data?.id === targetUserId

    expect(hasNewContractMessage || hasLegacyContractData).toBe(true)

    if (payload.pttRevoke) {
      expect(typeof payload.pttRevoke.ok).toBe('boolean')
    }

    const isActiveAfter = await fetchUserActiveFlag(accessToken, targetUserId)
    expect(isActiveAfter).toBe(true)
  })
})
