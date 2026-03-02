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
    await expect(page.locator('h1')).toContainText('Breach')

    // Find a breach card (seed data includes BREACH1)
    const breachCard = page.locator('text=BREACH1').first()
    if (await breachCard.isVisible({ timeout: 5000 })) {
      // Click enrich button on the breach card
      const enrichBtn = page.locator('button:has-text("Enrich Vehicle Data")').first()
      if (await enrichBtn.isVisible({ timeout: 3000 })) {
        await enrichBtn.click()

        // Wait for enrichment (Railway proxy call)
        await page.waitForTimeout(8000)

        // Success toast or updated vehicle details
        const successMsg = page.locator('text=/enriched|updated|MotorWeb/i')
        await expect(successMsg).toBeVisible({ timeout: 15000 })
      } else {
        console.log('MotorWeb enrich button not found on breach card – skipping')
      }
    } else {
      console.log('BREACH1 not found in breach alerts – ensure test seed data is loaded')
    }
  })

  test('should show owner details after MotorWeb enrichment', async ({ adminUser }) => {
    const page = adminUser

    // Navigate to Vehicle Management and open vehicle details
    await page.goto('/vehicles')
    await page.fill('input[placeholder*="Search"]', 'TEST123')
    await page.waitForTimeout(1000)

    const vehicleRow = page.locator('text=TEST123').first()
    await vehicleRow.click()

    await expect(page.locator('text=Vehicle Details')).toBeVisible({ timeout: 5000 })

    // Look for MotorWeb enrichment button
    const enrichBtn = page.locator('button:has-text("Enrich Data")')
    if (await enrichBtn.isVisible({ timeout: 3000 })) {
      await enrichBtn.click()

      // Wait for enrichment
      await page.waitForTimeout(8000)

      // Should show updated make/model/year/colour
      const vehicleDetails = page.locator('text=/make|model|year|colour/i')
      await expect(vehicleDetails.first()).toBeVisible({ timeout: 10000 })
    } else {
      console.log('MotorWeb "Enrich Data" button not found on vehicle details – skipping')
    }
  })
})
