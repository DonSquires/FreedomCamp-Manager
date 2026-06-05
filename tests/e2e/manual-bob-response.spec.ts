import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Manual Bob conversation response', () => {
  test.setTimeout(180000)

  test('gets a live response from Bob chat UI', async ({ page }) => {
    const prompt = `Bob live response check ${Date.now()}: give one short patrol guidance sentence.`

    await loginAs(page, 'grandmaster')
    await page.goto('/bob-assistant', { waitUntil: 'domcontentloaded' })

    const chatInput = page
      .locator('textarea[placeholder*="Ask Bob" i], textarea[placeholder*="quick question" i], [data-testid="bob-chat-input"]')
      .first()

    await expect(chatInput).toBeVisible({ timeout: 30000 })
    await chatInput.fill(prompt)
    await chatInput.press('Enter')

    await expect(page.getByText(new RegExp(escapeRegex(prompt), 'i')).first()).toBeVisible({ timeout: 30000 })

    const assistantMessage = page
      .locator(
        '[data-testid="assistant-message"], [data-role="assistant"], .assistant-message, .chat-message.assistant, [class*="assistant"]'
      )
      .filter({ hasNotText: new RegExp(escapeRegex(prompt), 'i') })
      .last()

    await expect(assistantMessage).toBeVisible({ timeout: 120000 })

    const responseTextRaw = (await assistantMessage.innerText()).trim()
    const responseText = responseTextRaw.replace(/\s+/g, ' ').trim()

    expect(responseText.length).toBeGreaterThan(0)

    // Printed for terminal capture so the operator can read Bob's reply directly.
    console.log(`BOB_RESPONSE: ${responseText}`)
  })
})
