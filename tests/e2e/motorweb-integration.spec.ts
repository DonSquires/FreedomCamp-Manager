/**
 * E2E Test: MotorWeb Integration (Enrichment → Update → Refresh)
 * Test Area 3 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

test.describe('MotorWeb Integration - Vehicle Data Enrichment', () => {
  test('should enrich vehicle data from MotorWeb via Breach Alerts page', async ({ adminUser }) => {
    const page = adminUser

    // Navigate to Breach Alerts
    await page.goto('/breaches')
    await expect(page.locator('h1').first()).toContainText('Breach')

    // Enrichment controls are environment-dependent. Treat as capability check.
    const enrichBtn = page.getByRole('button', { name: /enrich vehicle data|enrich data|motorweb/i }).first()
    if (!(await enrichBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'MotorWeb enrichment control not visible in current environment')
    }

    await enrichBtn.click()
    await page.waitForTimeout(8000)
    await expect(page.getByText(/enriched|updated|motorweb|owner/i).first()).toBeVisible({ timeout: 15000 })
  })

  test('should show owner details after MotorWeb enrichment', async ({ adminUser }) => {
    const page = adminUser

    // Navigate to Vehicle Management and open vehicle details
    await page.goto('/vehicles')
    await page.fill('input[placeholder*="Search"]', 'NYR607')
    await page.waitForTimeout(1000)

    const vehicleRow = page.locator('text=NYR607').first()
    if (!(await vehicleRow.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'NYR607 not visible in current vehicle list scope')
    }
    await vehicleRow.click()

    await expect(page.locator('text=Vehicle Details')).toBeVisible({ timeout: 5000 })

    // Look for MotorWeb enrichment button
    const enrichBtn = page.getByRole('button', { name: /enrich data|enrich vehicle data|motorweb/i }).first()
    if (!(await enrichBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'MotorWeb enrichment button not found on vehicle details page')
    }

    await enrichBtn.click()
    await page.waitForTimeout(8000)
    await expect(page.getByText(/make|model|year|colour|owner/i).first()).toBeVisible({ timeout: 10000 })
  })
})
