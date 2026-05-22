import { test, expect, helpers } from './setup'

async function expectOfflineIndicator(page: any) {
  const offlineIndicator = page.locator('text=Offline').or(page.locator('[data-testid="offline-indicator"]')).first()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await offlineIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
      return
    }
    await page.waitForTimeout(300)
  }

  throw new Error('Offline indicator did not appear after forcing offline mode')
}

async function expectQueuedState(page: any) {
  const queuedBanner = page.locator('text=/pending sync|queued locally|Saved offline/i').first()
  await expect(queuedBanner).toBeVisible({ timeout: 5000 })
}

async function expectSyncedState(page: any) {
  const successSurface = page.locator('text=/All queued actions synced successfully|All actions synced|synced/i').first()

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await successSurface.isVisible({ timeout: 1000 }).catch(() => false)) {
      break
    }
    await page.waitForTimeout(500)
  }

  await expect(successSurface).toBeVisible({ timeout: 10000 })
  await expect(page.locator('text=/pending sync/i').first()).not.toBeVisible({ timeout: 10000 })
}

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
    await expectOfflineIndicator(page)

    await page.fill('input[placeholder*="plate"]', `BOBOFF${Date.now().toString().slice(-6)}`)
    await page.click('button:has-text("Submit")')

    await helpers.waitForToast(page, 'Saved offline').catch(() => undefined)
    await expectQueuedState(page)

    await page.context().setOffline(false)
    await page.waitForTimeout(1000)

    await helpers.waitForToast(page, 'All queued actions synced successfully').catch(() => undefined)
    await expectSyncedState(page)
  })
})