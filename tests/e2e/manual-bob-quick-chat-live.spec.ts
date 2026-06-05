import { expect, test, type Page } from '@playwright/test'
import { loginAs } from './auth'

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstSnippet(value: string, size = 28): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, size)
}

async function unlockSessionIfPrompted(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: /session timed out/i }).first()
  const locked = await heading.isVisible({ timeout: 1200 }).catch(() => false)
  if (!locked) return

  const unlockPassword =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!unlockPassword) {
    throw new Error('Session lock detected but no unlock password environment variable is available')
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

test.describe('Manual Bob quick chat live verification', () => {
  test.setTimeout(180000)

  test('allows manual entry and receives a live answer', async ({ page }) => {
    const onspaceRequests: string[] = []
    const onspaceResponses: string[] = []
    const onspaceFailures: string[] = []
    const pageErrors: string[] = []
    const consoleErrors: string[] = []

    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/onspace-ai-chat')) {
        onspaceRequests.push(`${request.method()} ${request.url()}`)
      }
    })
    page.on('response', (response) => {
      if (response.url().includes('/functions/v1/onspace-ai-chat')) {
        onspaceResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
      }
    })
    page.on('requestfailed', (request) => {
      if (request.url().includes('/functions/v1/onspace-ai-chat')) {
        onspaceFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown error'}`)
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(String(error.message || error))
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('e2e:session-timeout-ms', String(24 * 60 * 60 * 1000))
        window.localStorage.setItem('e2e:session-warning-seconds', '7200')
      } catch {
        // ignore storage restrictions
      }
    })

    await loginAs(page, 'grandmaster')
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await unlockSessionIfPrompted(page)

    const askBobFab = page.getByTitle('Ask Bob — operational assistant').first()
    await expect(askBobFab).toBeVisible({ timeout: 30000 })
    await askBobFab.click()

    const quickInput = page.getByPlaceholder('Ask a quick question...').first()
    await expect(quickInput).toBeVisible({ timeout: 30000 })

    const prompt = `Manual quick chat verify ${Date.now()}: give one short patrol reminder.`
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/functions/v1/onspace-ai-chat') && response.request().method() === 'POST',
      { timeout: 45000 },
    )

    await quickInput.fill(prompt)
    await quickInput.press('Enter')

    await expect(page.getByText(new RegExp(escapeRegex(prompt), 'i')).first()).toBeVisible({ timeout: 30000 })

    const response = await responsePromise.catch(() => null)

    if (!response) {
      const thinkingVisible = await page.getByText(/bob is thinking/i).first().isVisible().catch(() => false)
      throw new Error(
        [
          'Quick chat POST /onspace-ai-chat response not observed within timeout.',
          `thinkingVisible=${thinkingVisible}`,
          `requests=${JSON.stringify(onspaceRequests)}`,
          `responses=${JSON.stringify(onspaceResponses)}`,
          `failures=${JSON.stringify(onspaceFailures)}`,
          `pageErrors=${JSON.stringify(pageErrors.slice(-5))}`,
          `consoleErrors=${JSON.stringify(consoleErrors.slice(-5))}`,
        ].join(' '),
      )
    }

    expect(response.ok()).toBeTruthy()

    const json = await response.json().catch(() => ({} as any))
    const answer = String(json?.response || json?.answer || json?.message || '').trim()
    expect(answer.length).toBeGreaterThan(0)

    const snippet = firstSnippet(answer)
    await expect(page.getByText(snippet, { exact: false }).first()).toBeVisible({ timeout: 60000 })

    console.log(`VERIFY_QUICK_ANSWER: ${answer}`)
  })
})
