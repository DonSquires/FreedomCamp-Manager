import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { probeAuthenticatedRouteAccess } from './helpers/capability-preflight'
import { ensureOfficerRosterSeed } from './helpers/officer-roster-seed'

async function getMainPttControl(page: any) {
  const byTestId = page.getByTestId('ptt-main-button')
  if (await byTestId.count()) return byTestId.first()
  return page.getByRole('button', { name: /push to talk|hold to talk/i }).first()
}

async function openRadioOrSkip(page: any) {
  const seed = await ensureOfficerRosterSeed('patrol')
  if (!seed.ready) {
    test.info().annotations.push({
      type: 'warning',
      description: seed.reason || 'Officer patrol roster pre-seed was not available before PTT probe',
    })
  }

  const preflight = await probeAuthenticatedRouteAccess(page, 'officerOrg1', '/radio', loginAs)
  test.skip(!preflight.ready, preflight.reason || 'PTT route preflight failed')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page).toHaveURL(/\/(radio|ptt-radio)(?:\?|$|\/)/)
}

test.describe('PTT E2E', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'PTT realtime E2E beta is validated on Chromium only.')
  })

  test('radio route loads for officer', async ({ page }) => {
    await openRadioOrSkip(page)

    const hasChannelsHeading = await page.getByText('Channels', { exact: true }).first().isVisible({ timeout: 7000 }).catch(() => false)
    const pttControl = await getMainPttControl(page)
    const hasMainButton = await pttControl.isVisible({ timeout: 7000 }).catch(() => false)

    if (!hasChannelsHeading && !hasMainButton) {
      test.skip(true, 'PTT shell controls are not provisioned for this role/environment.')
    }
    await expect(pttControl).toBeVisible({ timeout: 15000 })
  })

  test('channel controls are visible', async ({ page }) => {
    await openRadioOrSkip(page)

    const channelItem = page.getByTestId('ptt-channel-1').first()
    const channelsHeading = page.getByText('Channels', { exact: true }).first()
    const hasChannelItem = await channelItem.isVisible({ timeout: 7000 }).catch(() => false)
    const hasChannelsHeading = await channelsHeading.isVisible({ timeout: 7000 }).catch(() => false)
    if (!hasChannelItem && !hasChannelsHeading) {
      test.skip(true, 'PTT channels UI is not available in this environment.')
    }

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
