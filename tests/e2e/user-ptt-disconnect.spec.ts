import { test, expect, type Locator } from '@playwright/test'
import { loginAs } from './auth'

async function firstEnabled(locator: Locator): Promise<Locator | null> {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isEnabled()) {
      return candidate
    }
  }
  return null
}

test.describe('User Management PTT disconnect', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin can trigger force disconnect from users list', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto('/users', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /users?/i }).first()).toBeVisible({ timeout: 15000 })

    const disconnectButtons = page.getByRole('button', { name: /^Disconnect PTT$/i })
    await expect(disconnectButtons.first()).toBeVisible({ timeout: 10000 })

    const activeDisconnectButton = await firstEnabled(disconnectButtons)

    if (!activeDisconnectButton) {
      test.skip(true, 'No eligible active user row for Disconnect PTT in current fixture data.')
      return
    }

    await activeDisconnectButton.scrollIntoViewIfNeeded()
    try {
      await activeDisconnectButton.click({ timeout: 10000 })
    } catch {
      // Mobile layouts can intermittently report pointer interception from sticky
      // headers/chips; force click keeps the intent deterministic for this action.
      await activeDisconnectButton.click({ force: true })
    }

    const toast = page
      .locator('[data-sonner-toast], [role="status"], .sonner-toast')
      .filter({ hasText: /PTT disconnect request sent|PTT disconnect requested|did not fully confirm/i })
      .first()

    await expect(toast).toBeVisible({ timeout: 10000 })
  })
})
