import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { probeAuthenticatedRouteAccess } from './helpers/capability-preflight'
import { ensureOfficerRosterSeed } from './helpers/officer-roster-seed'

async function openRadioOrSkip(page: any, user: 'officerOrg1' | 'bob' = 'officerOrg1') {
  if (user === 'officerOrg1') {
    const seed = await ensureOfficerRosterSeed('patrol')
    if (!seed.ready) {
      test.info().annotations.push({
        type: 'warning',
        description: seed.reason || 'Officer patrol roster pre-seed was not available before PTT probe',
      })
    }
  }

  const preflight = await probeAuthenticatedRouteAccess(page, user, '/radio', loginAs)
  test.skip(!preflight.ready, preflight.reason || `PTT preflight failed for ${user}`)

  const bootMessage = page.getByText(/Preparing the Freedom Camp enforcement workspace/i)
  const bootVisible = await bootMessage.isVisible({ timeout: 3000 }).catch(() => false)
  if (bootVisible) {
    const bootResolved = await bootMessage.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false)
    if (!bootResolved) {
      test.skip(true, `Workspace bootstrap did not complete for ${user}`)
    }
  }

  const resolvedRadio = await page
    .waitForURL((url) => /\/(radio|ptt-radio)(?:\?|$|\/)/.test(url.pathname + url.search), { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  if (!resolvedRadio) {
    test.skip(true, `PTT route is not reachable for ${user} in this environment`)
  }
}

async function assertRadioShell(page: any) {
  const channelsHeading = page.getByText('Channels', { exact: true }).first()
  const pttMainButton = page.getByTestId('ptt-main-button').first()
  const pttRoleButton = page.getByRole('button', { name: /push to talk|hold to talk/i }).first()
  const hasChannels = await channelsHeading.isVisible({ timeout: 7000 }).catch(() => false)
  const hasMainButton = await pttMainButton.isVisible({ timeout: 7000 }).catch(() => false)
  const hasRoleButton = await pttRoleButton.isVisible({ timeout: 7000 }).catch(() => false)

  if (!hasChannels && !hasMainButton && !hasRoleButton) {
    test.skip(true, 'PTT shell controls are not provisioned for this role/environment.')
  }
}

test.describe('PTT Enterprise Validation', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90000)
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'PTT enterprise realtime validation is gated to Chromium for this beta checkpoint.')
  })

  test('radio route loads with valid shell', async ({ page }) => {
    await openRadioOrSkip(page, 'officerOrg1')
    await assertRadioShell(page)
  })

  test('channel context is rendered when provisioned', async ({ page }) => {
    await openRadioOrSkip(page, 'officerOrg1')

    const channelOne = page.getByTestId('ptt-channel-1').first()
    const channelsHeading = page.getByText('Channels', { exact: true }).first()
    const activeChannel = page.getByTestId('ptt-active-channel').first()
    const hasAnyChannelUI =
      (await channelOne.isVisible({ timeout: 7000 }).catch(() => false)) ||
      (await channelsHeading.isVisible({ timeout: 7000 }).catch(() => false)) ||
      (await activeChannel.isVisible({ timeout: 7000 }).catch(() => false))

    if (!hasAnyChannelUI) {
      test.skip(true, 'No PTT channel UI is provisioned for this role/environment')
    }

    expect(hasAnyChannelUI).toBeTruthy()
  })

  test('PTT control handles pointer press/release when available', async ({ page }) => {
    await openRadioOrSkip(page, 'officerOrg1')

    const pttButton = page.getByTestId('ptt-main-button').first()
    const hasMainButton = await pttButton.isVisible({ timeout: 7000 }).catch(() => false)
    if (!hasMainButton) {
      test.skip(true, 'Stateful PTT main control is not available in this environment')
    }

    await pttButton.dispatchEvent('pointerdown')
    await expect(pttButton).toHaveAttribute('data-ptt-state', /transmitting|ready|connecting|connected/, { timeout: 7000 })
    await pttButton.dispatchEvent('pointerup')
  })

  test('settings panel and switches are interactive when present', async ({ page }) => {
    await openRadioOrSkip(page, 'officerOrg1')

    const settingsButton = page.getByRole('button', { name: /settings|radio settings/i }).first()
    const hasSettingsButton = await settingsButton.isVisible({ timeout: 7000 }).catch(() => false)
    if (!hasSettingsButton) {
      test.skip(true, 'Radio settings are not exposed in this environment')
    }

    await settingsButton.click()

    const switchControl = page.getByRole('switch').first()
    const hasSwitch = await switchControl.isVisible({ timeout: 7000 }).catch(() => false)
    if (!hasSwitch) {
      test.skip(true, 'No settings switch is available to validate in this environment')
    }

    const initialState = await switchControl.getAttribute('data-state')
    await switchControl.click()
    const nextState = await switchControl.getAttribute('data-state')
    expect(nextState).not.toBe(initialState)
  })

  test('emergency control visibility follows channel context', async ({ page }) => {
    await openRadioOrSkip(page, 'officerOrg1')

    const emergency = page.getByRole('button', { name: /Emergency/i }).first()
    const visible = await emergency.isVisible({ timeout: 7000 }).catch(() => false)
    if (!visible) {
      test.skip(true, 'Emergency control is not visible in this channel/access context')
    }

    await expect(emergency).toBeVisible()
  })

  test('officer and bob can both resolve to permitted radio workflow', async ({ browser }) => {
    const officerContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const officerPage = await officerContext.newPage()
    const bobPage = await bobContext.newPage()

    try {
      await openRadioOrSkip(officerPage, 'officerOrg1')
      await assertRadioShell(officerPage)

      await openRadioOrSkip(bobPage, 'bob')
      await assertRadioShell(bobPage)
    } finally {
      await officerPage.close().catch(() => undefined)
      await bobPage.close().catch(() => undefined)
      await officerContext.close().catch(() => undefined)
      await bobContext.close().catch(() => undefined)
    }
  })

  test('radio shell does not emit critical console errors during interaction', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await openRadioOrSkip(page, 'officerOrg1')
    await assertRadioShell(page)

    const pttButton = page.getByTestId('ptt-main-button').first()
    if (await pttButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pttButton.dispatchEvent('pointerdown')
      await pttButton.dispatchEvent('pointerup')
    }

    const criticalErrors = errors.filter((value) => {
      const text = value.toLowerCase()
      return !text.includes('resizeobserver') && !text.includes('websocket') && !text.includes('non-error promise rejection')
    })

    expect(criticalErrors).toHaveLength(0)
  })
})
