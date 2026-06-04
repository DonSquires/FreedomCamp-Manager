import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function assertLeafletMapVisible(page: import('@playwright/test').Page) {
  const map = page.locator('.leaflet-container').first()
  await expect(map).toBeVisible({ timeout: 20000 })

  const loadedTile = page.locator('.leaflet-tile-loaded').first()
  await expect(loadedTile).toBeVisible({ timeout: 30000 })

  const tileSrc = await loadedTile.getAttribute('src')
  expect((tileSrc || '').trim().length).toBeGreaterThan(0)
}

test.describe('Map pages visual verification', () => {
  test('operations map renders visible basemap tiles', async ({ page }, testInfo) => {
    test.setTimeout(180000)

    await loginAs(page, 'master')
    await page.goto('/operations-map', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/operations-map(?:\?|$|#)/, { timeout: 30000 })

    await assertLeafletMapVisible(page)
    await testInfo.attach('operations-map', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('job map renders visible basemap tiles', async ({ page }, testInfo) => {
    test.setTimeout(180000)

    await loginAs(page, 'master')
    await page.goto('/job-map', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/job-map(?:\?|$|#)/, { timeout: 30000 })

    await assertLeafletMapVisible(page)
    await testInfo.attach('job-map', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
})
