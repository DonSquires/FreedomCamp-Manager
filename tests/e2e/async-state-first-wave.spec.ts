/**
 * Async-State First-Wave E2E
 *
 * Validates graceful offline behavior for first-wave operator routes.
 * Uses the shared AppLayout offline banner as a deterministic async-state signal.
 */

import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

test.use({ screenshot: 'on' })

const OFFLINE_BANNER = 'Connection lost. You are offline and some live data may be stale.'
const FIRST_WAVE_ROUTES = [
  '/dispatch',
  '/live-tracking',
  '/compliance',
  '/patrol-schedule',
  '/officer-welfare',
  '/incident-reports',
  '/reports',
  '/enforcement-actions',
  '/zones',
  '/admin/dashboard',
] as const

async function dispatchConnectivityEvent(page: Page, type: 'offline' | 'online') {
  // Delay event dispatch slightly so React effects have attached listeners on route mount.
  await page.evaluate(async (eventType) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        window.dispatchEvent(new Event(eventType))
        resolve()
      }, 50)
    })
  }, type)
}

async function assertOfflineBanner(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  await expect(page.locator('main')).toBeVisible({ timeout: 8000 })
  await dispatchConnectivityEvent(page, 'offline')

  await expect(page.getByText(OFFLINE_BANNER)).toBeVisible({ timeout: 8000 })

  // Restore online mode to verify graceful recovery.
  await dispatchConnectivityEvent(page, 'online')

  await expect(page.getByText(OFFLINE_BANNER)).toBeHidden({ timeout: 8000 })
}

test.describe('first-wave async-state offline behavior', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'adminOrg1')
  })

  for (const route of FIRST_WAVE_ROUTES) {
    test(`${route} shows and clears offline banner`, async ({ page }) => {
      await assertOfflineBanner(page, route)
    })
  }
})
