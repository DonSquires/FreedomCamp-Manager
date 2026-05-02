import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Noise E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('noise control route loads for admin', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto('/noise-control', { waitUntil: 'networkidle' })

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/noise-control/)
    await expect(page.locator('h1, h2').filter({ hasText: /noise/i }).first()).toBeVisible({ timeout: 15000 })
  })

  test('noise jobs UI renders core controls', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto('/noise-control', { waitUntil: 'networkidle' })

    const hasIssueOrCreate = await page.locator('button').filter({ hasText: /new|create|add|notice|job/i }).first().isVisible().catch(() => false)
    const hasListSurface = await page.locator('table, [role="grid"], [data-slot="card"], .grid').first().isVisible().catch(() => false)
    expect(hasIssueOrCreate || hasListSurface).toBeTruthy()
  })
})
