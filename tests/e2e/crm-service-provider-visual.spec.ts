import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

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

test.describe('CRM full visual provisioning and module sweep', () => {
  test.describe.configure({ mode: 'serial' })

  test('create new service provider visually', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/organizations')
    await page.waitForLoadState('networkidle').catch(() => undefined)

    const uniqueName = `Visual SP ${Date.now().toString().slice(-6)}`

    await page.getByRole('button', { name: /new organisation/i }).click()
    await expect(page.getByRole('dialog', { name: /new organisation/i })).toBeVisible()

    await page.locator('#createName').fill(uniqueName)
    await page.locator('#createOrgType').click()
    await page.getByRole('option', { name: /service provider/i }).first().click()

    await page.locator('#createParentOrg').click()
    const firstParent = page.getByRole('option').filter({ hasText: /owner|service provider|client|contractor/i }).first()
    await firstParent.click()

    await page.getByRole('button', { name: /create organisation/i }).click()

    await expect(page.getByRole('dialog', { name: /new organisation/i })).toBeHidden({ timeout: 20000 })

    await page.getByPlaceholder(/search organisations/i).fill(uniqueName)
    await expect(page.getByText(uniqueName).first()).toBeVisible({ timeout: 20000 })

    await page.screenshot({ path: testInfo.outputPath('01-created-service-provider.png'), fullPage: true })
  })

  test('visual route sweep for CRM and enabled modules', async ({ page }, testInfo) => {
    await loginAs(page, 'master')

    for (const route of CRM_SERVICE_ROUTES) {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })

      await test.step(`visit ${route}`, async () => {
        await page.goto(route)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(800)

        const body = await page.locator('body').innerText().catch(() => '')
        expect(body).not.toContain('Application error')
        expect(body).not.toContain('Cannot read properties of')

        const screenshotName = route.replace(/\//g, '_').replace(/^_/, '') || 'root'
        await page.screenshot({ path: testInfo.outputPath(`route-${screenshotName}.png`), fullPage: true })

        const criticalErrors = consoleErrors.filter((e) => {
          const lower = e.toLowerCase()
          return !lower.includes('favicon') && !lower.includes('failed to fetch')
        })
        expect(criticalErrors, `critical console errors on ${route}`).toEqual([])
      })
    }
  })
})
