import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

const LIVE_CLIENT_ORG = process.env.PLAYWRIGHT_LIVE_CLIENT_ORG?.trim() || 'Nelson City Council'
const LIVE_PROVIDER_ORG = process.env.PLAYWRIGHT_LIVE_PROVIDER_ORG?.trim() || 'First Security - Nelson'

const CRM_SERVICE_ROUTES = [
  '/crm',
  '/organizations',
  '/admin/service-provider-access',
  '/pricing',
  '/roster',
  '/availability',
  '/officer-skills',
  '/dispatch',
  '/dispatch-monitor',
  '/dispatch-wizard',
  '/dispatched-jobs',
  '/radio',
  '/radio?mode=dispatch',
  '/officer-welfare',
  '/live-tracking',
  '/live-patrol',
  '/patrol-schedule',
  '/patrol-kpis',
  '/patrol-checkpoints',
  '/parking',
  '/parking-officer',
  '/site-guard',
  '/access-control',
  '/noise-control',
  '/noise-officer',
  '/smoke-control',
  '/smoke-officer',
  '/biosecurity-control',
  '/biosecurity-officer',
  '/ems',
  '/operations-map',
  '/client-sites',
]

test.use({ screenshot: 'on', video: 'on' })

test.describe('CRM full visual provisioning and module sweep', () => {
  test.describe.configure({ mode: 'serial' })

  test('validate live client and service provider visually', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/organizations')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    const searchInput = page.getByPlaceholder(/search organisations/i)

    await searchInput.fill(LIVE_CLIENT_ORG)
    await expect(page.getByText(LIVE_CLIENT_ORG).first()).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: testInfo.outputPath('01-live-client-organization.png'), fullPage: true })

    await searchInput.fill(LIVE_PROVIDER_ORG)
    await expect(page.getByText(LIVE_PROVIDER_ORG).first()).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: testInfo.outputPath('02-live-service-provider.png'), fullPage: true })
  })

  test('visual route sweep for CRM and enabled modules', async ({ page }, testInfo) => {
    test.setTimeout(180000)
    await loginAs(page, 'master')

    const routeIssues: Array<{ route: string; consoleErrors: string[]; bodySnippet: string }> = []

    for (const route of CRM_SERVICE_ROUTES) {
      const consoleErrors: string[] = []
      const handleConsole = (msg: { type: () => string; text: () => string }) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      }
      page.on('console', handleConsole)

      await test.step(`visit ${route}`, async () => {
        let body = ''
        let screenshotError = ''
        let stepError = ''

        try {
          await page.goto(route)
          await page.waitForLoadState('networkidle').catch(() => undefined)
          await page.waitForTimeout(800)

          body = await page.locator('body').innerText().catch(() => '')

          const screenshotName = route.replace(/\//g, '_').replace(/^_/, '') || 'root'
          await page.screenshot({ path: testInfo.outputPath(`route-${screenshotName}.png`), fullPage: true })

          // Ask Bob to review wording + layout for this route.
          await bobAssessPage(page, testInfo, `crm-${screenshotName}`)
        } catch (error) {
          stepError = error instanceof Error ? error.message : String(error)
          if (stepError.toLowerCase().includes('screenshot')) {
            screenshotError = stepError
          }
        }

        const hasBodyError = body.includes('Application error') || body.includes('Cannot read properties of')

        const criticalErrors = consoleErrors.filter((e) => {
          const lower = e.toLowerCase()
          return !lower.includes('favicon') && !lower.includes('failed to fetch')
        })

        if (hasBodyError || criticalErrors.length > 0 || screenshotError || stepError) {
          const issueText = [stepError, screenshotError].filter(Boolean).join(' | ')
          routeIssues.push({
            route,
            consoleErrors: issueText ? [...criticalErrors, issueText] : criticalErrors,
            bodySnippet: body.slice(0, 1200),
          })
        }
      })

      page.off('console', handleConsole)
    }

    if (routeIssues.length > 0) {
      await testInfo.attach('crm-route-sweep-issues.json', {
        body: Buffer.from(JSON.stringify(routeIssues, null, 2)),
        contentType: 'application/json',
      })

      testInfo.annotations.push({
        type: 'warning',
        description: `Captured ${routeIssues.length} route issue(s). Review screenshots/video + crm-route-sweep-issues.json evidence.`,
      })
    }
  })
})
