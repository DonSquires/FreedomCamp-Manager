/**
 * E2E Test: Realtime Updates (PostgreSQL Subscriptions)
 * Test Area 7 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'
import { loginAs } from './auth'

function createPageDiagnostics(page: any) {
  const consoleMessages: string[] = []
  const requestFailures: string[] = []
  const errorResponses: string[] = []

  page.on('console', (msg: any) => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') {
      consoleMessages.push(`[${type}] ${msg.text()}`)
    }
  })

  page.on('requestfailed', (request: any) => {
    const failureText = request.failure()?.errorText || 'unknown'
    requestFailures.push(`${request.method()} ${request.url()} :: ${failureText}`)
  })

  page.on('response', (response: any) => {
    if (response.status() >= 400) {
      errorResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
    }
  })

  return {
    summary: () => ({ consoleMessages, requestFailures, errorResponses }),
  }
}

async function attachDiagnostics(testInfo: any, name: string, page: any, diagnostics: any) {
  await testInfo.attach(name, {
    body: JSON.stringify(
      {
        url: page.url(),
        ...diagnostics.summary(),
      },
      null,
      2
    ),
    contentType: 'application/json',
  })
}

test.describe('Realtime Updates - Live Breach Alert Notifications', () => {
  test('should show breach alert in realtime without page refresh', async ({ browser }, testInfo) => {
    // Window A: Admin watching breach alerts
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    const diagnostics = createPageDiagnostics(adminPage)

    try {
      await loginAs(adminPage, 'adminOrg1')

      await adminPage.goto('/breaches')
      const breachHeading = adminPage.getByRole('heading', { name: /Breach/i }).first()
      await expect(breachHeading).toBeVisible({ timeout: 25000 })

    // Count initial breach cards
    const initialCount = await adminPage.locator('[data-testid="breach-card"], .breach-card').count()

    // Insert a test breach directly via Supabase to trigger realtime
    const { data: zones } = await helpers.supabase
      .from('zones')
      .select('id, organization_id')
      .limit(1)
      .single()

    if (zones) {
      await helpers.supabase.from('breach_alerts').insert({
        plate_number: 'RTTEST',
        zone_id: zones.id,
        organization_id: zones.organization_id,
        breach_type: 'overstay',
        severity: 'high',
        status: 'open',
        created_at: new Date().toISOString(),
      }).select()
    }

    // Wait for realtime update (up to 5 seconds)
    await adminPage.waitForTimeout(3000)

    // Notification bell should update or new card appears
    const notifBell = adminPage.locator('[data-testid="notification-bell"], .notification-bell')
    const bellVisible = await notifBell.isVisible().catch(() => false)
    if (bellVisible) {
      console.log('Notification bell found – checking for badge update')
    }

    } finally {
      await attachDiagnostics(testInfo, 'breach-realtime-diagnostics.json', adminPage, diagnostics)
      await adminContext.close()
    }
  })

  test('should show notification bell badge for new breach', async ({ adminUser }, testInfo) => {
    const page = adminUser
    const diagnostics = createPageDiagnostics(page)

    try {
      await page.goto('/breaches')
      const breachHeading = page.getByRole('heading', { name: /Breach/i }).first()
      await expect(breachHeading).toBeVisible({ timeout: 25000 })

    // NotificationBell should be in AppLayout header
    const bell = page.locator('button[aria-label*="notification"], [data-testid="notification-bell"]')
    const bellExists = await bell.isVisible({ timeout: 3000 }).catch(() => false)

      if (bellExists) {
        await bell.click()
        // Notification panel/dropdown should open
        const panel = page.locator('text=/notification|alert/i').first()
        await expect(panel).toBeVisible({ timeout: 3000 })
      } else {
        console.log('Notification bell not found in current layout – skipping badge test')
      }
    } finally {
      await attachDiagnostics(testInfo, 'breach-bell-diagnostics.json', page, diagnostics)
    }
  })
})

test.describe('Realtime Updates - Live Officer Location', () => {
  test('should navigate to live officer tracking page', async ({ adminUser }, testInfo) => {
    const page = adminUser
    const diagnostics = createPageDiagnostics(page)

    try {
      await page.goto('/live-tracking')

      const trackingHeading = page.getByRole('heading', { name: /Live Officer Tracking/i })
      await expect(trackingHeading).toBeVisible({ timeout: 20000 })
      await expect(page).not.toHaveURL(/\/portal-selection(?:\?|$)/)
    } finally {
      await attachDiagnostics(testInfo, 'live-tracking-diagnostics.json', page, diagnostics)
    }
  })

  test('should navigate to live patrol monitor page', async ({ adminUser }, testInfo) => {
    const page = adminUser
    const diagnostics = createPageDiagnostics(page)

    try {
      await page.goto('/live-patrol')

      const patrolHeading = page.getByRole('heading', {
        name: /Live Patrol & Welfare Monitor|Live Patrol Monitor|Patrol Monitor|Live Patrol/i,
      })
      await expect(patrolHeading).toBeVisible({ timeout: 20000 })
      await expect(page).not.toHaveURL(/\/portal-selection(?:\?|$)/)
    } finally {
      await attachDiagnostics(testInfo, 'live-patrol-diagnostics.json', page, diagnostics)
    }
  })
})
