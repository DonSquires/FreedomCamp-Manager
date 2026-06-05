import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

function firstSnippet(value: string, size = 24): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.slice(0, Math.min(size, compact.length))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isBobPostResponse(response: import('@playwright/test').Response): boolean {
  if (response.request().method() !== 'POST') return false
  const url = response.url()
  return url.includes('/functions/v1/ask-bob') || url.includes('/functions/v1/onspace-ai-chat')
}

async function unlockSessionIfPrompted(page: import('@playwright/test').Page): Promise<void> {
  const heading = page.getByRole('heading', { name: /session timed out/i }).first()
  const locked = await heading.isVisible({ timeout: 1200 }).catch(() => false)
  if (!locked) return

  const unlockPassword =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!unlockPassword) {
    throw new Error('Session lock detected but no unlock password env var is available')
  }

  const input = page
    .locator('input[placeholder*="unlock" i], input[placeholder*="password" i], input[type="password"]')
    .first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(unlockPassword)

  const unlockButton = page.getByRole('button', { name: /log back in|unlock/i }).first()
  await expect(unlockButton).toBeEnabled({ timeout: 5000 })
  await unlockButton.click({ force: true })
  await expect(heading).toBeHidden({ timeout: 20000 }).catch(() => undefined)
}

test.describe('Manual Bob chat points verification', () => {
  test.setTimeout(240000)

  test('all Bob chat entry points accept input and return answers', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('e2e:session-timeout-ms', String(24 * 60 * 60 * 1000))
        window.localStorage.setItem('e2e:session-warning-seconds', '7200')
      } catch {
        // ignore storage restrictions
      }
    })

    await loginAs(page, 'grandmaster')
    await unlockSessionIfPrompted(page)

    // Alias routes must resolve to Bob Assistant.
    for (const alias of ['/bob', '/bob-studio', '/bob/assistant-studio']) {
      await page.goto(alias, { waitUntil: 'domcontentloaded' })
      await unlockSessionIfPrompted(page)
      await expect(page).toHaveURL(/\/bob-assistant$/, { timeout: 30000 })
      await expect(page.locator('textarea[placeholder="Ask Bob anything operational…"]').first()).toBeVisible({ timeout: 30000 })
    }

    // 1) Bob Assistant Studio chat (ask-bob endpoint)
    await page.goto('/bob-assistant', { waitUntil: 'domcontentloaded' })
    await unlockSessionIfPrompted(page)
    const studioInput = page.locator('textarea[placeholder="Ask Bob anything operational…"]').first()
    await expect(studioInput).toBeVisible({ timeout: 30000 })

    const studioPrompt = 'Create new client site staging draft for Nelson test.'

    await studioInput.fill(studioPrompt)
    await studioInput.press('Enter').catch(() => undefined)
    const studioSendButton = page.locator('button[title="Send (Enter)"]').first()
    if (await studioSendButton.isVisible().catch(() => false)) {
      await studioSendButton.click().catch(() => undefined)
    }
    await expect(page.getByText(/command requires confirmation/i).first()).toBeVisible({ timeout: 30000 })

    const studioBodies = await page.locator('div.prose.prose-sm').allInnerTexts()
    const studioAnswer = String(studioBodies.find((text) => /command requires confirmation/i.test(text)) || '').trim()
    expect(studioAnswer.length).toBeGreaterThan(0)

    // 2) Floating Bob Quick Chat widget (onspace-ai-chat endpoint)
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await unlockSessionIfPrompted(page)

    const askBobFab = page.getByTitle('Ask Bob — operational assistant').first()
    await expect(askBobFab).toBeVisible({ timeout: 30000 })
    await askBobFab.click()

    const quickInput = page.getByPlaceholder('Ask a quick question...').first()
    await expect(quickInput).toBeVisible({ timeout: 30000 })

    const quickPrompt = `Manual verify quick chat ${Date.now()}: give one short patrol safety reminder.`
    const quickResPromise = page.waitForResponse((response) => isBobPostResponse(response), { timeout: 120000 })

    await quickInput.fill(quickPrompt)
    await quickInput.press('Enter')
    await expect(page.getByText(new RegExp(escapeRegExp(quickPrompt), 'i')).first()).toBeVisible({ timeout: 30000 })

    const quickRes = await quickResPromise
    expect(quickRes.ok()).toBeTruthy()
    const quickJson = await quickRes.json().catch(() => ({} as any))
    const quickAnswer = String(quickJson?.response || quickJson?.answer || quickJson?.message || '').trim()
    expect(quickAnswer.length).toBeGreaterThan(0)

    const quickSnippet = firstSnippet(quickAnswer)
    await expect(page.getByText(quickSnippet, { exact: false }).first()).toBeVisible({ timeout: 60000 })

    // 3) Feedback modal -> Chat with Bob (bug notifications chat intake)
    const feedbackButton = page.getByTitle('Send feedback or report an issue').first()
    await expect(feedbackButton).toBeVisible({ timeout: 30000 })
    await feedbackButton.click()

    const feedbackDialog = page.getByRole('dialog').filter({ hasText: /send feedback/i }).first()
    await expect(feedbackDialog).toBeVisible({ timeout: 30000 })

    const chatWithBobButton = feedbackDialog.getByRole('button', { name: /chat with bob/i }).first()
    await expect(chatWithBobButton).toBeVisible({ timeout: 30000 })
    await chatWithBobButton.click()

    // AiFeedbackChat sends an automatic bootstrap request on open; ensure it completes.
    const feedbackBootstrapRes = await page.waitForResponse((response) => isBobPostResponse(response), { timeout: 120000 })
    expect(feedbackBootstrapRes.ok()).toBeTruthy()

    const feedbackInput = page.getByPlaceholder(/type your reply/i).first()
    await expect(feedbackInput).toBeVisible({ timeout: 30000 })

    const feedbackPrompt = `Manual verify feedback chat ${Date.now()}: summarize a bug ticket in one short line.`
    const feedbackResPromise = page.waitForResponse((response) => isBobPostResponse(response), { timeout: 120000 })

    await feedbackInput.fill(feedbackPrompt)
    await feedbackInput.press('Enter')
    await expect(page.getByText(new RegExp(escapeRegExp(feedbackPrompt), 'i')).first()).toBeVisible({ timeout: 30000 })

    const feedbackRes = await feedbackResPromise
    expect(feedbackRes.ok()).toBeTruthy()
    const feedbackJson = await feedbackRes.json().catch(() => ({} as any))
    const feedbackAnswer = String(feedbackJson?.response || feedbackJson?.message || feedbackJson?.answer || '').trim()
    expect(feedbackAnswer.length).toBeGreaterThan(0)

    const feedbackSnippet = firstSnippet(feedbackAnswer)
    await expect(page.getByText(feedbackSnippet, { exact: false }).first()).toBeVisible({ timeout: 60000 })

    console.log(`VERIFY_STUDIO_ANSWER: ${studioAnswer}`)
    console.log(`VERIFY_QUICK_ANSWER: ${quickAnswer}`)
    console.log(`VERIFY_FEEDBACK_ANSWER: ${feedbackAnswer}`)
  })
})
