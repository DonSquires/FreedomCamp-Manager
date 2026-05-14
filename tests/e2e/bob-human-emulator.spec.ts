import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

test.describe('Bob human emulator capability suite', () => {
  test.setTimeout(120000)
  test.describe.configure({ mode: 'serial' })

  test('Bob can read visual UI, reason on wording, and click controls', async ({ page }, testInfo) => {
    await loginAs(page, 'bob')

    await page.goto('/bob-assistant')
    await expect(page).toHaveURL(/\/bob-assistant/, { timeout: 30000 })
    await expect(page.locator(BOB_INPUT_SELECTOR)).toBeVisible({ timeout: 60000 })

    const dangerToggle = page.locator('#bob-danger-auto-assist')
    await expect(dangerToggle).toBeVisible({ timeout: 30000 })
    const beforeAria = await dangerToggle.getAttribute('aria-checked')
    await dangerToggle.click()
    await expect(dangerToggle).toHaveAttribute('aria-checked', beforeAria === 'true' ? 'false' : 'true')

    const bobInput = page.locator(BOB_INPUT_SELECTOR)
    await bobInput.fill('Summarize this page layout and confirm whether labels are clear for officers')
    await bobInput.press('Enter')
    await expect(page.locator('[class*="rounded-2xl"]').first()).toBeVisible({ timeout: 45000 })

    await bobAssessPage(page, testInfo, 'bob-human-emulator-assistant-visual')

    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 30000 })
    await expect(page.getByText(/priority actions/i).first()).toBeVisible({ timeout: 45000 })
    await expect(page.getByRole('button', { name: /^open welfare$/i })).toBeVisible({ timeout: 45000 })

    await bobAssessPage(page, testInfo, 'bob-human-emulator-admin-dashboard-visual')
  })

  test('Bob can operate PTT controls with human-like interaction checks', async ({ page }, testInfo) => {
    await loginAs(page, 'bob')

    await page.goto('/radio')
    await expect(page).toHaveURL(/\/radio/, { timeout: 30000 })
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 45000 })

    const pttButton = page.getByTestId('ptt-main-button').or(page.getByRole('button', { name: /push to talk/i })).first()
    await expect(pttButton).toBeVisible({ timeout: 45000 })

    const interpreterToggle = page.getByTestId('show-interpreter-toggle')
    if (await interpreterToggle.isVisible().catch(() => false)) {
      await interpreterToggle.click()
      const intercomSpeak = page.getByTestId('bob-intercom-speak-button')
      if (await intercomSpeak.isVisible().catch(() => false)) {
        await expect(intercomSpeak).toBeVisible({ timeout: 20000 })
      }
    }

    await pttButton.dispatchEvent('mousedown', { buttons: 1 })
    await page.waitForTimeout(200)
    await pttButton.dispatchEvent('mouseup')

    await bobAssessPage(page, testInfo, 'bob-human-emulator-ptt-visual')
  })

  test('Bob can write and enrich operational forms and report delivery fields', async ({ page }, testInfo) => {
    await loginAs(page, 'bob')

    await page.goto('/dispatch-wizard')
    await expect(page).toHaveURL(/\/dispatch-wizard/, { timeout: 30000 })
    await expect(page.getByRole('button', { name: /^next$/i })).toBeVisible({ timeout: 45000 })

    const noSites = await page.getByText(/no client sites found/i).isVisible().catch(() => false)
    if (!noSites) {
      const firstSite = page.locator('button').filter({ hasText: /./ }).first()
      if (await firstSite.isVisible().catch(() => false)) {
        await firstSite.click()
      }

      const nextButton = page.getByRole('button', { name: /^next$/i })
      if (await nextButton.isEnabled().catch(() => false)) {
        await nextButton.click()

        const jobTypeSelect = page.getByRole('combobox').first()
        if (await jobTypeSelect.isVisible().catch(() => false)) {
          await jobTypeSelect.click()
          const patrolOption = page.getByRole('option', { name: /patrol/i }).first()
          if (await patrolOption.isVisible().catch(() => false)) {
            await patrolOption.click()
          }
        }

        const callerName = page.locator('input[type="text"]').last()
        if (await callerName.isVisible().catch(() => false)) {
          await callerName.fill('Bob Operations Auto-Assistant')
        }

        const details = page.locator('textarea').first()
        if (await details.isVisible().catch(() => false)) {
          await details.fill('Report enrichment draft: officer observed non-compliant behavior near perimeter access point; recommend immediate follow-up patrol and evidence capture.')
          await expect(details).toHaveValue(/report enrichment draft/i)
        }
      }
    }

    await bobAssessPage(page, testInfo, 'bob-human-emulator-dispatch-form-writing')

    await page.goto('/incident-reports')
    await expect(page).toHaveURL(/\/incident-reports/, { timeout: 30000 })

    const viewDetailsButton = page.getByRole('button', { name: /view details/i }).first()
    if (await viewDetailsButton.isVisible().catch(() => false)) {
      await viewDetailsButton.click()
      await expect(page.getByText(/incident details/i).first()).toBeVisible({ timeout: 20000 })

      const newPersonButton = page.getByRole('button', { name: /new person/i }).first()
      if (await newPersonButton.isVisible().catch(() => false)) {
        await newPersonButton.click()
        const firstNameInput = page.getByPlaceholder('First name')
        await expect(firstNameInput).toBeVisible({ timeout: 15000 })
        await firstNameInput.fill('Bob')

        const notesTextarea = page.getByPlaceholder('Additional notes…')
        await notesTextarea.fill('Report enrichment: witness statement aligned to incident timeline; include location confidence and recommended follow-up action.')
        await expect(notesTextarea).toHaveValue(/report enrichment/i)
      }
    }

    await bobAssessPage(page, testInfo, 'bob-human-emulator-report-form-enrichment')
  })
})