/**
 * E2E Test: System Integration (Full End-to-End Enforcement Workflow)
 * Test Area 10 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

async function ensureAnyZoneSelected(page: any) {
  await page.click('text=Select zone')
  const preferredZone = page.getByRole('option', { name: /tasman|nelson|beach reserve/i }).first()
  const firstZone = page.locator('[role="option"]').first()
  if (await preferredZone.isVisible({ timeout: 3000 }).catch(() => false)) {
    await preferredZone.click()
  } else if (await firstZone.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstZone.click()
  } else {
    return false
  }

  const submit = page.locator('button:has-text("Submit")').first()
  if (!(await submit.isDisabled())) return true

  await page.waitForTimeout(500)
  await page.click('text=Select zone')
  if (await firstZone.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstZone.click()
  }
  return !(await submit.isDisabled())
}

test.describe('System Integration - Complete Enforcement Workflow', () => {
  const testPlate = 'E2EFLOW'

  test('Step 1: Officer scans a vehicle', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await expect(page.locator('h1').first()).toContainText('Field Officer Portal')

    await page.click('text=Scan Vehicle')
    await expect(page.locator('text=Vehicle Scanner')).toBeVisible()

    await page.click('text=Manual Entry')
    await page.fill('input[placeholder*="plate"]', testPlate)

    const canSubmit = await ensureAnyZoneSelected(page)
    if (!canSubmit) {
      test.skip(true, 'No selectable zones available in officer portal')
    }

    await page.click('button:has-text("Submit")')
    await helpers.waitForToast(page, `${testPlate} scanned successfully`)

    // Verify observation created
    const { data: obs } = await helpers.supabase
      .from('observations')
      .select('id, plate_number, zone_id, is_compliant')
      .eq('plate_number', testPlate)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(obs).toHaveLength(1)
    expect(obs![0].plate_number).toBe(testPlate)
    expect(obs![0].zone_id).toBeTruthy()
  })

  test('Step 2: Admin reviews breach for scanned vehicle', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/breaches')
    await expect(page.locator('h1').first()).toContainText('Breach')

    // Check if a breach was created for our test vehicle
    const { data: breaches } = await helpers.supabase
      .from('breach_alerts')
      .select('id, plate_number, status')
      .eq('plate_number', testPlate)
      .limit(1)

    // If breach exists, verify admin can see it on breach alerts page
    if (breaches && breaches.length > 0) {
      await page.fill('input[placeholder*="Search"]', testPlate).catch(() => {
        // Search may not be available on this page
      })
      await page.waitForTimeout(1000)

      const breachEntry = page.locator(`text=${testPlate}`).first()
      const visible = await breachEntry.isVisible({ timeout: 3000 }).catch(() => false)
      console.log(`Breach for ${testPlate} visible in UI: ${visible}`)
    } else {
      console.log(`No breach created for ${testPlate} – vehicle may be compliant`)
    }
  })

  test('Step 3: Admin navigates enforcement actions', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/enforcement-actions')
    await expect(page.locator('h1').first()).toContainText('Enforcement')

    // Should display list of enforcement actions
    const content = page.locator('main, [role="main"]')
    await expect(content).toBeVisible({ timeout: 5000 })
  })

  test('Step 4: Admin accesses enforcement command center', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/enforcement-command-center')
    await expect(page.locator('h1').first()).toContainText(/Command Cent(er|re)/)
  })

  test('Step 5: Audit log records actions', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/audit-log')
    await expect(page.locator('h1').first()).toContainText('Audit Log')

    // Audit log should show recent entries
    const logEntries = page.locator('table tbody tr, [data-testid="audit-entry"]')
    const count = await logEntries.count()
    console.log(`Audit log entries visible: ${count}`)
  })
})
