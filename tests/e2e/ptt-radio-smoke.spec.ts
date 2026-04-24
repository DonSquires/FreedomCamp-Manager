import { test, expect, applySyntheticOrganization } from './setup'

async function waitForRadioState(page: any, state: 'connecting' | 'connected' | 'ready' | 'transmitting', timeout = 20000) {
  if (state === 'connected' || state === 'connecting') {
    await expect(page.getByTestId('ptt-connection-status')).toHaveAttribute('data-state', state, { timeout })
    return
  }

  await expect(page.getByTestId('ptt-main-button')).toHaveAttribute('data-ptt-state', state, { timeout })
}

async function assertRadioLoads(page: any) {
  await page.goto('/radio')

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page).toHaveURL(/\/radio/)

  // Stable radio UI markers on PTTRadio page.
  await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('ptt-main-button')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('ptt-channel-1').first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Emergency — All Channels')).toBeVisible({ timeout: 20000 })
}

async function connectPrimaryChannel(page: any) {
  const primaryChannel = page.getByTestId('ptt-channel-1').first()
  await primaryChannel.click()
  await waitForRadioState(page, 'connected')
  await waitForRadioState(page, 'ready')
}

test.describe('PTT radio route smoke', () => {
  test('officer can open /radio', async ({ officerUser }) => {
    await assertRadioLoads(officerUser)
  })

  test('admin can open /radio', async ({ adminUser }) => {
    await assertRadioLoads(adminUser)
  })

  test('master can open /radio', async ({ masterUser }) => {
    await assertRadioLoads(masterUser)
  })

  test('master can connect and transmit via state-machine flow in mock mode', async ({ masterUser, syntheticOrganization }) => {
    test.skip(process.env.VITE_PTT_MOCK_MODE !== 'true' && process.env.NEXT_PUBLIC_API_MOCK !== 'true', 'Requires mock mode')

    await applySyntheticOrganization(masterUser, syntheticOrganization)
    await assertRadioLoads(masterUser)
    await expect(masterUser.getByTestId('ptt-active-channel')).toContainText('CH 1', { timeout: 20000 })

    await connectPrimaryChannel(masterUser)

    const pttButton = masterUser.getByTestId('ptt-main-button')
    await pttButton.hover()
    await pttButton.dispatchEvent('mousedown')
    await waitForRadioState(masterUser, 'transmitting', 10000)
    await pttButton.dispatchEvent('mouseup')
    await waitForRadioState(masterUser, 'ready', 10000)
  })
})
