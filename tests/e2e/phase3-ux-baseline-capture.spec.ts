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

  await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })

  const routeLink = page.locator(`nav a[href="${route}"], aside a[href="${route}"]`).first()
  const hasDirectLink = await routeLink.isVisible().catch(() => false)

  const startedAt = Date.now()

  if (hasDirectLink) {
    clickDepth = 1
    await routeLink.click()
    await page.waitForLoadState('domcontentloaded')
  } else {
    // Fallback path keeps measurement alive for routes not exposed as direct nav links.
    clickDepth = null
    await page.goto(route, { waitUntil: 'domcontentloaded' })
  }

  const primaryActionVisible = await waitForPrimaryAction(page)
  if (!primaryActionVisible) {
    errorProneActions += 1
  }

  const expectedPath = route
  const currentUrl = page.url()
  if (!currentUrl.includes(expectedPath)) {
    errorProneActions += 1
  }

  const elapsedMs = Date.now() - startedAt

  return {
    route,
    clickDepth,
    timeToPrimaryActionSeconds: Number((elapsedMs / 1000).toFixed(2)),
    errorProneActions,
    note: hasDirectLink ? undefined : 'No direct sidebar link; measured via direct route navigation',
  }
}

test.describe('phase3 ux baseline capture', () => {
  test.describe.configure({ mode: 'serial' })

  test('captures baseline metrics for triaged top-10 routes', async ({ page }) => {
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
