import { test, expect, helpers } from './setup'

async function selectZoneIfNeeded(page: any) {
  const trigger = page.locator('button:has-text("Select zone")').first()
  if (!(await trigger.isVisible().catch(() => false))) return

  const expanded = (await trigger.getAttribute('aria-expanded')) === 'true'
  if (!expanded) {
    await trigger.click({ force: true })
  }

  const tasmanOption = page.locator('[role="option"]', { hasText: /Tasman/i }).first()
  if (await tasmanOption.count()) {
    await tasmanOption.click({ force: true })
    return
  }

  const firstOption = page.locator('[role="option"]').first()
  if (await firstOption.count()) {
    await firstOption.click({ force: true })
  }
}

async function openManualEntry(page: any) {
  await page.goto('/field')

  const detailScanCard = page.locator('text=Scan Vehicle (Detail)').first()
  if (await detailScanCard.isVisible().catch(() => false)) {
    await detailScanCard.click()
  } else {
    const scanVehicleCard = page.locator('text=Scan Vehicle').first()
    if (await scanVehicleCard.isVisible().catch(() => false)) {
      await scanVehicleCard.click()
    }
  }

  await page.click('text=Manual Entry')
  await selectZoneIfNeeded(page)
}

test.describe('Bob Field Resilience & Network Dropout Simulation', () => {
  test('queues a field incident workflow offline and syncs it when connectivity returns', async ({ officerUser }) => {
    const page = officerUser

    await openManualEntry(page)

    await page.context().setOffline(true)
    await expect(page.locator('text=Offline')).toBeVisible()

    await page.fill('input[placeholder*="plate"]', `BOBOFF${Date.now().toString().slice(-6)}`)
    await page.click('button:has-text("Submit")')

    await helpers.waitForToast(page, 'Saved offline')
    await expect(page.locator('text=pending sync')).toBeVisible()

    await page.context().setOffline(false)
    await page.waitForTimeout(3000)

    await helpers.waitForToast(page, 'synced')
    await expect(page.locator('text=pending sync')).not.toBeVisible()
  })
})