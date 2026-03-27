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

export const testUsers: Record<TestUserKey, TestCredentials> = {
  master: {
    email: readEnv('PLAYWRIGHT_MASTER_EMAIL', 'E2E_MASTER_EMAIL') || 'master@test.com',
    password: sharedPassword(
      'PLAYWRIGHT_MASTER_PASSWORD',
      'E2E_MASTER_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD',
      'API_TEST_PASSWORD'
    ),
  },
  adminOrg1: {
    email: readEnv('PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL', 'PLAYWRIGHT_ADMIN_ORG1_EMAIL') || 'admin@org1.com',
    password: sharedPassword(
      'PLAYWRIGHT_ADMIN_PASSWORD',
      'E2E_ADMIN_PASSWORD',
      'PLAYWRIGHT_ADMIN_ORG1_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD',
      'API_TEST_PASSWORD'
    ),
  },
  adminOrg2: {
    email: readEnv('PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'E2E_ADMIN_ORG2_EMAIL') || 'admin@org2.com',
    password: sharedPassword(
      'PLAYWRIGHT_ADMIN_ORG2_PASSWORD',
      'E2E_ADMIN_ORG2_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD',
      'API_TEST_PASSWORD'
    ),
  },
  officerOrg1: {
    email: readEnv('PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL', 'PLAYWRIGHT_OFFICER_ORG1_EMAIL') || 'officer@org1.com',
    password: sharedPassword(
      'PLAYWRIGHT_OFFICER_PASSWORD',
      'E2E_OFFICER_PASSWORD',
      'PLAYWRIGHT_OFFICER_ORG1_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD',
      'API_TEST_PASSWORD'
    ),
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

  await page.waitForLoadState('networkidle').catch(() => undefined)
}