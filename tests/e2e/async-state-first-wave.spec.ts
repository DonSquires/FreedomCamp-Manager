/**
 * Async-State First-Wave E2E
 *
 * Validates graceful offline behavior for first-wave operator routes.
 * Uses the shared AppLayout offline banner as a deterministic async-state signal,
 * and cross-checks the covered routes against the generated route-role matrix so
 * the suite cannot silently drift onto deleted or renamed paths.
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

test.use({ screenshot: 'on' })
test.setTimeout(120000)

const ADMIN_EMAIL =
  process.env.API_TEST_EMAIL ||
  process.env.PLAYWRIGHT_LIVE_EMAIL ||
  process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL ||
  process.env.PLAYWRIGHT_ADMIN_EMAIL ||
  process.env.E2E_ADMIN_EMAIL ||
  ''

const ADMIN_PASSWORD =
  process.env.API_TEST_PASSWORD ||
  process.env.PLAYWRIGHT_LIVE_PASSWORD ||
  process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD ||
  process.env.PLAYWRIGHT_ADMIN_PASSWORD ||
  process.env.E2E_ADMIN_PASSWORD ||
  ''

const OFFLINE_BANNER = 'Connection lost. You are offline and some live data may be stale.'
const EXPANDED_ASYNC_STATE_ROUTES = [
  '/dispatch',
  '/dispatch-monitor',
  '/live-tracking',
  '/compliance',
  '/patrol-schedule',
  '/officer-welfare',
  '/incident-reports',
  '/reports',
  '/enforcement-actions',
  '/zones',
  '/breaches',
  '/job-map',
  '/observations',
  '/live-patrol',
  '/noise-control',
  '/admin/dashboard',
] as const

type RouteMatrixEntry = {
  path: string
  accessType: string
  roles: string[]
  protected: boolean
}

const routeMatrixPath = path.join(process.cwd(), 'tools/route-role-matrix/route-role-matrix.json')
const routeMatrix = JSON.parse(fs.readFileSync(routeMatrixPath, 'utf8')) as { routes: RouteMatrixEntry[] }
const routeMatrixByPath = new Map(routeMatrix.routes.map((entry) => [entry.path, entry]))

const VERIFIED_ASYNC_STATE_ROUTES = EXPANDED_ASYNC_STATE_ROUTES.map((route) => {
  const entry = routeMatrixByPath.get(route)
  if (!entry) throw new Error(`[async-state] Route ${route} not found in route-role-matrix.json`)
  if (!entry.protected) throw new Error(`[async-state] Route ${route} is not protected in route-role-matrix.json`)
  return route
})

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function waitForAuthenticatedShell(page: Page, route: string) {
  // Ensure the protected route has fully resolved auth/profile hydration
  // before forcing offline mode, otherwise route guards can bounce to /login.
  const routePattern = new RegExp(`${escapeRegExp(route)}(?:\\?.*)?$`)
  await expect(page).toHaveURL(routePattern, { timeout: 15000 })
  await expect(page.getByTestId('notification-bell')).toBeVisible({ timeout: 15000 })
  await page.waitForFunction(() => {
    const raw = window.sessionStorage.getItem('auth-storage')
    if (!raw) return false
    try {
      const parsed = JSON.parse(raw)
      return Boolean(parsed?.state?.user?.id)
    } catch {
      return false
    }
  }, { timeout: 15000 })
}

async function assertOfflineBanner(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  // Some routes render without a <main> wrapper; body visibility is the stable app-ready signal.
  await expect(page.locator('body')).toBeVisible({ timeout: 8000 })
  await waitForAuthenticatedShell(page, route)

  await page.context().setOffline(true)
  try {
    await dispatchConnectivityEvent(page, 'offline')

    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible({ timeout: 8000 })

    // Restore online mode to verify graceful recovery.
    await page.context().setOffline(false)
    await dispatchConnectivityEvent(page, 'online')

    await expect(page.getByText(OFFLINE_BANNER)).toBeHidden({ timeout: 8000 })
  } finally {
    await page.context().setOffline(false)
  }
}

test.describe('first-wave async-state offline behavior', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'adminOrg1')
  })

  for (const route of VERIFIED_ASYNC_STATE_ROUTES) {
    test(`${route} shows and clears offline banner`, async ({ page }) => {
      await assertOfflineBanner(page, route)
    })
  }
})
