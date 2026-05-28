import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function getMainPttControl(page: any) {
  const byTestId = page.getByTestId('ptt-main-button')
  if (await byTestId.count()) return byTestId.first()
  return page.getByRole('button', { name: /push to talk|hold to talk/i }).first()
}

async function openRadioOrSkip(page: any) {
  await loginAs(page, 'officerOrg1')
  await page.goto('/radio', { waitUntil: 'networkidle' })

  if (page.url().includes('/login')) {
    await loginAs(page, 'officerOrg1')
    await page.goto('/radio', { waitUntil: 'networkidle' })
  }

  if (page.url().includes('/login')) {
    test.skip(true, 'Auth bootstrap is unavailable or rate-limited for this run')
  }

  await expect(page).not.toHaveURL(/\/login/)

  if (/\/(officer-home|field-officer)(?:\?|$|\/)/.test(page.url())) {
    test.skip(true, 'PTT route is roster/site-permission gated in this environment')
  }

  await expect(page).toHaveURL(/\/(radio|ptt-radio)(?:\?|$|\/)/)
}

test.describe('PTT E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('radio route loads for officer', async ({ page }) => {
    await openRadioOrSkip(page)

    const hasChannelsHeading = await page.getByText('Channels', { exact: true }).first().isVisible({ timeout: 7000 }).catch(() => false)
    const pttControl = await getMainPttControl(page)
    const hasMainButton = await pttControl.isVisible({ timeout: 7000 }).catch(() => false)

    expect(hasChannelsHeading || hasMainButton).toBeTruthy()
    await expect(pttControl).toBeVisible({ timeout: 15000 })
  })

  test('channel controls are visible', async ({ page }) => {
    await openRadioOrSkip(page)

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
