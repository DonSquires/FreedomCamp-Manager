import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

const ENABLE_MANUAL_SEED = process.env.PLAYWRIGHT_ENABLE_MANUAL_SEED === '1'
const TARGET_BRANCH = process.env.PLAYWRIGHT_MANUAL_BRANCH || 'Ashburton - First Security'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loginForManualSeed(page: import('@playwright/test').Page): Promise<void> {
  const email =
    process.env.PLAYWRIGHT_MASTER_EMAIL ||
    process.env.E2E_MASTER_EMAIL ||
    process.env.PLAYWRIGHT_TEST_EMAIL ||
    ''
  const password =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!email || !password) {
    await loginAs(page, 'master')
  } else {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox', { name: /email/i }).first().fill(email)
    await page.getByRole('textbox', { name: /password/i }).first().fill(password)
    await page.getByRole('button', { name: /^sign in$/i }).first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  }

  const workspaceHeading = page.getByText(/choose a workspace to continue your shift/i).first()
  if (await workspaceHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    const adminPortalCard = page.getByTestId('portal-card-admin').first()
    if (await adminPortalCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await adminPortalCard.click({ force: true })
    }
  }

  await page.waitForLoadState('networkidle').catch(() => undefined)
}

test.describe('Map tile rendering', () => {
  test.skip(!ENABLE_MANUAL_SEED, 'Manual data checks are disabled by default. Set PLAYWRIGHT_ENABLE_MANUAL_SEED=1 to run.')

  test('renders geofence map tiles without fallback warning', async ({ page }) => {
    test.setTimeout(180000)

    await loginForManualSeed(page)

    await page.goto('/organizations', { waitUntil: 'domcontentloaded' })

    const orgSearch = page.locator('input[placeholder*="Search organizations" i], input[placeholder*="Search organisations" i]').first()
    if (await orgSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
      await orgSearch.fill(TARGET_BRANCH)
    }

    const orgCard = page
      .locator('[data-testid^="organization-card-"]')
      .filter({ hasText: new RegExp(escapeRegex(TARGET_BRANCH), 'i') })
      .first()

    await expect(orgCard).toBeVisible({ timeout: 15000 })

    const setZoneButton = orgCard.getByRole('button', { name: /set zone|zones/i }).first()
    await expect(setZoneButton).toBeVisible({ timeout: 10000 })
    await setZoneButton.click({ force: true })

    await expect(page).toHaveURL(/\/zones(?:\?|$|#)/, { timeout: 20000 })

    const addZoneButton = page.getByRole('button', { name: /add zone|create zone|new zone/i }).first()
    await expect(addZoneButton).toBeVisible({ timeout: 15000 })
    await addZoneButton.click({ force: true })

    const dialog = page.getByRole('dialog').filter({ hasText: /add zone|create a new enforcement or jurisdiction zone/i }).first()
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const boundaryButton = page.getByRole('button', { name: /draw boundary on map|edit boundary map/i }).first()
    await expect(boundaryButton).toBeVisible({ timeout: 10000 })
    await boundaryButton.click()

    await expect(page.getByText(/geofence editor/i).first()).toBeVisible({ timeout: 15000 })

    const map = page.locator('.leaflet-container').last()
    await expect(map).toBeVisible({ timeout: 15000 })

    const loadedTiles = page.locator('.leaflet-tile-loaded')
    await expect(loadedTiles.first()).toBeVisible({ timeout: 20000 })

    const loadedTileCount = await loadedTiles.count()
    expect(loadedTileCount).toBeGreaterThan(0)

    const tileSrcSample = await page.locator('.leaflet-tile-loaded').first().getAttribute('src')
    expect((tileSrcSample || '').trim().length).toBeGreaterThan(0)

    const fallbackWarning = page.getByText(/Primary map tiles are unavailable\. Switched to OpenStreetMap fallback\./i).first()
    await expect(fallbackWarning).toBeHidden({ timeout: 3000 })
  })
})
