import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Route contract alias parity', () => {
  test('admin canonical routes remain accessible', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/compliance', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/compliance$/)

    await page.goto('/compliance-analytics', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/compliance-analytics$/)

    await page.goto('/enforcement-command-center', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/enforcement-command-center$/)

    await page.goto('/reports', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/reports$/)
  })

  test('legacy aliases redirect to canonical routes', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/admin/compliance', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/compliance$/)

    await page.goto('/admin/compliance-analytics', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/compliance-analytics$/)

    await page.goto('/enforcement-command-centre', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/enforcement-command-center$/)

    await page.goto('/reports-hub', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/reports$/)
  })
})
