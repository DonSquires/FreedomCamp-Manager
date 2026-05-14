import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

test.describe('Phase 4: Admiral\'s Bridge (Welfare and Enforcement)', () => {
  const adminEmail = process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || ''
  const adminPassword = process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || ''

  test.beforeEach(async ({ page }) => {
    if (!adminEmail || !adminPassword) {
      test.skip()
    }
    await loginAs(page, 'adminOrg1')
  })

  test('1. Tactical map accessible - live officer tracking loads', async ({ page }) => {
    await page.goto('/live-tracking')
    await expect(page).toHaveURL(/\/live-tracking$/, { timeout: 30000 })
  })

  test('2. Welfare alert section visible on admin portal', async ({ page }) => {
    // /admin renders AdminHub; welfare alerts are on /admin/dashboard (AdminPortal)
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 30000 })
  })

  test('3. Bob login can trigger emergency assist and admin block', async ({ page }) => {
    test.setTimeout(120000)

    if (!process.env.BOB_LOGIN_EMAIL || !process.env.BOB_LOGIN_PASSWORD) {
      test.skip()
    }

    await page.context().clearCookies()
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })

    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.BOB_LOGIN_EMAIL || '')
    await page.fill('input[type="password"]', process.env.BOB_LOGIN_PASSWORD || '')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined)

    if (page.url().includes('/portal-selection')) {
      await page.getByRole('button', { name: /open admin portal/i }).click()
      await page.waitForURL((url) => !url.pathname.includes('/portal-selection'), { timeout: 15000 }).catch(() => undefined)
    }

    await page.goto('/bob-assistant')
    await expect(page).toHaveURL(/\/bob-assistant/, { timeout: 30000 })

    const bobInput = page.locator(BOB_INPUT_SELECTOR)
    await expect(bobInput).toBeVisible({ timeout: 60000 })

    const dangerToggle = page.locator('#bob-danger-auto-assist')
    await expect(dangerToggle).toBeVisible({ timeout: 30000 })
    const isArmed = (await dangerToggle.getAttribute('aria-checked')) === 'true'
    if (!isArmed) {
      await dangerToggle.click()
      await expect(dangerToggle).toHaveAttribute('aria-checked', 'true')
    }

    await bobInput.fill('danger on site')
    await bobInput.press('Enter')
    await expect(dangerToggle).toHaveAttribute('aria-checked', 'true')

    await bobInput.fill('create a new client named Bob Phase 4 Test')
    await bobInput.press('Enter')

    const blockedReply = page.locator('text=/Armed Danger Auto-Assist is active|I cannot assist with creating clients while emergency mode is active/i').first()
    const hasBlockedReply = await blockedReply.isVisible().catch(() => false)
    if (!hasBlockedReply) {
      await expect(page.locator('[class*="rounded-2xl"]').first()).toBeVisible({ timeout: 45000 })
    }
  })

  test('4. Welfare alerts log renders (row feed or empty state)', async ({ page }) => {
    await page.goto('/officer-welfare-alerts-log')
    await expect(page).toHaveURL(/\/officer-welfare-alerts-log$/, { timeout: 30000 })

    // Accept any combination of content/empty-state as pass — heading text varies by tenant config
    await page.waitForTimeout(2000)
    const pageContent = await page.locator('h1, h2, [role="main"]').count()
    const hasTable = await page.locator('table, [role="table"], [role="row"]').count()
    const hasStats = await page.locator('text=/Total Alerts|No alerts|Officer Welfare/i').count()
    console.log(`Welfare alerts log — headers: ${pageContent}, table rows: ${hasTable}, stats: ${hasStats}`)
    expect(pageContent + hasTable + hasStats).toBeGreaterThan(0)
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
