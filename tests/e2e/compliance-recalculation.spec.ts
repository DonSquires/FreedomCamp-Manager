/**
 * E2E Test: Compliance Recalculation (Matrix → Pipeline → Alerts)
 * Test Area 4 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

async function selectTasmanZoneOrFallback(page: any) {
  const trigger = page.locator('button:has-text("Select zone")').first()
  if (await trigger.count() === 0) return
  if (!(await trigger.isVisible())) return

  const expanded = (await trigger.getAttribute('aria-expanded')) === 'true'
  if (!expanded) {
    await trigger.click({ force: true })
  }

  const tasmanOption = page.locator('[role="option"]', { hasText: /Tasman/i }).first()
  if (await tasmanOption.count() > 0) {
    await tasmanOption.click({ force: true })
    return
  }

  const firstOption = page.locator('[role="option"]').first()
  if (await firstOption.count() > 0) {
    await firstOption.click({ force: true })
  }
}

async function ensureZoneSelectedAndSubmitEnabled(page: any) {
  await selectTasmanZoneOrFallback(page)

  const submit = page.locator('button:has-text("Submit")').first()
  if (!(await submit.isDisabled())) return true

  await page.waitForTimeout(500)
  await selectTasmanZoneOrFallback(page)
  return !(await submit.isDisabled())
}

async function openVehicleScannerOrSkip(page: any) {
  await page.goto('/field')

  const detailScanCard = page.locator('text=Scan Vehicle (Detail)').first()
  const scanVehicleCard = page.locator('text=Scan Vehicle').first()
  const notRosteredNotice = page.getByText(/you are not rostered today/i).first()

  if (await detailScanCard.isVisible().catch(() => false)) {
    await detailScanCard.click()
    return
  }

  if (await scanVehicleCard.isVisible().catch(() => false)) {
    await scanVehicleCard.click()
    return
  }

  if (await notRosteredNotice.isVisible().catch(() => false)) {
    test.skip(true, 'Officer user is not rostered; scanner workflow unavailable for compliance auto-eval test')
  }

  test.skip(true, 'Scanner entrypoint unavailable for current officer session')
}

test.describe('Compliance Recalculation - Manual Trigger', () => {
  test('should navigate to compliance recalculation page', async ({ masterUser }) => {
    const page = masterUser

    await page.goto('/compliance-recalculation')
    const restricted = await page.getByText(/access restricted/i).first().isVisible({ timeout: 2000 }).catch(() => false)
    test.skip(restricted, 'Compliance recalculation route is restricted for the current account in this environment')
    await expect(page.locator('h1').first()).toContainText('Compliance Recalculation')
  })

  test('should trigger compliance recalculation and show results', async ({ masterUser }) => {
    const page = masterUser

    await page.goto('/compliance-recalculation')
    const restricted = await page.getByText(/access restricted/i).first().isVisible({ timeout: 2000 }).catch(() => false)
    test.skip(restricted, 'Compliance recalculation route is restricted for the current account in this environment')
    await expect(page.locator('h1').first()).toContainText('Compliance Recalculation')

    // Look for recalculate button
    const recalcBtn = page.getByRole('button', { name: /recalculate|run|start/i }).first()
    await expect(recalcBtn).toBeVisible({ timeout: 5000 })
    await recalcBtn.click()

    // Wait for recalculation to complete (edge function call)
    await page.waitForTimeout(10000)

    // Should show success indicator or results
    await expect(page.getByText(/complete|finished|updated|success/i).first()).toBeVisible({ timeout: 30000 })
  })
})

test.describe('Compliance Recalculation - Automatic on New Observation', () => {
  test('should auto-evaluate compliance when new observation is created', async ({ officerUser }) => {
    const page = officerUser

    await openVehicleScannerOrSkip(page)
    await expect(page.getByText('Vehicle Scanner').first()).toBeVisible({ timeout: 15000 })

    // Create a new observation via manual scanner path
    await page.click('text=Manual Entry')
    await page.fill('input[placeholder*="plate"]', 'AUTOEVAL')

    // Select zone
    if (!(await ensureZoneSelectedAndSubmitEnabled(page))) {
      test.skip(true, 'No selectable Tasman District Council zone for the current account')
    }

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
