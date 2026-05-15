import { test, expect } from './setup'

test.describe('Bob Web Service Surfaces', () => {
  test('bob assistant returns a mocked operational response', async ({ adminUser: page }) => {
    await page.route('**/functions/v1/onspace-ai-chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: [
            'Review Findings',
            'WorkSafe NZ and ISO 31000 references are available for this draft.',
            '',
            'Assessment',
            'The Bob assistant surface accepted the request and returned a structured reply.',
            '',
            'Action Plan',
            '1. Generate the H&S draft.',
            '2. Review operational hazards.',
            '3. Send for approval.',
          ].join('\n'),
          provider: 'mock-suite',
          actionChecklist: ['Generate the H&S draft', 'Review hazards', 'Send for approval'],
        }),
      })
    })

    await page.goto('/bob-assistant')
    await page.getByPlaceholder('Ask Bob anything operational…').fill('Generate an H&S draft for Queen Street site.')
    await page.getByTitle('Send (Enter)').click()

    await expect(page.getByText('Generate an H&S draft for Queen Street site.')).toBeVisible()
    await expect(page.getByText(/WorkSafe NZ and ISO 31000/i)).toBeVisible()
    await expect(page.getByText('Action Plan')).toBeVisible()
  })

  test('grandmaster coding studio queues a mocked Bob code task', async ({ masterUser: page }) => {
    await page.route('**/functions/v1/grandmaster-studio', async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as Record<string, unknown>

      if (body?.action === 'code_task_submit') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            task_id: 'bob-task-001',
            status: 'queued',
            bob_plan: 'OBSERVE\nLOCALISE\nAPPLY\nVERIFY\nRECORD',
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    })

    await page.goto('/grandmaster-coding-studio')
    await page.locator('#task-text').fill('Fix null pointer exception in telemetry aggregator')
    await page.getByRole('button', { name: 'Queue task' }).click()

    await expect(page.getByText('Task queued')).toBeVisible()
    await expect(page.locator('pre')).toContainText('APPLY')
    await expect(page.locator('pre')).toContainText('VERIFY')
    await expect(page.locator('pre')).toContainText('RECORD')
  })
})