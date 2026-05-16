import { test, expect } from './e2e/setup'

test.describe('Monitoring pulse – live monitoring routes', () => {

  test('dispatch monitor shell renders for an authenticated admin', async ({ adminUser: page }) => {
    await page.goto('/dispatch-monitor')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Dispatch Monitor' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/live despatch status dashboard/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({ timeout: 10000 })
  })

  test('alarm events view renders the active monitoring queue surface', async ({ adminUser: page }) => {
    await page.goto('/alarm-events')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Alarm Events' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/inbound alarm events from connected security systems/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({ timeout: 10000 })
  })
})
