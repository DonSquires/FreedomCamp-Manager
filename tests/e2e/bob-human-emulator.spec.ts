import { test, expect } from './setup'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

async function navigateToUsers(page: Parameters<typeof test.beforeEach>[0]['page']) {
  await page.goto('/users', { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/portal-selection')) {
    const openAdminPortal = page.getByRole('button', { name: /open admin portal/i }).first()
    await expect(openAdminPortal).toBeVisible({ timeout: 30000 })
    await openAdminPortal.click()
    await page.waitForURL((url) => !url.pathname.includes('/portal-selection'), { timeout: 30000 })
    await page.goto('/users', { waitUntil: 'domcontentloaded' })
  }

  const createButton = page.getByRole('button', { name: /create.*user|new.*user|add.*user/i }).first()
  await expect(createButton).toBeVisible({ timeout: 30000 })
}

async function openCreateDialog(page: Parameters<typeof test.beforeEach>[0]['page']) {
  const createButton = page.getByRole('button', { name: /create.*user|new.*user|add.*user/i }).first()
  await expect(createButton).toBeVisible({ timeout: 30000 })
  await createButton.click()

  const dialog = page.getByRole('dialog').first()
  await expect(dialog.getByRole('heading', { name: /Create New User/i })).toBeVisible({ timeout: 30000 })
  return dialog
}

async function chooseOption(page: Parameters<typeof test.beforeEach>[0]['page'], optionName: string) {
  await page.getByRole('option', { name: new RegExp(`^${optionName}$`, 'i') }).click()
}

test.describe('Bob human emulator capability suite', () => {
  test.setTimeout(120000)
  test.describe.configure({ mode: 'serial' })

  test('enterprise sweep creates a user through the UI and keeps access controls visible', async ({ adminUser: page }, testInfo) => {
    const runId = Date.now()
    const createdEmail = `bob.enterprise.e2e+${runId}@example.com`

    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    await bobAssessPage(page, testInfo, 'bob-enterprise-user-management-dialog')

    await dialog.locator('#email').fill(createdEmail)
    await dialog.locator('#firstName').fill('Bob')
    await dialog.locator('#lastName').fill('Enterprise')

    const roleSelect = dialog.getByRole('combobox').first()
    await roleSelect.click()
    await chooseOption(page, 'Admin Officer')

    const jobTitleSelect = dialog.getByRole('combobox').nth(1)
    await jobTitleSelect.click()
    await chooseOption(page, 'Field Services Officer 🚗')
    await expect(dialog.getByText(/driver licence/i)).toBeVisible({ timeout: 15000 })

    await dialog.locator('#createPassword').fill('EnterpriseE2E!1')
    await dialog.locator('#createConfirmPassword').fill('EnterpriseE2E!1')

    const accessTab = dialog.getByRole('tab', { name: /access/i })
    await accessTab.click()
    await expect(dialog.getByText('Admin Dashboard')).toBeVisible({ timeout: 15000 })

    await dialog.locator('label').filter({ hasText: 'Admin Dashboard' }).click()

    const organisationSelect = dialog.getByRole('combobox').nth(2)
    const organisationTriggerVisible = await organisationSelect.isVisible().catch(() => false)
    if (organisationTriggerVisible) {
      await organisationSelect.click()
      const ironEagleOption = page.getByRole('option', { name: /iron\s*eagle/i }).first()
      const hasIronEagleOption = await ironEagleOption.isVisible().catch(() => false)
      if (hasIronEagleOption) {
        await ironEagleOption.click()
      } else {
        const orgOptions = page.getByRole('option')
        const optionCount = await orgOptions.count()
        if (optionCount > 1) {
          await orgOptions.nth(1).click()
        }
      }
    }

    const submitButton = dialog.getByRole('button', { name: /create user/i })
    await expect(submitButton).toBeEnabled({ timeout: 15000 })
    await submitButton.click()

    const errorToast = page.getByText(/failed to create user|already exists|timed out|request timed out/i).first()
    await expect(errorToast).toHaveCount(0, { timeout: 5000 })
    await expect(dialog).toBeHidden({ timeout: 70000 })

    const searchInput = page.getByPlaceholder(/search by name or email/i).first()
    await expect(searchInput).toBeVisible({ timeout: 15000 })
    await searchInput.fill(createdEmail)
    await expect(page.getByText(createdEmail)).toBeVisible({ timeout: 30000 })
  })

  test('Bob quick chat popup opens, replies, and preserves session on reopen', async ({ page }) => {
    await loginAs(page, 'bob')
    await page.goto('/admin/dashboard')

    await page.route('**/functions/v1/onspace-ai-chat', async (route) => {
      const corsHeaders = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-timezone',
      }

      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders, body: 'ok' })
        return
      }

      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          response: 'Constructed response: Patrol update noted. Proceeding with operational guidance.',
        }),
      })
    })

    const askBobFab = page.getByTitle('Ask Bob — operational assistant').or(page.getByRole('button', { name: /ask bob/i })).first()
    await expect(askBobFab).toBeVisible({ timeout: 30000 })
    await askBobFab.click()

    await expect(page.getByText('Bob Chat')).toBeVisible({ timeout: 15000 })
    const quickInput = page.getByPlaceholder('Ask a quick question...')
    await expect(quickInput).toBeVisible({ timeout: 15000 })

    const prompt = 'What is the safest next patrol step for Queen Street tonight?'
    await quickInput.fill(prompt)
    await quickInput.press('Enter')

    await expect(page.getByText(prompt)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Constructed response: Patrol update noted. Proceeding with operational guidance.')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/I hit an error while responding/i)).toHaveCount(0)

    await page.getByRole('button', { name: /close bob quick chat/i }).click()
    await expect(page.getByText('Bob Chat')).toBeHidden({ timeout: 10000 })

    await askBobFab.click()
    await expect(page.getByText('Bob Chat')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(prompt)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Constructed response: Patrol update noted. Proceeding with operational guidance.')).toBeVisible({ timeout: 10000 })
  })

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