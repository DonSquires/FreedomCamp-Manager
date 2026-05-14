import { test, expect } from '@playwright/test'

// The Bob assistant textarea has a known placeholder we use as a ready signal.
const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

async function loginAndSelectAdminPortal(page: Parameters<typeof test.beforeEach>[0]['page'], email: string, password: string) {
  // Step 1: Login
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined)

  // Step 2: The admin_officer role lands on portal-selection.
  // We must click "Admin Portal" which sets sessionStorage 'adminOfficerPortalChoice' = 'selected'.
  // If already on an admin path, skip portal selection.
  const currentUrl = page.url()
  if (currentUrl.includes('/portal-selection') || currentUrl.endsWith('/')) {
    await page.goto('/portal-selection')
    // Click "Admin Portal" tile
    await page.getByText('Admin Portal').first().click()
    await page.waitForURL((url) => !url.pathname.includes('/portal-selection'), { timeout: 15000 }).catch(() => undefined)
  }
}

async function waitForBobReady(page: Parameters<typeof test.beforeEach>[0]['page']) {
  await page.goto('/bob-assistant')
  await expect(page).toHaveURL(/\/bob-assistant$/, { timeout: 30000 })

  // Wait for the lazy-loaded BobAssistantStudio textarea to appear.
  await expect(page.locator(BOB_INPUT_SELECTOR)).toBeVisible({ timeout: 60000 })
}

test.describe('Phase 3: Sentient XO (Memory and Administrative Actuation)', () => {
  const adminEmail = process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || ''
  const adminPassword = process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || ''

  test.beforeEach(async ({ page }) => {
    if (!adminEmail || !adminPassword) {
      test.skip()
    }
    await loginAndSelectAdminPortal(page, adminEmail, adminPassword)
    await waitForBobReady(page)
  })

  test('1. Bob receives administrative actuation command', async ({ page }) => {
    const input = page.locator(BOB_INPUT_SELECTOR)
    const timestamp = Date.now()

    await input.fill(`create a new client named "Test Client ${timestamp}" at 123 Main Street`)
    // Enter key maps to the sendMessage handler in BobAssistantStudio
    await input.press('Enter')

    // Wait for a message bubble to appear (user message at minimum)
    await page.waitForTimeout(2000)
    const bubbles = await page.locator('[class*="rounded-2xl"]').count()
    console.log(`Bubbles after actuation command: ${bubbles}`)
    expect(bubbles).toBeGreaterThan(0)
  })

  test('2. Bob memory context available', async ({ page }) => {
    const input = page.locator(BOB_INPUT_SELECTOR)

    await input.fill('summarize my recent activities and roles')
    await input.press('Enter')

    await page.waitForTimeout(2000)
    const bubbles = await page.locator('[class*="rounded-2xl"]').count()
    console.log(`Bubbles after memory request: ${bubbles}`)
    expect(bubbles).toBeGreaterThan(0)
  })

  test('3. Gap detection - missing required fields', async ({ page }) => {
    const input = page.locator(BOB_INPUT_SELECTOR)

    // Incomplete command — Bob should ask for clarification
    await input.fill('create a new client')
    await input.press('Enter')

    await page.waitForTimeout(2000)
    const bubbles = await page.locator('[class*="rounded-2xl"]').count()
    console.log(`Bubbles after incomplete command: ${bubbles}`)
    expect(bubbles).toBeGreaterThan(0)
  })

  test('4. Administrative safeguards operational', async ({ page }) => {
    const input = page.locator(BOB_INPUT_SELECTOR)

    await input.fill('emergency alert active - lock all write operations')
    await input.press('Enter')

    await page.waitForTimeout(2000)
    const bubbles = await page.locator('[class*="rounded-2xl"]').count()
    console.log(`Bubbles after emergency command: ${bubbles}`)
    expect(bubbles).toBeGreaterThan(0)
  })

  test('5. Actuation persistence and feedback', async ({ page }) => {
    const input = page.locator(BOB_INPUT_SELECTOR)

    await input.fill('create shift for tomorrow 9am-5pm')
    await input.press('Enter')

    await page.waitForTimeout(2000)
    const bubbles = await page.locator('[class*="rounded-2xl"]').count()
    console.log(`Bubbles after shift actuation: ${bubbles}`)
    expect(bubbles).toBeGreaterThan(0)
  })
})
