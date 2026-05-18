import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Noise Control Officer E2E', () => {
  test.describe.configure({ mode: 'serial' })

  let jobTitle = `E2E Noise Test ${Date.now()}`
  let jobAddress = '123 Test Street'

  test('Admin creates and dispatches a noise job', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto('/noise-control', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/noise-control/)
    await page.getByRole('button', { name: /dispatch job/i }).click()
    await page.getByPlaceholder('Job Title').fill(jobTitle)
    await page.getByPlaceholder('Address').fill(jobAddress)
    await page.getByRole('button', { name: /dispatch job/i }).click()
    await expect(page.getByText('Job created and dispatched')).toBeVisible({ timeout: 5000 })
  })

  test('Officer receives and assesses the job', async ({ page }) => {
    await loginAs(page, 'officer')
    await page.goto('/noise-officer', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/noise-officer/)
    await expect(page.getByText(jobTitle)).toBeVisible({ timeout: 10000 })
    await page.getByText(jobTitle).click()
    // Simulate assessment (fill in required fields)
    await page.getByLabel(/volume/i).selectOption('3')
    await page.getByLabel(/time/i).selectOption('2')
    await page.getByLabel(/tone/i).selectOption('2')
    // AI/audio analysis (if present)
    const aiBtn = page.getByRole('button', { name: /analyze|ai|audio/i })
    if (await aiBtn.isVisible().catch(() => false)) {
      await aiBtn.click()
      await expect(page.getByText(/analysis complete|confidence/i)).toBeVisible({ timeout: 10000 })
    }
    // Select recommended action (e.g., Issue Abatement Notice)
    await page.getByRole('button', { name: /issue notice|abatement|direction|enforcement/i }).first().click()
    await expect(page.getByText(/notice issued|success/i)).toBeVisible({ timeout: 10000 })
  })

  test('Admin verifies notice and printout', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto('/noise-control', { waitUntil: 'networkidle' })
    await expect(page.getByText(jobTitle)).toBeVisible({ timeout: 10000 })
    await page.getByText(jobTitle).click()
    await expect(page.getByRole('button', { name: /print/i })).toBeVisible()
    // Optionally, download or print the notice
  })
})
