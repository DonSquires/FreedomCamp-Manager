import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertNavPathHidden, assertRouteBlocked, assertRouteLoads } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

const sharedFallbackMode = process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK === '1'

async function assertSpoofedOrgGuarded(page: any, spoofedOrgId: string) {
  const redirectedAway = !page.url().includes(spoofedOrgId)
  if (redirectedAway) return

  const deniedHeading = page.getByRole('heading', { name: /access restricted|forbidden|unauthorized|not found/i })
  const deniedText = page.locator('text=/access.*denied|not.*authorized|forbidden|not found|no access|permission denied/i').first()

  const deniedByHeading = await deniedHeading.isVisible({ timeout: 2500 }).catch(() => false)
  const deniedByText = await deniedText.isVisible({ timeout: 2500 }).catch(() => false)

  expect(deniedByHeading || deniedByText).toBeTruthy()
}

test.describe('org isolation – CRM parameterised routes', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(sharedFallbackMode, 'Shared fallback account cannot prove spoofed-org isolation deterministically.')

  const spoofedOrgId = '00000000-0000-0000-0000-000000000001'

  test('admin cannot access /crm/client/:spoofedOrgId from another org', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto(`/crm/client/${spoofedOrgId}`, { waitUntil: 'networkidle' })
    await assertSpoofedOrgGuarded(page, spoofedOrgId)
  })

  test('admin cannot access /crm/contractor/:spoofedOrgId from another org', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto(`/crm/contractor/${spoofedOrgId}`, { waitUntil: 'networkidle' })
    await assertSpoofedOrgGuarded(page, spoofedOrgId)
  })

  test('officer cannot access /crm/client/:spoofedOrgId', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto(`/crm/client/${spoofedOrgId}`, { waitUntil: 'networkidle' })
    await assertSpoofedOrgGuarded(page, spoofedOrgId)
  })

  test('master cannot access /crm/client/:spoofedOrgId outside assigned orgs', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto(`/crm/client/${spoofedOrgId}`, { waitUntil: 'networkidle' })
    await assertSpoofedOrgGuarded(page, spoofedOrgId)
  })

  test('master cannot access /crm/contractor/:spoofedOrgId outside assigned orgs', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto(`/crm/contractor/${spoofedOrgId}`, { waitUntil: 'networkidle' })
    await assertSpoofedOrgGuarded(page, spoofedOrgId)
  })
})

test.describe('cross-org matrix regression checks', () => {
  test.describe.configure({ mode: 'serial' })

  for (const [user, route] of [
    ['adminOrg1', '/grandmaster-code-studio'],
    ['adminOrg1', '/compliance-escalations'],
    ['master', '/grandmaster-code-studio'],
    ['master', '/compliance-escalations'],
  ] as const) {
    test(`${user} is BLOCKED from ${route}`, async ({ page }) => {
      test.skip(sharedFallbackMode && user === 'master', 'Shared fallback account cannot guarantee master-only route restrictions.')
      await loginAs(page, user)
      await assertRouteBlocked(page, route)
    })
  }
})

test.describe('route/menu parity assertions', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin does not see internal tools link and is blocked from route', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await assertNavPathHidden(page, '/compliance-recalculation')
    await assertRouteBlocked(page, '/compliance-recalculation')
  })

  test('master can load internal tools route', async ({ page }, testInfo) => {
    test.skip(sharedFallbackMode, 'Shared fallback account cannot guarantee master-only internal tools coverage.')
    await loginAs(page, 'master')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    await assertRouteLoads(page, '/compliance-recalculation')
    await bobAssessPage(page, testInfo, 'master-route-menu-parity-internal-tools')
  })

  test('officer does not see users link and is blocked from route', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/officer-home', { waitUntil: 'domcontentloaded' })
    await assertNavPathHidden(page, '/users')
    await assertRouteBlocked(page, '/users')
  })
})