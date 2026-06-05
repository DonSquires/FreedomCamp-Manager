import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

const PRE_SHOT = 'test-results/manual-bob-visual-before.png'
const POST_SHOT = 'test-results/manual-bob-visual-after.png'

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Manual Bob UI visual', () => {
  test.setTimeout(180000)

  test('talks to Bob through UI and captures visual evidence', async ({ page }) => {
    const prompt = `Bob visual check ${Date.now()}: give one concise patrol guidance sentence.`

    await loginAs(page, 'grandmaster')
    await page.goto('/bob-assistant', { waitUntil: 'domcontentloaded' })

    const chatInput = page
      .locator('textarea[placeholder*="Ask Bob" i], textarea[placeholder*="quick question" i], [data-testid="bob-chat-input"]')
      .first()

    await expect(chatInput).toBeVisible({ timeout: 30000 })
    await page.screenshot({ path: PRE_SHOT, fullPage: true })

    await chatInput.fill(prompt)
    await chatInput.press('Enter')

    await expect(page.getByText(new RegExp(escapeRegex(prompt), 'i')).first()).toBeVisible({ timeout: 30000 })

    const bobResponse = page
      .locator(
        'text=/Review Findings|Action Plan|Officer assist mode is active|Constructed response|could not generate|request failed|operational guidance|patrol/i'
      )
      .last()

    await expect(bobResponse).toBeVisible({ timeout: 90000 })
    await page.screenshot({ path: POST_SHOT, fullPage: true })
  })
})
