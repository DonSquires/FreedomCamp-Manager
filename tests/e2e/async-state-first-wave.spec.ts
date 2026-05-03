/**
 * Async-State First-Wave E2E
 *
 * Validates graceful offline behavior for sampled first-wave operator routes.
 * Uses the shared AppLayout offline banner as a deterministic async-state signal.
 */

import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

test.use({ screenshot: 'on' })

const OFFLINE_BANNER = 'Connection lost. You are offline and some live data may be stale.'

async function assertOfflineBanner(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  // Force offline UI mode in-app without relying on network-layer flakiness.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'))
  })

  await expect(page.getByText(OFFLINE_BANNER)).toBeVisible({ timeout: 8000 })

  // Restore online mode to verify graceful recovery.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
  })

  await expect(page.getByText(OFFLINE_BANNER)).toBeHidden({ timeout: 8000 })
}

test.describe('first-wave async-state offline behavior', () => {
  test.describe.configure({ mode: 'serial' })

  test('dispatch shows and clears offline banner', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertOfflineBanner(page, '/dispatch')
  })

  test('live-tracking shows and clears offline banner', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertOfflineBanner(page, '/live-tracking')
  })

  test('compliance shows and clears offline banner', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertOfflineBanner(page, '/compliance')
  })

  test('patrol-schedule shows and clears offline banner', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertOfflineBanner(page, '/patrol-schedule')
  })

  test('officer-welfare shows and clears offline banner', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertOfflineBanner(page, '/officer-welfare')
  })
})
