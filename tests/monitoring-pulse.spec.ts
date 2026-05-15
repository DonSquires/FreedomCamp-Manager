import { test, expect } from '@playwright/test'

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.VITE_STAGING_URL ||
  'http://localhost:5173'

test.describe('MonitoringHub pulse – enterprise console alarm flow', () => {

  test('enterprise console loads with no alarm border initially', async ({ page }) => {
    await page.goto(`${BASE_URL}/enterprise-console`)
    await page.waitForLoadState('networkidle')

    // The monitoring widget container should exist
    const widget = page.locator('text=Central Monitoring Hub').or(page.locator('text=LIVE ALARM TRIAGE QUEUE'))
    await expect(widget.first()).toBeVisible({ timeout: 8000 })

    // No critical alarms → no red flash border expected at cold start
    const alarmFlash = page.locator('[style*="E61919"]').or(page.locator('[style*="pulse-border"]'))
    await expect(alarmFlash.first()).not.toBeVisible()
  })

  test('alarm badge appears after dispatch webhook fires', async ({ page, request }) => {
    // Fire a simulated dispatch through the monitoring handshake webhook
    await request.post(`${BASE_URL}/api/webhook/monitoring-handshake`, {
      data: {
        alarmType:     'PERIMETER_BREACH',
        locationZone:  'Zone-C-North',
        provider:      'Test Monitoring NZ',
        details:       'Playwright E2E test dispatch event',
      },
    })

    await page.goto(`${BASE_URL}/enterprise-console`)
    await page.waitForLoadState('networkidle')

    // After firing the webhook, the triage queue heading should appear
    const triageHeading = page.locator('text=LIVE ALARM TRIAGE QUEUE')
    await expect(triageHeading).toBeVisible({ timeout: 6000 })
  })

})
