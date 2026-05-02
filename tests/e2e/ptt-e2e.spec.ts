import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function getMainPttControl(page: any) {
  const byTestId = page.getByTestId('ptt-main-button')
  if (await byTestId.count()) return byTestId.first()
  return page.getByRole('button', { name: /push to talk|hold to talk/i }).first()
}

test.describe('PTT E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('radio route loads for officer', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/radio', { waitUntil: 'networkidle' })

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/radio/)
    await expect(page.getByRole('heading', { name: /radio/i })).toBeVisible({ timeout: 15000 })
    const pttControl = await getMainPttControl(page)
    await expect(pttControl).toBeVisible({ timeout: 15000 })
  })

  test('channel controls are visible', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/radio', { waitUntil: 'networkidle' })

    const channelItem = page.getByTestId('ptt-channel-1').first()
    const channelsHeading = page.getByText('Channels', { exact: true }).first()
    const hasChannelItem = await channelItem.isVisible({ timeout: 7000 }).catch(() => false)
    const hasChannelsHeading = await channelsHeading.isVisible({ timeout: 7000 }).catch(() => false)
    expect(hasChannelItem || hasChannelsHeading).toBeTruthy()

    const byStatusTestId = page.getByTestId('ptt-connection-status').first()
    const hasStatusTestId = await byStatusTestId.isVisible({ timeout: 5000 }).catch(() => false)
    if (hasStatusTestId) {
      await expect(byStatusTestId).toBeVisible({ timeout: 15000 })
    } else {
      const pttControl = await getMainPttControl(page)
      await expect(pttControl).toBeVisible({ timeout: 15000 })
    }
  })
})
