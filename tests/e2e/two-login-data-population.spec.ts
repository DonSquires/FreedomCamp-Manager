/**
 * Visual + data-population probe for the two verified accounts.
 *
 * squires.don@live.com       → grand_master  → /platform
 * don.squires@firstsecurity  → master        → /admin/dashboard
 *
 * For each account this spec:
 *   1. Logs in and waits for the network to settle
 *   2. Takes a full-page screenshot of the landing page
 *   3. Checks stat cards / KPI tiles for real values (not '...', '--', or empty)
 *   4. Counts visible table rows
 *   5. Navigates to 3-4 key secondary routes and screenshots each
 *   6. Writes a structured JSON report to artifacts/data-population/
 */

import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://fcmanager.co.nz'
const OUT_DIR = path.join(process.cwd(), 'artifacts', 'data-population')
const DATA_WAIT_MS = 12_000   // wait after networkidle for async Supabase queries

// Routes to probe per role (beyond the landing page)
const GRAND_MASTER_ROUTES = [
  { name: 'platform',           path: '/platform' },
  { name: 'admin-dashboard',    path: '/admin/dashboard' },
  { name: 'compliance',         path: '/admin/compliance' },
  { name: 'patrol-zones',       path: '/admin/patrol-zones' },
]

const MASTER_ROUTES = [
  { name: 'admin-dashboard',    path: '/admin/dashboard' },
  { name: 'incidents',          path: '/admin/incidents' },
  { name: 'compliance',         path: '/admin/compliance' },
  { name: 'officers',           path: '/admin/officers' },
]

// ── helpers ────────────────────────────────────────────────────────────────

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"], input[name="password"]').first().fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click()
  // wait for redirect + initial data
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(DATA_WAIT_MS)
}

async function probeDataPopulation(page: any, label: string) {
  const url = page.url()

  // Stat card / KPI tile values: look for elements that commonly carry numbers
  // We look for elements inside common shadcn Card > CardContent patterns
  const statTexts: string[] = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(
      '[class*="card"] [class*="text-2xl"], [class*="card"] [class*="text-3xl"], ' +
      '[class*="stat"] span, [class*="kpi"] span, ' +
      'h2 + div, h3 + p'
    ))
    return cards
      .map((el) => (el as HTMLElement).innerText?.trim())
      .filter((t) => t && t.length > 0 && t !== '...' && t !== '--' && t !== 'N/A')
      .slice(0, 20)
  })

  // Count placeholder/skeleton indicators
  const skeletonCount = await page.locator('.animate-pulse, [data-skeleton], .skeleton').count().catch(() => 0)
  const ellipsisCount = await page.locator('text=...').count().catch(() => 0)

  // Heading text
  const headings: string[] = await page.locator('h1, h2').allTextContents().catch(() => [])

  // Table rows (real data rows, not header)
  const tableRowCount = await page.locator('tbody tr').count().catch(() => 0)

  // "No data" / empty state indicators
  const emptyStateCount = await page
    .getByText(/no data|no records|no results|nothing here|empty/i)
    .count()
    .catch(() => 0)

  // Check if data is actually loaded (non-zero stat cards found)
  const refreshingBanner = await page
    .getByText(/refreshing live data/i)
    .isVisible()
    .catch(() => false)

  // Check for any error toasts or error states
  const errorTexts: string[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(
      '[role="alert"], [class*="toast-error"], [class*="error"], [data-variant="destructive"]'
    ))
      .map((el) => (el as HTMLElement).innerText?.trim())
      .filter(Boolean)
      .slice(0, 5)
  })

  // Console errors (captured separately via page.on — just reading summary here)
  const hasLoadingState = skeletonCount > 3 || ellipsisCount > 3

  return {
    label,
    url,
    headings: headings.filter(Boolean),
    statTexts,
    skeletonCount,
    ellipsisCount,
    tableRowCount,
    emptyStateCount,
    refreshingBanner,
    errorTexts,
    dataPopulated: statTexts.length > 0 || tableRowCount > 0,
    loadingStillActive: hasLoadingState,
  }
}

async function screenshotRoute(
  page: any,
  routeName: string,
  accountLabel: string,
  outDir: string
): Promise<{ screenshotPath: string; probe: ReturnType<typeof probeDataPopulation> extends Promise<infer T> ? T : never }> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(5000)
  const screenshotFile = `${accountLabel}__${routeName}.png`
  const screenshotPath = path.join(outDir, screenshotFile)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const probe = await probeDataPopulation(page, routeName)
  return { screenshotPath: screenshotFile, probe }
}

// ── test suite ─────────────────────────────────────────────────────────────

test.describe('Two-login visual + data population', () => {
  test.setTimeout(180_000)

  const sqEmail = 'squires.don@live.com'
  const sqPassword = process.env.PLAYWRIGHT_BOB_PASSWORD || process.env.BOB_LOGIN_PASSWORD || ''
  const fsEmail = 'don.squires@firstsecurity.co.nz'
  const fsPassword = process.env.PLAYWRIGHT_MASTER_PASSWORD || process.env.TEST_LOGIN_MASTER_PASSWORD || ''

  test.beforeAll(() => {
    if (!sqPassword) throw new Error('Missing PLAYWRIGHT_BOB_PASSWORD / BOB_LOGIN_PASSWORD for squires.don@live.com')
    if (!fsPassword) throw new Error('Missing PLAYWRIGHT_MASTER_PASSWORD / TEST_LOGIN_MASTER_PASSWORD for don.squires@firstsecurity.co.nz')
    mkdirSync(OUT_DIR, { recursive: true })
  })

  test('squires.don@live.com — grand_master — platform + key routes', async ({ browser }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('console', (msg: any) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('response', (res: any) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`) })
    page.on('requestfailed', (req: any) => { failedRequests.push(`FAILED ${req.url()}`) })

    await login(page, sqEmail, sqPassword)

    const report: any = {
      account: sqEmail,
      role: 'grand_master',
      baseUrl: BASE,
      landingUrl: page.url(),
      routes: [] as any[],
      consoleErrors: [],
      failedRequests: [],
    }

    // probe each route
    for (const route of GRAND_MASTER_ROUTES) {
      if (page.url() !== `${BASE}${route.path}`) {
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
      }
      const { screenshotPath, probe } = await screenshotRoute(page, route.name, 'grand_master', OUT_DIR)
      report.routes.push({ ...probe, screenshotPath })
    }

    report.consoleErrors = consoleErrors.slice(0, 20)
    report.failedRequests = failedRequests.slice(0, 20)
    await ctx.close()

    writeFileSync(path.join(OUT_DIR, 'grand_master_report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log('\n── grand_master report ──\n' + JSON.stringify(report, null, 2))

    // Assertions
    expect(report.landingUrl).toContain('/platform')
    for (const r of report.routes) {
      expect(r.url, `Route ${r.label} redirected unexpectedly`).not.toContain('/login')
    }
  })

  test('don.squires@firstsecurity.co.nz — master — dashboard + key routes', async ({ browser }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('console', (msg: any) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('response', (res: any) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`) })
    page.on('requestfailed', (req: any) => { failedRequests.push(`FAILED ${req.url()}`) })

    await login(page, fsEmail, fsPassword)

    const report: any = {
      account: fsEmail,
      role: 'master',
      baseUrl: BASE,
      landingUrl: page.url(),
      routes: [] as any[],
      consoleErrors: [],
      failedRequests: [],
    }

    for (const route of MASTER_ROUTES) {
      if (page.url() !== `${BASE}${route.path}`) {
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
      }
      const { screenshotPath, probe } = await screenshotRoute(page, route.name, 'master', OUT_DIR)
      report.routes.push({ ...probe, screenshotPath })
    }

    report.consoleErrors = consoleErrors.slice(0, 20)
    report.failedRequests = failedRequests.slice(0, 20)
    await ctx.close()

    writeFileSync(path.join(OUT_DIR, 'master_report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log('\n── master report ──\n' + JSON.stringify(report, null, 2))

    // Assertions
    expect(report.landingUrl).toContain('/admin/dashboard')
    for (const r of report.routes) {
      expect(r.url, `Route ${r.label} redirected unexpectedly`).not.toContain('/login')
    }
  })
})
