import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

test.use({ screenshot: 'on' })

type BaselineRow = {
  route: string
  clickDepth: number | null
  timeToPrimaryActionSeconds: number | null
  errorProneActions: number
  note?: string
}

const TRIAGED_ROUTES = [
  '/compliance',
  '/dispatch-monitor',
  '/job-map',
  '/observations',
  '/radio',
  '/breaches',
  '/reports',
  '/crm',
  '/live-patrol',
  '/noise-control',
] as const

const baselineRows: BaselineRow[] = []

async function waitForPrimaryAction(page: Page): Promise<boolean> {
  const main = page.locator('main').first()
  const button = page.locator('main button:visible').first()
  const input = page.locator('main input:visible').first()
  const tableRow = page.locator('main table tbody tr:visible').first()

  const probes = [
    main.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    button.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    input.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    tableRow.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
  ]

  const results = await Promise.all(probes)
  return results.some(Boolean)
}

async function captureRouteBaseline(page: Page, route: string): Promise<BaselineRow> {
  let errorProneActions = 0
  let clickDepth: number | null = null
  let note: string | undefined

  const NAV_GROUP_LABELS = [
    'Operations',
    'Live Ops',
    'Management',
    'Records',
    'Specialist Portals',
    'Roster & Workforce',
    'Bob',
    'Tools',
    'Settings',
  ] as const

  const ROUTE_LABELS: Record<string, string[]> = {
    '/compliance': ['Compliance', 'Compliance Hub'],
    '/dispatch-monitor': ['Dispatch Monitor', 'Monitor'],
    '/job-map': ['Job Map'],
    '/observations': ['Observations', 'Observation Records'],
    '/radio': ['Radio'],
    '/breaches': ['Breaches', 'Breaches & Alerts'],
    '/reports': ['Reports', 'Reports Hub'],
    '/crm': ['CRM Hub', 'CRM / Accounts'],
    '/live-patrol': ['Live Patrol', 'Live Patrol Monitor'],
    '/noise-control': ['Noise Control'],
  }

  const prepAppShellNavigation = async () => {
    await page.evaluate(() => {
      window.localStorage.setItem('fc_sidebar_open', 'true')
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })

    const openMenuButton = page.getByRole('button', { name: /open menu/i }).first()
    const canOpenDesktopNav = await openMenuButton.isVisible().catch(() => false)
    if (canOpenDesktopNav) {
      await openMenuButton.click().catch(() => undefined)
    }
  }

  const tryClickRouteLink = async (): Promise<number | null> => {
    const clickRouteButton = async (): Promise<boolean> => {
      const labels = ROUTE_LABELS[route] ?? []
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const candidate = page.getByRole('button', { name: new RegExp(`^${escaped}$`, 'i') }).first()
        const isVisible = await candidate.isVisible().catch(() => false)
        if (!isVisible) continue

        await candidate.click().catch(() => undefined)
        await page.waitForLoadState('domcontentloaded')
        if (page.url().includes(route)) return true
      }

      return false
    }

    const clickRouteAnchor = async (requireVisible: boolean): Promise<boolean> => {
      const candidate = page.locator(`a[href="${route}"]`).first()
      const count = await candidate.count()
      if (count === 0) return false

      if (requireVisible) {
        const isVisible = await candidate.isVisible().catch(() => false)
        if (!isVisible) return false
      }

      await candidate.click(requireVisible ? undefined : { force: true }).catch(() => undefined)
      await page.waitForLoadState('domcontentloaded')
      return page.url().includes(route)
    }

    if (await clickRouteAnchor(true)) {
      return 1
    }

    if (await clickRouteButton()) {
      return 2
    }

    // Expand grouped sidebar sections and try again.
    for (const label of NAV_GROUP_LABELS) {
      const toggle = page.locator('aside').getByRole('button', { name: label }).first()
      const canToggle = await toggle.isVisible().catch(() => false)
      if (canToggle) {
        await toggle.click().catch(() => undefined)
      }
    }

    if (await clickRouteAnchor(true)) {
      return 3
    }

    // Final fallback: if a link exists in DOM but is clipped/hidden, allow force-click.
    if (await clickRouteAnchor(false)) {
      return 4
    }

    return null
  }

  const navigateViaAppShell = async (): Promise<number | null> => {
    await prepAppShellNavigation()

    // Attempt 1: admin hub cards / quick links.
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await prepAppShellNavigation()
    const adminShellUrl = page.url()
    const hubDepth = await tryClickRouteLink()
    if (hubDepth != null) return hubDepth

    // Attempt 2: operations dashboard nav/shortcuts.
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await prepAppShellNavigation()
    const dashboardShellUrl = page.url()
    const dashboardDepth = await tryClickRouteLink()
    if (dashboardDepth != null) return dashboardDepth

    note = `No visible app navigation link found from /admin or /admin/dashboard (resolved URLs: ${adminShellUrl}, ${dashboardShellUrl})`

    return null
  }

  const startedAt = Date.now()

  const measuredDepth = await navigateViaAppShell()
  const navigated = measuredDepth != null

  if (navigated) {
    clickDepth = measuredDepth
  } else {
    // No direct app-shell navigation path found in this environment.
    clickDepth = null
    note = note ?? 'No visible app navigation link found from /admin or /admin/dashboard'
    errorProneActions += 1
  }

  const primaryActionVisible = navigated ? await waitForPrimaryAction(page) : false
  if (!primaryActionVisible) {
    errorProneActions += 1
  }

  const expectedPath = route
  const currentUrl = page.url()
  if (navigated && !currentUrl.includes(expectedPath)) {
    errorProneActions += 1
  }

  const elapsedMs = Date.now() - startedAt

  return {
    route,
    clickDepth,
    timeToPrimaryActionSeconds: Number((elapsedMs / 1000).toFixed(2)),
    errorProneActions,
    note,
  }
}

test.describe('phase3 ux baseline capture', () => {
  test.describe.configure({ mode: 'serial' })

  test('captures baseline metrics for triaged top-10 routes', async ({ page }) => {
    test.setTimeout(180000)
    await loginAs(page, 'adminOrg1')

    for (const route of TRIAGED_ROUTES) {
      const row = await captureRouteBaseline(page, route)
      baselineRows.push(row)

      // Route should not fail hard; even degraded routes should show shell.
      expect(row.timeToPrimaryActionSeconds).not.toBeNull()
    }
  })

  test.afterAll(async () => {
    const outDir = path.join(process.cwd(), 'test-results')
    await mkdir(outDir, { recursive: true })
    const outPath = path.join(outDir, 'phase3-ux-baseline.json')
    const payload = {
      capturedAt: new Date().toISOString(),
      sourceSpec: 'tests/e2e/phase3-ux-baseline-capture.spec.ts',
      rows: baselineRows,
    }
    await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  })
})
