import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function navigateInApp(page: import('@playwright/test').Page, path: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.evaluate((targetPath: string) => {
    window.history.pushState({}, '', targetPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)

  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:\\?|$|#)`), { timeout: 30000 })
  await expect(page.getByText(/cannot get/i).first()).toBeHidden({ timeout: 5000 })
}

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
    await navigateInApp(page, '/operations-map')

    await assertLeafletMapVisible(page)
    await testInfo.attach('operations-map', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('job map renders visible basemap tiles', async ({ page }, testInfo) => {
    test.setTimeout(180000)

    await loginAs(page, 'master')
    await navigateInApp(page, '/job-map')

    await assertLeafletMapVisible(page)
    await testInfo.attach('job-map', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('patrol navigation page loads with route form', async ({ page }, testInfo) => {
    test.setTimeout(120000)

    await loginAs(page, 'master')
    await navigateInApp(page, '/patrol-navigation')

    // Page heading
    await expect(page.getByRole('heading', { name: /patrol navigation/i })).toBeVisible({ timeout: 20000 })

    // Origin and destination cards should be present
    await expect(page.getByRole('heading', { name: /origin/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /destination/i })).toBeVisible({ timeout: 10000 })

    // Get Directions button should be present
    await expect(page.getByRole('button', { name: /get directions/i })).toBeVisible({ timeout: 10000 })

    await testInfo.attach('patrol-navigation', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
})
