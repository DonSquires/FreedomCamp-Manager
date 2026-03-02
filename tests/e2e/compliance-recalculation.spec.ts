/**
 * E2E Test: Compliance Recalculation (Matrix → Pipeline → Alerts)
 * Test Area 4 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

test.describe('Compliance Recalculation - Manual Trigger', () => {
  test('should navigate to compliance recalculation page', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/compliance-recalculation')
    await expect(page.locator('h1')).toContainText('Compliance Recalculation')
  })

  test('should trigger compliance recalculation and show results', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/compliance-recalculation')
    await expect(page.locator('h1')).toContainText('Compliance Recalculation')

    // Look for recalculate button
    const recalcBtn = page.locator('button:has-text(/recalculate|run|start/i)').first()
    await expect(recalcBtn).toBeVisible({ timeout: 5000 })
    await recalcBtn.click()

    // Wait for recalculation to complete (edge function call)
    await page.waitForTimeout(10000)

    // Should show success indicator or results
    const result = page.locator('text=/complete|finished|updated|success/i')
    await expect(result).toBeVisible({ timeout: 30000 })
  })
})

test.describe('Compliance Recalculation - Automatic on New Observation', () => {
  test('should auto-evaluate compliance when new observation is created', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await expect(page.locator('h1')).toContainText('Field Officer Portal')

    // Create a new observation via PlateScanner
    await page.click('text=Scan Vehicle')
    await expect(page.locator('text=Vehicle Scanner')).toBeVisible()

    await page.click('text=Manual Entry')
    await page.fill('input[placeholder*="plate"]', 'AUTOEVAL')

    // Select zone
    await page.click('text=Select zone')
    await page.click('text=Beach Reserve')

    await page.click('button:has-text("Submit")')
    await helpers.waitForToast(page, 'scanned successfully')

    // Verify observation created with compliance evaluated
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('id, plate_number, is_compliant')
      .eq('plate_number', 'AUTOEVAL')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    // is_compliant should be set (true or false, not null) after auto-evaluation
    expect(observations![0].is_compliant).not.toBeNull()
  })
})
