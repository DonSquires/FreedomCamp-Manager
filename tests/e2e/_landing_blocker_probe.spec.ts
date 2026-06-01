import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://fcmanager.co.nz'

type ProbeResult = {
  email: string
  finalUrl: string
  spinnerVisible: boolean
  placeholderCount: number
  consoleErrors: string[]
  failedRequests: Array<{ url: string; status: number | null; failureText: string | null }>
}

async function loginAndProbe(page: any, email: string, password: string): Promise<ProbeResult> {
  const consoleErrors: string[] = []
  const failedRequests: Array<{ url: string; status: number | null; failureText: string | null }> = []

  page.on('console', (msg: any) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  page.on('response', async (res: any) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), status: res.status(), failureText: null })
    }
  })

  page.on('requestfailed', (req: any) => {
    failedRequests.push({ url: req.url(), status: null, failureText: req.failure()?.errorText || null })
  })

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"], input[name="password"]').first().fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click()

  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(4000)

  const spinnerVisible = await page.locator('.animate-spin,[data-loading="true"]').first().isVisible().catch(() => false)
  const placeholderCount = await page.locator('text=...').count().catch(() => 0)

  return {
    email,
    finalUrl: page.url(),
    spinnerVisible,
    placeholderCount,
    consoleErrors,
    failedRequests,
  }
}

test('probe landing blockers for exact credentials', async ({ browser }) => {
  const outDir = path.join(process.cwd(), 'artifacts', 'landing-shots')
  mkdirSync(outDir, { recursive: true })

  const sqEmail = 'squires.don@live.com'
  const sqPassword = process.env.PLAYWRIGHT_BOB_PASSWORD || process.env.BOB_LOGIN_PASSWORD || ''
  const fsEmail = 'don.squires@firstsecurity.co.nz'
  const fsPassword = process.env.PLAYWRIGHT_MASTER_PASSWORD || process.env.TEST_LOGIN_MASTER_PASSWORD || ''

  if (!sqPassword) throw new Error('Missing password for squires.don@live.com (PLAYWRIGHT_BOB_PASSWORD/BOB_LOGIN_PASSWORD)')
  if (!fsPassword) throw new Error('Missing password for don.squires@firstsecurity.co.nz (PLAYWRIGHT_MASTER_PASSWORD/TEST_LOGIN_MASTER_PASSWORD)')

  const ctx1 = await browser.newContext()
  const page1 = await ctx1.newPage()
  const r1 = await loginAndProbe(page1, sqEmail, sqPassword)
  await page1.screenshot({ path: path.join(outDir, 'squires-don-live-landing-fcmanager.png'), fullPage: true })
  await ctx1.close()

  const ctx2 = await browser.newContext()
  const page2 = await ctx2.newPage()
  const r2 = await loginAndProbe(page2, fsEmail, fsPassword)
  await page2.screenshot({ path: path.join(outDir, 'don-squires-firstsecurity-landing-fcmanager.png'), fullPage: true })
  await ctx2.close()

  const payload = { baseUrl: BASE_URL, results: [r1, r2] }
  writeFileSync(path.join(outDir, 'landing-blocker-probe.json'), JSON.stringify(payload, null, 2), 'utf8')
  console.log(JSON.stringify(payload, null, 2))
})
