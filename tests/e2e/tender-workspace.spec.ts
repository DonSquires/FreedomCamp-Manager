import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Tender & Document Workspace', () => {
  test('admin can load tender workspace and open create dialog', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/tender-workspace', { waitUntil: 'networkidle' })

    // Primary page identity
    await expect(page.locator('h1, h2, [data-testid="page-title"]').filter({ hasText: /Tender & Document Workspace|Tender Workspace/i }).first())
      .toBeVisible({ timeout: 15000 })

    // Core action for starting a workflow
    const newButton = page.locator('button').filter({ hasText: /New Tender \/ Document|New Tender|New Document/i }).first()
    await expect(newButton).toBeVisible({ timeout: 10000 })
    await newButton.click({ force: true })

    // Modal/dialog should open
    const dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 8000 })

    // Ensure key input fields are present
    await expect(dialog.locator('input, textarea').first()).toBeVisible({ timeout: 8000 })
  })

  test('admin can open an existing tender when one is listed', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/tender-workspace', { waitUntil: 'networkidle' })

    const docCards = page.locator('button, a').filter({ hasText: /Tender Response|Tender Application|proposal|document/i })
    const count = await docCards.count()

    if (count === 0) {
      test.info().annotations.push({
        type: 'info',
        description: 'No existing tender documents were available in this test environment.',
      })
      return
    }

    await docCards.first().click({ force: true })
    await page.waitForLoadState('networkidle').catch(() => undefined)

    await expect(page).toHaveURL(/\/tender-workspace\//)
    await expect(page.locator('main')).toBeVisible()
  })
})
