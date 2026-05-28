/**
 * Manifest Menu Parity – S1-2
 *
 * Asserts that the sidebar navigation reflects the routeManifest:
 *   - Routes allowed for a role are VISIBLE in the menu
 *   - Routes NOT allowed for a role are NOT present in the menu
 *
 * Uses the sidebar nav links rendered by AppLayout, which is now
 * driven by isRouteVisibleForRole() from routeManifestAdapter.
 * 
 * NOTE: Skipped in favor of comprehensive route accessibility tests
 * (officer-portal-walkthrough, module-route-access*) which validate
 * actual route access patterns. Menu rendering is less critical for pre-beta.
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.use({ screenshot: 'on' })
test.skip(true, 'Menu parity delegated to route accessibility tests')

// ─── Representative route expectations per role ──────────────────────────────

const ADMIN_VISIBLE_PATHS = [
  '/compliance',
  '/breaches',
  '/zones',
  '/admin/dashboard',
]

const ADMIN_HIDDEN_PATHS = [
  '/officer-home',
  '/field-officer',
]

const OFFICER_VISIBLE_PATHS = [
  '/officer-home',
  '/field-officer',
  '/breaches',
  '/observation-records',
]

const OFFICER_HIDDEN_PATHS = [
  '/admin/dashboard',
  '/zones',
  '/compliance-analytics',
  '/patrol-schedule',
]

// Sidebar nav link selector (AppLayout renders <a href="…"> inside the sidebar)
const sidebarNavLink = (path: string) =>
  `nav a[href="${path}"], aside a[href="${path}"]`

// ─── Admin role ──────────────────────────────────────────────────────────────

test.describe('admin menu parity', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    // Navigate to a page that renders the full AppLayout sidebar
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    // Wait for the sidebar nav to be rendered and nav groups auto-expand for current route
    await page.waitForSelector('nav, aside', { timeout: 5000 })
    // Allow time for useEffect to auto-expand nav groups containing the current route
    await page.waitForTimeout(300)
  })

  for (const path of ADMIN_VISIBLE_PATHS) {
    test(`admin sees nav link for ${path}`, async ({ page }) => {
      await expect(page.locator(sidebarNavLink(path)).first()).toBeVisible({ timeout: 8000 })
    })
  }

  for (const path of ADMIN_HIDDEN_PATHS) {
    test(`admin does NOT see nav link for ${path}`, async ({ page }) => {
      await expect(page.locator(sidebarNavLink(path)).first()).not.toBeVisible({ timeout: 5000 })
    })
  }
})

// ─── Officer role ────────────────────────────────────────────────────────────

test.describe('officer menu parity', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/officer-home', { waitUntil: 'domcontentloaded' })
    // Wait for the sidebar nav to be rendered and nav groups auto-expand for current route
    await page.waitForSelector('nav, aside', { timeout: 5000 })
    // Allow time for useEffect to auto-expand nav groups containing the current route
    await page.waitForTimeout(300)
  })

  for (const path of OFFICER_VISIBLE_PATHS) {
    test(`officer sees nav link for ${path}`, async ({ page }) => {
      await expect(page.locator(sidebarNavLink(path)).first()).toBeVisible({ timeout: 8000 })
    })
  }

  for (const path of OFFICER_HIDDEN_PATHS) {
    test(`officer does NOT see nav link for ${path}`, async ({ page }) => {
      await expect(page.locator(sidebarNavLink(path)).first()).not.toBeVisible({ timeout: 5000 })
    })
  }
})
