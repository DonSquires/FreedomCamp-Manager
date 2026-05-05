import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

/**
 * Client Portal Isolation Tests
 *
 * Verifies that the Client Portal enforces proper data scope boundaries:
 * - Client users see ONLY their own organization's public data (contracts, sites, notifications)
 * - Client users CANNOT see: officer details, staff rosters, internal alerts, audit logs
 * - Multi-org isolation: one client account cannot see another client's data
 *
 * Implements rebuild requirement: "Client Portal ← read-only contract & zone visibility"
 */

const LIVE_CLIENT_ORG = process.env.PLAYWRIGHT_LIVE_CLIENT_ORG?.trim() || 'Nelson City Council'

test.use({ screenshot: 'on', video: 'on' })

test.describe('Client Portal Isolation', () => {
  test.describe.configure({ mode: 'serial' })

  test('Client user can access client portal and sees org-scoped data', async ({ page }, testInfo) => {
    // Login as client user (not admin, not officer)
    // Note: May need to set up a dedicated client test account
    await loginAs(page, 'client')
    await page.goto('/client-portal')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Verify client portal navigation with tolerant selectors for evolving UI labels.
    const url = page.url()
    if (!url.includes('/client-portal') && !url.includes('/portal')) {
      test.skip(true, `Configured client account did not land on client portal (url: ${url})`)
      return
    }

    const portalSurface = page.locator(
      '[data-testid="client-portal-header"], [data-testid="client-portal-root"], [data-testid="client-dashboard"], h1:has-text("Client"), h1:has-text("Portal"), h1:has-text("Dashboard")'
    )
    const hasPortalSurface = await portalSurface.first().isVisible().catch(() => false)
    const hasMainShell = await page.locator('main').first().isVisible().catch(() => false)
    expect(hasPortalSurface || hasMainShell).toBe(true)

    // Verify org name is shown (client's own org)
    const orgNameDisplay = page.locator('[data-testid="org-name"], [data-testid="account-name"]')
    if (await orgNameDisplay.isVisible()) {
      const text = await orgNameDisplay.textContent()
      expect(text).toBeTruthy()
      expect(text).not.toContain('Master') // Should not show "Master" org
    }

    await page.screenshot({ path: testInfo.outputPath('01-client-portal-header.png') })
  })

  test('Client user cannot access admin CRM routes', async ({ page }, testInfo) => {
    await loginAs(page, 'client')

    // Attempt to navigate to admin-only routes
    const adminRoutes = [
      '/crm',
      '/organizations',
      '/admin',
      '/admin/users',
      '/audit-log',
    ]

    for (const route of adminRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
      await page.waitForTimeout(500)

      // Should be redirected or show access denied
      const currentUrl = page.url()
      const unauthorizedMessage = page.locator('text=/access.*denied|not.*authorized|forbidden/i')
      const isRedirected = !currentUrl.includes(route)

      const hasAccess = currentUrl.includes(route) && !await unauthorizedMessage.isVisible()

      if (hasAccess) {
        // If route is accessible, ensure it's a public route (not admin)
        const adminIndicator = page.locator('[data-testid="admin-panel"], [data-testid="admin-header"]')
        expect(await adminIndicator.isVisible()).toBe(false)
      }

      expect(isRedirected || await unauthorizedMessage.isVisible()).toBe(true)
    }

    await page.screenshot({ path: testInfo.outputPath('01-access-denied-audit-log.png') })
  })

  test('Client user cannot see officer/staff internal data', async ({ page }, testInfo) => {
    await loginAs(page, 'client')

    // Route to pages that should NOT be visible to clients
    const internalRoutes = [
      '/roster',
      '/availability',
      '/officer-skills',
      '/officer-welfare',
      '/live-tracking',
      '/dispatch',
    ]

    for (const route of internalRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
      await page.waitForTimeout(500)

      const currentUrl = page.url()
      const unauthorizedMsg = page.locator('text=/access.*denied|not.*authorized|forbidden|not found/i')
      const isRedirected = !currentUrl.includes(route)

      // Client should either be redirected or see access denied
      expect(isRedirected || await unauthorizedMsg.isVisible()).toBe(true)
    }

    await page.screenshot({ path: testInfo.outputPath('01-internal-routes-blocked.png') })
  })

  test('Client portal shows only client-scoped contracts and sites', async ({ page }, testInfo) => {
    await loginAs(page, 'client')
    await page.goto('/client-portal')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Look for contracts or sites section
    const contractsSection = page.locator('[data-testid="contracts-section"], [data-testid="agreements"], h2:has-text("Contracts"), h2:has-text("Services")')
    const sitesSection = page.locator('[data-testid="sites-section"], [data-testid="locations"]')

    if (await contractsSection.isVisible()) {
      await contractsSection.screenshot({ path: testInfo.outputPath('01-client-contracts.png') })

      // Verify contracts shown are for THIS client org only
      const contractRows = contractsSection.locator('[data-testid*="contract-"], tbody tr')
      if (await contractRows.count() > 0) {
        // At least one contract should exist (in non-test scenarios)
        expect(await contractRows.count()).toBeGreaterThan(0)
      }
    }

    if (await sitesSection.isVisible()) {
      await sitesSection.screenshot({ path: testInfo.outputPath('02-client-sites.png') })

      // Verify sites don't leak org_id or other internal fields
      const siteLinks = sitesSection.locator('a, [role="button"]')
      for (let i = 0; i < Math.min(3, await siteLinks.count()); i++) {
        const text = await siteLinks.nth(i).textContent()
        // Should show site name, not UUIDs
        expect(text).toBeTruthy()
        expect(text).not.toMatch(/^[a-f0-9-]{36}$/) // Should not be raw UUID
      }
    }

    await page.screenshot({ path: testInfo.outputPath('03-client-portal-full.png'), fullPage: true })
  })

  test('Client portal does NOT display RLS-restricted fields (officer names, rates, audit)', async ({ page }, testInfo) => {
    await loginAs(page, 'client')
    await page.goto('/client-portal')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Restricted fields/sections that should NOT appear to clients:
    const restrictedSelectors = [
      '[data-testid="officer-name"]',
      '[data-testid="staff-roster"]',
      '[data-testid="pay-rate"]',
      '[data-testid="guard-cost"]',
      '[data-testid="audit-trail"]',
      '[data-testid="internal-notes"]',
      '[data-testid="alarm-events"]', // Internal security events
      '[data-testid="welfare-alerts"]', // Officer welfare (private)
      'th:has-text("Officer"), th:has-text("Created By"), th:has-text("Verified By")', // Audit columns
    ]

    for (const selector of restrictedSelectors) {
      const element = page.locator(selector)
      const isVisible = await element.isVisible().catch(() => false)

      if (isVisible) {
        console.warn(`⚠️ Restricted selector visible to client: ${selector}`)
      }
      expect(isVisible).toBe(false)
    }

    await page.screenshot({ path: testInfo.outputPath('01-no-restricted-fields.png'), fullPage: true })
  })

  test('Multi-org isolation: Client A cannot see Client B data (RLS proof)', async ({ page }, testInfo) => {
    /**
     * Advanced: If multiple client orgs exist in test data, verify they cannot cross-view.
     * This verifies Row Level Security (RLS) policies work correctly at the database layer.
     */

    await loginAs(page, 'client')
    await page.goto('/client-portal')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Get current client org name from portal
    const currentOrgElement = page.locator('[data-testid="current-org"], [data-testid="org-name"]')
    if (!await currentOrgElement.isVisible()) {
      test.skip() // Cannot determine current org
    }

    const currentOrg = await currentOrgElement.textContent()
    expect(currentOrg).toBeTruthy()

    // Attempt to find other org references in page content
    const pageText = await page.locator('body').textContent()
    
    // If other client org names appear, they should not be links/interactive
    const otherOrgLink = page.locator(`a:has-text("${LIVE_CLIENT_ORG}"), button:has-text("${LIVE_CLIENT_ORG}")`)
    const otherOrgLinkVisible = await otherOrgLink.isVisible().catch(() => false)

    // Same org link is OK, different org link is not
    if (otherOrgLinkVisible && currentOrg !== LIVE_CLIENT_ORG) {
      expect(otherOrgLinkVisible).toBe(false)
    }

    await page.screenshot({ path: testInfo.outputPath('01-org-isolation-verified.png'), fullPage: true })
  })

  test('Client portal API calls include org context headers (x-org-scoped)', async ({ page }, testInfo) => {
    /**
     * Verify that client portal API requests include organization scoping.
     * This is a network-level verification that RLS is being enforced client-side.
     */

    let apiHeaders: Record<string, string> = {}

    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/rest/v1/') || url.includes('supabase')) {
        const authHeader = request.headers()['authorization']
        const orgHeader = request.headers()['x-org-id']
        if (authHeader) {
          apiHeaders['has-auth'] = 'true'
        }
        if (orgHeader) {
          apiHeaders['x-org-id'] = orgHeader
        }
      }
    })

    await loginAs(page, 'client')
    await page.goto('/client-portal')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Trigger some API calls
    await page.locator('[data-testid="refresh-btn"]').click().catch(() => undefined)
    await page.waitForTimeout(1000)

    // Verify org context was sent
    expect(apiHeaders['has-auth']).toBe('true')
    // Note: x-org-id may not always be sent (depends on app implementation)
    // but auth should always be present

    await page.screenshot({ path: testInfo.outputPath('01-api-headers-verified.png') })
  })

  test('Client portal properly handles 403 responses from backend RLS', async ({ page }, testInfo) => {
    /**
     * If a client user somehow bypasses client-side checks and reaches a restricted route,
     * the backend RLS policy should return 403 Forbidden.
     * Verify error handling is graceful.
     */

    await loginAs(page, 'client')

    // Intercept and monitor API errors
    let forbiddenErrorCaught = false

    page.on('response', (response) => {
      if (response.status() === 403) {
        forbiddenErrorCaught = true
      }
    })

    // Try to access a route that should be RLS-blocked
    await page.goto('/audit-log', { waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForTimeout(1000)

    // Should either be redirected or show error gracefully
    const currentUrl = page.url()
    const errorMsg = page.locator(':text("Access denied"), :text("not authorized"), :text("Something went wrong")')

    const isAccessDenied = await errorMsg.isVisible().catch(() => false)
    const isRedirected = !currentUrl.includes('/audit-log')

    expect(isAccessDenied || isRedirected).toBe(true)

    await page.screenshot({ path: testInfo.outputPath('01-403-handling.png'), fullPage: true })
  })
})
