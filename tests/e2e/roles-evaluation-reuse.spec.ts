import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

function parseChannelTriplet(value: string): [number, number, number] {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const parts = normalized.split(' ')
  if (parts.length !== 3) {
    throw new Error(`Unexpected token format: ${value}`)
  }

  const hue = Number(parts[0])
  const sat = Number(parts[1].replace('%', ''))
  const light = Number(parts[2].replace('%', ''))

  return [hue, sat, light]
}

function boxesDoNotOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const aLeft = a.x
  const aRight = a.x + a.width
  const aTop = a.y
  const aBottom = a.y + a.height

  const bLeft = b.x
  const bRight = b.x + b.width
  const bTop = b.y
  const bBottom = b.y + b.height

  return aRight <= bLeft || bRight <= aLeft || aBottom <= bTop || bBottom <= aTop
}

test.describe('Role Evaluation Reuse Suite', () => {
  test('QA: login visual baseline remains stable', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible()

    await expect(page).toHaveScreenshot('role-qa-login-full.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    })
  })

  test('UX: login meets axe-core critical accessibility checks', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const severeViolations = accessibilityScanResults.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact || '')
    )

    expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual([])
  })

  test('UX: mobile login controls are visible, clickable, and non-overlapping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    const submitButton = page.getByRole('button', { name: /sign in/i }).first()

    await expect(emailInput).toBeVisible()
    await expect(passwordInput).toBeVisible()
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeEnabled()

    const emailBox = await emailInput.boundingBox()
    const passwordBox = await passwordInput.boundingBox()
    const submitBox = await submitButton.boundingBox()

    expect(emailBox).not.toBeNull()
    expect(passwordBox).not.toBeNull()
    expect(submitBox).not.toBeNull()

    if (!emailBox || !passwordBox || !submitBox) {
      throw new Error('Critical login controls are missing render boxes on mobile viewport')
    }

    expect(boxesDoNotOverlap(emailBox, passwordBox)).toBe(true)
    expect(boxesDoNotOverlap(passwordBox, submitBox)).toBe(true)
  })

  test('PM: dark theme tokens match Iron Eagle baseline on login', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const tokenValues = await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      const styles = getComputedStyle(document.documentElement)
      return {
        background: styles.getPropertyValue('--background').trim(),
        primary: styles.getPropertyValue('--primary').trim(),
        mutedForeground: styles.getPropertyValue('--muted-foreground').trim(),
      }
    })

    expect(parseChannelTriplet(tokenValues.background)).toEqual([0, 0, 7])
    expect(parseChannelTriplet(tokenValues.primary)).toEqual([0, 64, 50])
    expect(parseChannelTriplet(tokenValues.mutedForeground)).toEqual([0, 0, 62])
  })

  test('PM: login surface presents Iron Eagle product branding', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/Field Compliance Manager|FieldOps Manager/i).first()).toBeVisible()
    await expect(page.locator('img[alt*="Iron Eagle" i]').first()).toBeVisible()
  })
})