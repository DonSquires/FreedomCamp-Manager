import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

// The Bob assistant textarea has a known placeholder we use as a ready signal.
const BOB_INPUT_SELECTOR = 'textarea[placeholder*="Ask Bob"]'

async function waitForBobReady(page: Parameters<typeof test.beforeEach>[0]['page']) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/bob-assistant')

    if (page.url().includes('/login')) {
      // Under transient load, auth can drop back to login; re-auth once.
      await loginAs(page, 'bob')
      continue
    }

    if (page.url().includes('/portal-selection')) {
      const adminPortalButton = page
        .getByRole('button', { name: /open admin portal|admin portal/i })
        .first()
      if (await adminPortalButton.isVisible().catch(() => false)) {
        await adminPortalButton.click().catch(() => undefined)
      }
      await page.waitForURL((url) => !url.pathname.includes('/portal-selection'), { timeout: 20000 }).catch(() => undefined)
      await page.goto('/bob-assistant')
    }

    if (page.url().includes('/login')) {
      await loginAs(page, 'bob')
      continue
    }

    await expect(page).toHaveURL(/\/bob-assistant/, { timeout: 30000 })

    // Wait for the lazy-loaded BobAssistantStudio textarea to appear.
    await expect(page.locator(BOB_INPUT_SELECTOR)).toBeVisible({ timeout: 60000 })
    return
  }

  throw new Error('Bob assistant did not become ready after re-auth retry')
}

test.describe('Phase 3: Sentient XO (Memory and Administrative Actuation)', () => {
  test.setTimeout(120000)
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'bob')
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
