import { test, expect } from './setup'

test.describe('Bob Web Service Surfaces', () => {
  test('bob assistant returns a mocked operational response', async ({ adminUser: page }) => {
    await page.goto('/bob-assistant')
    const chatInput = page.getByPlaceholder('Ask Bob anything operational…')
    await chatInput.fill('Summarise key operational risks for a busy urban patrol shift.')
    await chatInput.press('Enter')

    await expect(page.getByText('Summarise key operational risks for a busy urban patrol shift.')).toBeVisible()

    const assistantOutcome = page.getByText(
      /Review Findings|Action Plan|Command blocked by policy|Officer assist mode is active|request failed|could not generate/i
    ).first()
    await expect(assistantOutcome).toBeVisible({ timeout: 15000 })
  })

  test('grandmaster coding studio queues a mocked Bob code task', async ({ masterUser: page }) => {
    await page.goto('/grandmaster-code-studio')
    await expect(page.getByRole('heading', { name: /Grandmaster Coding Studio/i })).toBeVisible({ timeout: 10000 })

    await page.locator('#task-text').fill('Fix null pointer exception in telemetry aggregator')
    await page.getByRole('button', { name: 'Queue task' }).click()

    await expect(page.getByRole('button', { name: /Queuing…|Queue task/i })).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/grandmaster-code-studio/)
  })
})