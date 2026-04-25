import { test, expect } from '@playwright/test'
import { getTestUser } from './auth'

function getSupabaseUrl(): string {
  const candidates = [
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
  ]

  for (const candidate of candidates) {
    const base = (candidate || '').trim().replace(/^['"]|['"]$/g, '')
    if (/^https?:\/\//i.test(base)) {
      return base.replace(/\/$/, '')
    }
  }

  throw new Error('VITE_SUPABASE_URL or SUPABASE_URL is required for ptt-clips RLS test.')
}

function getAnonKey(): string {
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!anonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required for ptt-clips RLS test.')
  }
  return anonKey
}

async function loginOfficer(): Promise<string> {
  const { email, password } = getTestUser('officerOrg1')
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const payload = await response.json() as { access_token?: string; error_description?: string }
  expect(response.ok, payload.error_description || 'officer login should succeed').toBeTruthy()
  expect(typeof payload.access_token).toBe('string')
  return payload.access_token as string
}

async function fetchOfficerProfile(accessToken: string) {
  const baseUrl = getSupabaseUrl()
  const anonKey = getAnonKey()

  const meRes = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const me = await meRes.json() as { id?: string }
  expect(meRes.ok).toBeTruthy()
  expect(me.id).toBeTruthy()

  const profileRes = await fetch(
    `${baseUrl}/rest/v1/user_profiles?select=id,organization_id,employer_organization_id,authorized_work_locations,extra_organization_ids&id=eq.${me.id}&limit=1`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )
  const profiles = await profileRes.json() as Array<{
    id: string
    organization_id?: string | null
    employer_organization_id?: string | null
    authorized_work_locations?: string[] | null
    extra_organization_ids?: string[] | null
  }>
  expect(profileRes.ok).toBeTruthy()
  expect(profiles[0]?.id).toBeTruthy()
  return profiles[0]
}

async function fetchForeignOrgId(accessToken: string, excludedOrgIds: string[]): Promise<string> {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/organizations?select=id&order=name.asc&limit=50`, {
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const orgs = await response.json() as Array<{ id: string }>
  expect(response.ok).toBeTruthy()

  const foreignOrg = orgs.find((org) => org.id && !excludedOrgIds.includes(org.id))
  expect(foreignOrg?.id).toBeTruthy()
  return foreignOrg!.id
}

async function uploadClip(accessToken: string, path: string) {
  return fetch(`${getSupabaseUrl()}/storage/v1/object/ptt-clips/${path}`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'audio/webm',
      'x-upsert': 'false',
    },
    body: Buffer.from('RIFF____WEBPTESTWEBM'),
  })
}

test.describe('PTT clips storage isolation', () => {
  test('officer can upload within allowed org path but not a foreign org path', async () => {
    const accessToken = await loginOfficer()
    const profile = await fetchOfficerProfile(accessToken)

    const allowedOrgIds = Array.from(new Set([
      profile.organization_id,
      profile.employer_organization_id,
      ...(profile.authorized_work_locations || []),
      ...(profile.extra_organization_ids || []),
    ].filter((value): value is string => !!value)))

    expect(allowedOrgIds.length).toBeGreaterThan(0)

    const ownOrgId = allowedOrgIds[0]
    const foreignOrgId = await fetchForeignOrgId(accessToken, allowedOrgIds)

    const ownPath = `${ownOrgId}/ops/${Date.now()}-own.webm`
    const ownUpload = await uploadClip(accessToken, ownPath)
    expect(ownUpload.ok).toBeTruthy()

    const foreignPath = `${foreignOrgId}/ops/${Date.now()}-foreign.webm`
    const foreignUpload = await uploadClip(accessToken, foreignPath)
    const foreignBody = await foreignUpload.text()

    expect(foreignUpload.ok).toBeFalsy()
    expect([400, 403]).toContain(foreignUpload.status)
    expect(foreignBody.toLowerCase()).toMatch(/unauthorized|row-level security|policy/)
  })
})