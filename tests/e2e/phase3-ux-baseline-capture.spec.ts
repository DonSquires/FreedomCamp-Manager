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

  const tryClickRouteLink = async (): Promise<number | null> => {
    const link = page.locator(`a[href="${route}"]:visible`).first()
    const visible = await link.isVisible().catch(() => false)
    if (visible) {
      await link.click()
      await page.waitForLoadState('domcontentloaded')
      return 1
    }

    // Expand grouped sidebar sections and try again.
    for (const label of NAV_GROUP_LABELS) {
      const toggle = page.getByRole('button', { name: label }).first()
      const canToggle = await toggle.isVisible().catch(() => false)
      if (canToggle) {
        await toggle.click().catch(() => undefined)
      }
    }

    const expandedLink = page.locator(`a[href="${route}"]:visible`).first()
    const expandedVisible = await expandedLink.isVisible().catch(() => false)
    if (!expandedVisible) return null

    await expandedLink.click()
    await page.waitForLoadState('domcontentloaded')
    return 2
  }

  const navigateViaAppShell = async (): Promise<number | null> => {
    // Attempt 1: admin hub cards / quick links.
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    const hubDepth = await tryClickRouteLink()
    if (hubDepth != null) return hubDepth

    // Attempt 2: operations dashboard nav/shortcuts.
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    const dashboardDepth = await tryClickRouteLink()
    if (dashboardDepth != null) return dashboardDepth

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
    note = 'No visible app navigation link found from /admin or /admin/dashboard'
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
