import { test, expect } from '@playwright/test'

const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

async function loginAndSelectAdminPortal(page: Parameters<typeof test.beforeEach>[0]['page'], email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').evaluate((input, value) => {
    const element = input as HTMLInputElement
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, email)
  await page.locator('input[type="password"]').evaluate((input, value) => {
    const element = input as HTMLInputElement
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, password)
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined)

  const currentUrl = page.url()
  if (currentUrl.includes('/portal-selection') || currentUrl.endsWith('/')) {
    await page.goto('/portal-selection')
    await page.getByText('Admin Portal').first().click()
    await page.waitForURL((url) => !url.pathname.includes('/portal-selection'), { timeout: 15000 }).catch(() => undefined)
  }
}

test.describe('Phase 4: Admiral\'s Bridge (Welfare and Enforcement)', () => {
  const adminEmail = process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || ''
  const adminPassword = process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || ''

  test.beforeEach(async ({ page }) => {
    if (!adminEmail || !adminPassword) {
      test.skip()
    }
    await loginAndSelectAdminPortal(page, adminEmail, adminPassword)
  })

  test('1. Tactical map accessible - live officer tracking loads', async ({ page }) => {
    await page.goto('/live-tracking')
    await expect(page).toHaveURL(/\/live-tracking$/, { timeout: 30000 })

    // Wait for auth loading to complete — "Total Officers" card is always rendered
    // (whether there are officers or not) once the component mounts
    await expect(page.locator('text=Total Officers').first()).toBeVisible({ timeout: 45000 })
  })

  test('2. Welfare alert section visible on admin portal', async ({ page }) => {
    // /admin renders AdminHub; welfare alerts are on /admin/dashboard (AdminPortal)
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 30000 })

    // AdminPortal renders "N welfare alerts" in Priority actions bar
    await expect(page.locator('text=/welfare alert/i').first()).toBeVisible({ timeout: 45000 })
  })

  test('3. Officer SOS hold triggers welfare emergency alert', async ({ page }) => {
    const bobEmail = process.env.BOB_LOGIN_EMAIL || ''
    const bobPassword = process.env.BOB_LOGIN_PASSWORD || ''
    if (!bobEmail || !bobPassword) {
      test.skip()
    }

    await loginAndSelectAdminPortal(page, bobEmail, bobPassword)
    await page.goto('/bob-assistant')
    await expect(page).toHaveURL(/\/bob-assistant/, { timeout: 30000 })

    const bobInput = page.locator(BOB_INPUT_SELECTOR)
    await expect(bobInput).toBeVisible({ timeout: 60000 })

    const dangerToggle = page.locator('#bob-danger-auto-assist')
    await expect(dangerToggle).toBeVisible({ timeout: 30000 })
    if (!(await dangerToggle.isChecked())) {
      await dangerToggle.click()
    }

    await bobInput.fill('danger on site')
    await bobInput.press('Enter')
    await expect(page.locator('text=/Emergency assist pending: calling in/i').first()).toBeVisible({ timeout: 15000 })

    await bobInput.fill('create a new client named Bob Phase 4 Test')
    await bobInput.press('Enter')
    await expect(page.locator('text=/Armed Danger Auto-Assist is active/i').first()).toBeVisible({ timeout: 15000 })
  })

  test('4. Welfare alerts log renders (row feed or empty state)', async ({ page }) => {
    await page.goto('/officer-welfare-alerts-log')
    await expect(page).toHaveURL(/\/officer-welfare-alerts-log$/, { timeout: 30000 })

    await expect(page.locator('text=Officer Welfare Alerts Log').first()).toBeVisible({ timeout: 45000 })
    await expect(page.locator('text=Total Alerts').first()).toBeVisible({ timeout: 45000 })
    await expect(page.locator('text=Open').first()).toBeVisible({ timeout: 45000 })
  })

  test('5. Welfare escalation path navigates to officer welfare page', async ({ page }) => {
    await page.goto('/officer-welfare')
    await expect(page).toHaveURL(/\/officer-welfare/, { timeout: 30000 })

    // Page must load some content — header or table or empty state
    await page.waitForTimeout(2000)
    const pageContent = await page.locator('h1, h2, [role="main"]').count()
    const hasTable = await page.locator('table, [role="table"], [role="row"]').count()
    const hasEmptyState = await page.locator('text=/no.*welfare|welfare.*alert|officer.*welfare/i').count()
    console.log(`Headers: ${pageContent}, Table rows: ${hasTable}, Empty state: ${hasEmptyState}`)
    
    expect(pageContent + hasTable + hasEmptyState).toBeGreaterThan(0)
  })
})
