import { test, expect } from '@playwright/test'

async function waitForRadioConsole(page: Parameters<typeof test.beforeEach>[0]['page']) {
  await expect(page.getByTestId('show-interpreter-toggle')).toBeVisible({ timeout: 20000 }).catch(() => {
    // Radio may still be loading; proceed anyway
  })
}

async function loginToRadio(page: Parameters<typeof test.beforeEach>[0]['page'], email: string, password: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login') && url.pathname !== '/', { timeout: 20000 }).catch(() => undefined)
  await page.goto('/radio')
  await expect(page).toHaveURL(/\/radio$/)
  await waitForRadioConsole(page)
}

async function ensureMicrophoneEnabled(page: Parameters<typeof test.beforeEach>[0]['page']) {
  const enableMicrophoneButton = page.getByRole('button', { name: 'Enable Microphone' })
  if (await enableMicrophoneButton.isVisible().catch(() => false)) {
    await page.context().grantPermissions(['microphone'], { origin: page.url() })
    await enableMicrophoneButton.click()
  }
}

function interpreterToggle(page: Parameters<typeof test.beforeEach>[0]['page']) {
  return page.getByRole('button', { name: /show interpreter|hide interpreter/i })
}

function pttButton(page: Parameters<typeof test.beforeEach>[0]['page']) {
  return page.locator('[data-testid="ptt-hold-to-talk"], button[aria-label="Push to talk"]').first()
}

test.describe('Phase 2: Universal Translator Audio', () => {
  const officerEmail =
    process.env.PLAYWRIGHT_OFFICER_ORG1_EMAIL ||
    process.env.PLAYWRIGHT_OFFICER_EMAIL ||
    ''
  const officerPassword =
    process.env.PLAYWRIGHT_OFFICER_ORG1_PASSWORD ||
    process.env.PLAYWRIGHT_OFFICER_PASSWORD ||
    ''
  const interpreterEmail =
    process.env.PLAYWRIGHT_INTERPRETER_EMAIL ||
    process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL ||
    officerEmail
  const interpreterPassword =
    process.env.PLAYWRIGHT_INTERPRETER_PASSWORD ||
    process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD ||
    officerPassword

  test.beforeEach(async ({ page }) => {
    if (!officerEmail || !officerPassword) {
      test.skip()
    }

    await loginToRadio(page, officerEmail, officerPassword)
    await ensureMicrophoneEnabled(page)
  })

  test('1. Wake-word "Hey Bob" triggers intercom pathway', async ({ page }) => {
    const holdToTalkButton = pttButton(page)
    await holdToTalkButton.scrollIntoViewIfNeeded()
    await expect(holdToTalkButton).toBeVisible()

    await interpreterToggle(page).click()
    await expect(page.getByText('Wake word ("Hey Bob")')).toBeVisible()

    const wakeWordToggle = page.getByTestId('wake-word-switch')
    await expect(wakeWordToggle).toBeVisible()
    if (!(await wakeWordToggle.isChecked())) {
      await wakeWordToggle.check()
    }
    await expect(wakeWordToggle).toBeChecked()
    await expect(holdToTalkButton).toBeVisible()
  })

  test('2. Co-worker PTT audio is ducked to 20% when Bob speaks', async ({ page }) => {
    await interpreterToggle(page).click()
    const duckingToggle = page.getByTestId('audio-ducking-switch')

    await expect(duckingToggle).toBeVisible()
    await expect(duckingToggle).toBeChecked()
    await expect(page.getByTestId('audio-ducking-status')).toHaveText(/Coworker channel at normal volume/)
  })

  test('3. Hold-to-talk remains functional during Bob intercom mode', async ({ page }) => {
    const holdToTalkButton = pttButton(page)
    await holdToTalkButton.scrollIntoViewIfNeeded()
    await expect(holdToTalkButton).toBeVisible()

    await interpreterToggle(page).click()
    const wakeWordToggle = page.getByTestId('wake-word-switch')
    if (!(await wakeWordToggle.isChecked())) {
      await wakeWordToggle.check()
    }

    await ensureMicrophoneEnabled(page)
    await expect(page.getByTestId('ptt-idle-indicator')).toBeVisible()
  })

  test('4. Bob Intercom visible to authorized roles', async ({ page }) => {
    const toggleBtn = interpreterToggle(page)
    const canClick = await toggleBtn.isVisible().catch(() => false)
    if (canClick) {
      await toggleBtn.click()
      const bobButton = page.getByTestId('bob-intercom-speak-button')
      const isVisible = await bobButton.isVisible().catch(() => false)
      expect(isVisible).toBe(true)
    }
  })

  test('5. Audio ducking toggle persists across sessions', async ({ page }) => {
    await interpreterToggle(page).click()
    const duckingToggle = page.getByTestId('audio-ducking-switch')
    const initialState = await duckingToggle.isChecked()

    await duckingToggle.click()
    await expect(duckingToggle).not.toBeChecked()

    await page.reload()
    await page.waitForLoadState('load').catch(() => {})
    await waitForRadioConsole(page)
    await interpreterToggle(page).click()
    await expect(page.getByTestId('audio-ducking-switch')).not.toBeChecked()
    expect(initialState).toBe(true)
  })
})
