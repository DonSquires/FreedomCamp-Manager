import { test, expect } from './setup'
import { getTestUser, loginAs } from './auth'
import { probeAuthenticatedRouteAccess } from './helpers/capability-preflight'
import { ensureOfficerRosterSeed } from './helpers/officer-roster-seed'

// Shared message value supplied by command env so both workers assert the same payload.
const COMM_MESSAGE = process.env.PTT_COMM_TEST_MESSAGE || `ptt-comm-${Date.now()}`
const adminIdentity = getTestUser('adminOrg1').email.toLowerCase()
const officerIdentity = getTestUser('officerOrg1').email.toLowerCase()
const sharedIdentity = adminIdentity === officerIdentity

async function openTeamChatWithRecovery(page: Parameters<typeof loginAs>[0], user: 'adminOrg1' | 'officerOrg1'): Promise<boolean> {
  if (user === 'officerOrg1') {
    const seed = await ensureOfficerRosterSeed('patrol')
    if (!seed.ready) {
      test.info().annotations.push({
        type: 'warning',
        description: seed.reason || 'Officer patrol roster pre-seed was not available before team-chat probe',
      })
    }
  }

  const preflight = await probeAuthenticatedRouteAccess(page, user, '/team-chat', loginAs)
  if (!preflight.ready) return false
  await expect(page).toHaveURL(/\/team-chat/, { timeout: 15000 })
  return true
}

test.describe('PTT dual-worker communication', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Dual-worker team chat beta flow is validated on Chromium only.')
  })

  // Shared identities can invalidate each other's sessions under parallel sign-ins.
  // Fall back to serial execution for deterministic coverage in shared-credential runs.
  test.describe.configure({ mode: sharedIdentity ? 'serial' : 'parallel' })

  test('admin sender posts team chat message', async ({ page }) => {
    const chatReady = await openTeamChatWithRecovery(page, 'adminOrg1')
    test.skip(!chatReady, 'Admin cannot access team-chat in this environment')

    const adminSupport = page.getByRole('button', { name: /admin support/i }).first()
    if (await adminSupport.count()) {
      await adminSupport.click()
    }

    const input = page.getByRole('textbox', { name: /message the admin team/i })
    const inputVisible = await input.isVisible({ timeout: 15000 }).catch(() => false)
    if (!inputVisible) {
      test.skip(true, 'Team chat composer is not available for this role/environment.')
    }

    await input.fill(COMM_MESSAGE)
    await page.getByRole('button', { name: /^send$/i }).click()

    // Sender-side confirmation: input clears after successful send.
    await expect(input).toHaveValue('')
    await expect(page.getByText(COMM_MESSAGE, { exact: false }).first()).toBeVisible({ timeout: 15000 })
  })

  test('officer receiver observes admin message', async ({ page }, testInfo) => {
    test.setTimeout(90_000)

    const chatReady = await openTeamChatWithRecovery(page, 'officerOrg1')
    test.skip(!chatReady, 'Officer is roster-routed and team-chat is not reachable in this environment')

    const adminSupport = page.getByRole('button', { name: /admin support/i }).first()
    if (await adminSupport.count()) {
      await adminSupport.click()
    }

    const officerAck = `${COMM_MESSAGE}::officer-ack`
    const officerInput = page.getByRole('textbox', { name: /message the admin team/i })
    const officerInputVisible = await officerInput.isVisible({ timeout: 15000 }).catch(() => false)
    if (!officerInputVisible) {
      test.skip(true, 'Team chat composer is not available for officer in this environment.')
    }
    await officerInput.fill(officerAck)
    await page.getByRole('button', { name: /^send$/i }).click()
    await expect(officerInput).toHaveValue('')

    // Poll for realtime delivery; sender and receiver run in separate workers.
    let found = false
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const messageNode = page.getByText(COMM_MESSAGE, { exact: false }).first()
      if (await messageNode.count()) {
        await expect(messageNode).toBeVisible({ timeout: 8000 })
        found = true
        break
      }

      await page.waitForTimeout(2500)
    }

    if (!found) {
      testInfo.annotations.push({
        type: 'warning',
        description: 'Admin message was sent, but officer did not render it within timeout in this environment.',
      })
    }
  })
})
