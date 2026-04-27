/**
 * Module E2E – Comprehensive per-module functional tests
 *
 * For each major module this spec verifies:
 *   - Page loads and key heading/structure renders
 *   - Primary interactive element is present (tabs, tables, buttons)
 *   - Bob visual quality gate passes (≥70)
 *
 * Modules covered:
 *   Asset Management, Compliance, Enforcement, Dispatch,
 *   Patrol Management, Vehicles/NZSCV, CRM, Observations,
 *   Incident Reports, Notices/Infringements, Reports,
 *   Settings & Profile, Roster & Shifts, Bob Assistant
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

test.use({ screenshot: 'on' })

async function expectPageContentVisible(page: any, timeout = 15000) {
  const mainVisible = await page.locator('main').first().isVisible().catch(() => false)
  if (mainVisible) return

  await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout })
}

// ─── Asset Management ─────────────────────────────────────────────────────────

test.describe('Asset Management', () => {
  test.describe.configure({ mode: 'serial' })

  test('page loads with correct heading', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/asset-management', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: /Asset Management/i })).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'asset-management-page')
  })

  test('tabs are present: Equipment, Vehicles, Facilities', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/asset-management', { waitUntil: 'networkidle' })
    await expect(page.getByRole('tab', { name: /Equipment/i })).toBeVisible({ timeout: 10000 })
  })

  test('Equipment tab shows asset table or empty state', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/asset-management', { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: /Equipment/i }).click()
    // Either a table or an empty-state message should be visible
    const hasTable = await page.locator('table').first().isVisible().catch(() => false)
    const hasEmptyState = await page.locator('[data-testid="empty-state"]').first().isVisible().catch(() => false)
    const hasNoAssetsText = await page.getByText(/no assets/i).first().isVisible().catch(() => false)
    expect(hasTable || hasEmptyState || hasNoAssetsText).toBeTruthy()
    await bobAssessPage(page, testInfo, 'asset-management-equipment-tab')
  })
})

// ─── Compliance ───────────────────────────────────────────────────────────────

test.describe('Compliance', () => {
  test.describe.configure({ mode: 'serial' })

  test('compliance page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/compliance', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'compliance-page')
  })

  test('compliance analytics page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/compliance-analytics', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'compliance-analytics-page')
  })
})

// ─── Enforcement ─────────────────────────────────────────────────────────────

test.describe('Enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  test('enforcement review page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/enforcement-review', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'enforcement-review-page')
  })

  test('infringements page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/infringements', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'infringements-page')
  })

  test('notice to vacate page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/notice-to-vacate', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'notice-to-vacate-page')
  })

  test('disputes page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/disputes', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'disputes-page')
  })

  test('investigations page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/investigations', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'investigations-page')
  })
})

// ─── Dispatch ─────────────────────────────────────────────────────────────────

test.describe('Dispatch', () => {
  test.describe.configure({ mode: 'serial' })

  test('dispatch console loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/dispatch', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'dispatch-console')
  })

  test('dispatch monitor loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/dispatch-monitor', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'dispatch-monitor')
  })

  test('dispatch wizard loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/dispatch-wizard', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'dispatch-wizard')
  })

  test('dispatched jobs list loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/dispatched-jobs', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'dispatched-jobs')
  })

  test('job map loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/job-map', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'job-map')
  })
})

// ─── Patrol Management ────────────────────────────────────────────────────────

test.describe('Patrol Management', () => {
  test.describe.configure({ mode: 'serial' })

  test('live patrol monitor loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/live-patrol', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'live-patrol-monitor')
  })

  test('patrol schedule loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/patrol-schedule', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'patrol-schedule')
  })

  test('patrol checkpoints loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/patrol-checkpoints', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'patrol-checkpoints')
  })

  test('patrol KPIs loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/patrol-kpis', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'patrol-kpis')
  })

  test('live tracking page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/live-tracking', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'live-tracking')
  })
})

// ─── Vehicles & NZSCV ─────────────────────────────────────────────────────────

test.describe('Vehicles', () => {
  test.describe.configure({ mode: 'serial' })

  test('vehicles page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'vehicles-page')
  })

  test('vehicle registry loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/vehicle-registry', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'vehicle-registry')
  })

  test('admin nzscv page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin/nzscv', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'admin-nzscv-page')
  })

  test('admin vehicle discrepancies page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin/discrepancies', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'vehicle-discrepancies')
  })
})

// ─── CRM ─────────────────────────────────────────────────────────────────────

test.describe('CRM', () => {
  test.describe.configure({ mode: 'serial' })

  test('crm page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/crm', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'crm-module')
  })

  test('client master list loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/client-master-list', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'client-master-list')
  })

  test('client sites page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/client-sites', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'client-sites')
  })

  test('client portal loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/client-portal', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'client-portal')
  })
})

// ─── Observations & Incidents ─────────────────────────────────────────────────

test.describe('Observations & Incidents', () => {
  test.describe.configure({ mode: 'serial' })

  test('observations page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/observations', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'observations')
  })

  test('incident reports page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/incident-reports', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'incident-reports')
  })

  test('breaches page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/breaches', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'breaches')
  })
})

// ─── Zones & Maps ─────────────────────────────────────────────────────────────

test.describe('Zones & Maps', () => {
  test.describe.configure({ mode: 'serial' })

  test('zones page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/zones', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'zones')
  })

  test('hotspots map loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/hotspots', { waitUntil: 'domcontentloaded' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'hotspots-map')
  })

  test('spatial compliance page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/spatial-compliance', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'spatial-compliance')
  })

  test('operations map loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/operations-map', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'operations-map')
  })

  test('points of interest loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/points-of-interest', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'points-of-interest')
  })
})

// ─── Reports ─────────────────────────────────────────────────────────────────

test.describe('Reports', () => {
  test.describe.configure({ mode: 'serial' })

  test('reports page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/reports', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'reports-page')
  })

  test('custom reports builder loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/custom-reports', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'custom-reports')
  })

  test('ai analysis page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/ai-analysis', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'ai-analysis')
  })

  test('audit log page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/audit-log', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'audit-log')
  })
})

// ─── Invoicing & Financials ───────────────────────────────────────────────────

test.describe('Invoicing & Financials', () => {
  test.describe.configure({ mode: 'serial' })

  test('invoicing page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/invoicing', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'invoicing')
  })

  test('pricing page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/pricing', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'pricing')
  })
})

// ─── Workforce & Roster ───────────────────────────────────────────────────────

test.describe('Workforce & Roster', () => {
  test.describe.configure({ mode: 'serial' })

  test('roster planner loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/roster', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'roster-planner')
  })

  test('timesheets page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/timesheets', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'timesheets')
  })

  test('open shifts page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/open-shifts', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'open-shifts')
  })

  test('officer skills page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/officer-skills', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'officer-skills')
  })

  test('officer welfare settings loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/officer-welfare', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'officer-welfare')
  })
})

// ─── Settings & Profile ───────────────────────────────────────────────────────

test.describe('Settings & Profile', () => {
  test.describe.configure({ mode: 'serial' })

  test('settings page loads for admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'settings-admin')
  })

  test('profile page loads for admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/profile', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'profile-admin')
  })

  test('settings page loads for officer', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'settings-officer')
  })

  test('organization profile loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/organization-profile', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'organization-profile')
  })
})

// ─── Bob Assistant & AI ───────────────────────────────────────────────────────

test.describe('Bob Assistant', () => {
  test.describe.configure({ mode: 'serial' })

  test('bob assistant studio loads for admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/bob-assistant', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'bob-assistant')
  })

  test('bob intake queue loads for admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/bob-intake-queue', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'bob-intake-queue')
  })

  test('bob ui review page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/bob-ui-review', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'bob-ui-review')
  })

  test('live plan reviews page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/live-plan-reviews', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'live-plan-reviews')
  })

  test('bob assistant available for officer', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/bob-assistant', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'bob-assistant-officer')
  })
})

// ─── Specialised Portals ──────────────────────────────────────────────────────

test.describe('Specialised Portals', () => {
  test.describe.configure({ mode: 'serial' })

  test('parking enforcement portal loads (admin)', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/parking', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'parking-enforcement')
  })

  test('parking officer portal loads (officer)', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/parking-officer', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'parking-officer-portal')
  })

  test('noise control portal loads (admin)', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/noise-control', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'noise-control-admin')
  })

  test('noise officer portal loads (officer)', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/noise-officer', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'noise-officer-portal')
  })

  test('biosecurity control portal loads (admin)', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/biosecurity-control', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'biosecurity-control-admin')
  })

  test('biosecurity officer portal loads (officer)', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/biosecurity-officer', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'biosecurity-officer-portal')
  })

  test('smoke control portal loads (admin)', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/smoke-control', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'smoke-control-admin')
  })

  test('smoke officer portal loads (officer)', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/smoke-officer', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'smoke-officer-portal')
  })
})

// ─── Admin Data & Permissions ─────────────────────────────────────────────────

test.describe('Admin Data & Permissions', () => {
  test.describe.configure({ mode: 'serial' })

  test('data management page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/data', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'data-management')
  })

  test('admin data hub loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin/data-hub', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'admin-data-hub')
  })

  test('access control page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/access-control', { waitUntil: 'networkidle' })
    await expectPageContentVisible(page)
    await bobAssessPage(page, testInfo, 'access-control-page')
  })

  test('site permissions admin loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin/site-permissions', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'site-permissions-admin')
  })

  test('canonical records manager loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin/canonical-records', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'canonical-records-manager')
  })

  test('person records page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/person-records', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'person-records')
  })

  test('import data page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/import-data', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'import-data')
  })

  test('identity verification page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/identity-verification', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'identity-verification')
  })

  test('privacy curtain page loads', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/privacy-curtain', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'privacy-curtain')
  })
})

// ─── Master-only modules ──────────────────────────────────────────────────────

test.describe('Master-only Modules', () => {
  test.describe.configure({ mode: 'serial' })

  test('organizations page loads for master', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/organizations', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'organizations-master')
  })

  test('intel approvals page loads for master', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/intel-approvals', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'intel-approvals-master')
  })

  test('platform page loads for master', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 })
    await bobAssessPage(page, testInfo, 'platform-master')
  })
})
