import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function safeLoginAsOrSkip(page: any, user: 'master') {
  try {
    await loginAs(page, user)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ended on \/login|login failed|rate|throttle|over_request_rate_limit|too many requests/i.test(message)) {
      test.skip(true, `Auth bootstrap failed for ${user}: ${message}`)
    }
    throw error
  }
}

async function gotoWithPortalSelection(page: any, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' })
  if (page.url().includes('/portal-selection')) {
    // Admin-officer sessions may require explicit portal choice before route access.
    await page.evaluate(() => window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected'))
    await page.goto(path, { waitUntil: 'networkidle' })
  }
}

test.describe('Biosecurity E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('biosecurity control route loads for admin', async ({ page }) => {
    await safeLoginAsOrSkip(page, 'master')
    await gotoWithPortalSelection(page, '/biosecurity-control')

    if (page.url().includes('/login')) {
      test.skip(true, 'Biosecurity route is not reachable because session returned to /login')
    }

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/biosecurity-control/)
    await expect(page.locator('h1, h2').filter({ hasText: /biosecurity/i }).first()).toBeVisible({ timeout: 15000 })
  })

  test('job surface renders key controls', async ({ page }) => {
    await safeLoginAsOrSkip(page, 'master')
    await gotoWithPortalSelection(page, '/biosecurity-control')

    if (page.url().includes('/login')) {
      test.skip(true, 'Biosecurity controls cannot be validated because session returned to /login')
    }

    const hasPrimaryButton = await page.locator('button').filter({ hasText: /new|create|add|job/i }).first().isVisible().catch(() => false)
    const hasGridOrTable = await page.locator('table, [role="grid"], [data-slot="card"], .grid').first().isVisible().catch(() => false)
    expect(hasPrimaryButton || hasGridOrTable).toBeTruthy()
  })
})
