import type { Page } from '@playwright/test'

export type TestUserKey = 'master' | 'adminOrg1' | 'adminOrg2' | 'officerOrg1'

type TestCredentials = {
  email: string
  password: string
}

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim()
    if (value) return value
  }

  return ''
}

function sharedPassword(...names: string[]): string {
  return readEnv(...names) || 'Test123!'
}

const defaultPassword = sharedPassword(
  'PLAYWRIGHT_TEST_PASSWORD',
  'E2E_TEST_PASSWORD',
  'API_TEST_PASSWORD'
)

const defaultLiveEmail = readEnv('PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL', 'API_TEST_EMAIL')
const defaultLivePassword = sharedPassword(
  'PLAYWRIGHT_LIVE_PASSWORD',
  'E2E_LIVE_PASSWORD',
  'API_TEST_PASSWORD',
  'PLAYWRIGHT_TEST_PASSWORD',
  'E2E_TEST_PASSWORD'
)

export const testUsers: Record<TestUserKey, TestCredentials> = {
  master: {
    email: readEnv('PLAYWRIGHT_MASTER_EMAIL', 'E2E_MASTER_EMAIL') || defaultLiveEmail || 'master@test.com',
    password: sharedPassword(
      'PLAYWRIGHT_MASTER_PASSWORD',
      'E2E_MASTER_PASSWORD',
      'PLAYWRIGHT_LIVE_PASSWORD',
      'E2E_LIVE_PASSWORD',
      'API_TEST_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD'
    ) || defaultLivePassword,
  },
  adminOrg1: {
    email: readEnv('PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL', 'PLAYWRIGHT_ADMIN_ORG1_EMAIL') || defaultLiveEmail || 'admin@org1.com',
    password: sharedPassword(
      'PLAYWRIGHT_ADMIN_PASSWORD',
      'E2E_ADMIN_PASSWORD',
      'PLAYWRIGHT_ADMIN_ORG1_PASSWORD',
      'PLAYWRIGHT_LIVE_PASSWORD',
      'E2E_LIVE_PASSWORD',
      'API_TEST_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD'
    ) || defaultLivePassword,
  },
  adminOrg2: {
    email: readEnv('PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'E2E_ADMIN_ORG2_EMAIL') || defaultLiveEmail || 'admin@org2.com',
    password: sharedPassword(
      'PLAYWRIGHT_ADMIN_ORG2_PASSWORD',
      'E2E_ADMIN_ORG2_PASSWORD',
      'PLAYWRIGHT_LIVE_PASSWORD',
      'E2E_LIVE_PASSWORD',
      'API_TEST_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD'
    ) || defaultLivePassword,
  },
  officerOrg1: {
    email: readEnv('PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL', 'PLAYWRIGHT_OFFICER_ORG1_EMAIL') || defaultLiveEmail || 'officer@org1.com',
    password: sharedPassword(
      'PLAYWRIGHT_OFFICER_PASSWORD',
      'E2E_OFFICER_PASSWORD',
      'PLAYWRIGHT_OFFICER_ORG1_PASSWORD',
      'PLAYWRIGHT_LIVE_PASSWORD',
      'E2E_LIVE_PASSWORD',
      'API_TEST_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD'
    ) || defaultLivePassword,
  },
}

export function getTestUser(user: TestUserKey): TestCredentials {
  return testUsers[user]
}

export function getApiTestCredentials(): TestCredentials {
  return {
    email: readEnv('API_TEST_EMAIL', 'PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL'),
    password: readEnv('API_TEST_PASSWORD', 'PLAYWRIGHT_LIVE_PASSWORD', 'E2E_LIVE_PASSWORD'),
  }
}

export function getApiBearerToken(): string | null {
  return readEnv(
    'API_TEST_BEARER_TOKEN',
    'PLAYWRIGHT_LIVE_BEARER_TOKEN',
    'E2E_LIVE_BEARER_TOKEN'
  ) || null
}

async function getAccessTokenFromBrowser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const storages: Storage[] = [window.localStorage, window.sessionStorage]

    for (const storage of storages) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

        const raw = storage.getItem(key)
        if (!raw) continue

        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
            return parsed.access_token
          }
        } catch {
          // ignore malformed storage values
        }
      }
    }

    return null
  })
}

async function ensureWorkAreaPermission(page: Page): Promise<void> {
  const targetOrgName = readEnv('PLAYWRIGHT_WORK_AREA_ORG', 'E2E_WORK_AREA_ORG') || 'Tasman District Council'
  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')

  if (!supabaseUrl || !anonKey) return

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  try {
    const orgRes = await fetch(
      `${supabaseUrl}/rest/v1/organizations?select=id,name&name=ilike.${encodeURIComponent(targetOrgName)}&limit=1`,
      { headers }
    )
    if (!orgRes.ok) return

    const orgRows = await orgRes.json() as Array<{ id: string; name?: string }>
    const targetOrgId = orgRows[0]?.id
    if (!targetOrgId) return

    const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    })
    if (!meRes.ok) return

    const me = await meRes.json() as { id?: string }
    const userId = me.id
    if (!userId) return

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?select=id,authorized_work_locations,extra_organization_ids&id=eq.${userId}&limit=1`,
      { headers }
    )
    if (!profileRes.ok) return

    const profiles = await profileRes.json() as Array<{
      id: string
      authorized_work_locations?: string[]
      extra_organization_ids?: string[]
    }>
    const profile = profiles[0]
    if (!profile?.id) return

    const nextWorkLocations = Array.from(new Set([...(profile.authorized_work_locations || []), targetOrgId]))
    const nextExtraOrgIds = Array.from(new Set([...(profile.extra_organization_ids || []), targetOrgId]))

    await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${profile.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        authorized_work_locations: nextWorkLocations,
        extra_organization_ids: nextExtraOrgIds,
      }),
    })
  } catch {
    // Best-effort only: continue tests even if policy disallows this update.
  }
}

export async function loginAs(page: Page, user: TestUserKey): Promise<void> {
  const credentials = getTestUser(user)

  await page.goto('/login')
  await page.fill('input[type="email"]', credentials.email)
  await page.fill('input[type="password"]', credentials.password)
  await page.click('button[type="submit"]')

  try {
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/login'),
      { timeout: 20000 }
    )
  } catch {
    const errorText = await page.locator('text=/invalid|error|failed/i').first().textContent().catch(() => null)
    const suffix = errorText ? ` Visible message: ${errorText.trim()}` : ''
    throw new Error(`Login failed for ${credentials.email}. Current URL: ${page.url()}.${suffix}`)
  }

  if (user !== 'master') {
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
  }

  // Some roles (for example admin_officer) are redirected to portal selection
  // and must choose a portal before route access is unlocked.
  if (page.url().includes('/portal-selection')) {
    const targetPortalPath = user === 'officerOrg1' ? '/field-officer' : '/admin'
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
    await page.goto(targetPortalPath)
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/portal-selection'),
      { timeout: 20000 }
    )
  }

  // Best-effort: ensure the user can work in the configured council area
  // (defaults to Tasman District Council for location-based test flows).
  await ensureWorkAreaPermission(page)

  await page.waitForLoadState('networkidle').catch(() => undefined)
}