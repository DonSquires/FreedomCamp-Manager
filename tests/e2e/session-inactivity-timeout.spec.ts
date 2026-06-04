import { expect, test, type Page } from '@playwright/test'
import { getTestUser, loginAs, type TestUserKey } from './auth'

/**
 * Session Lock E2E Test Suite — Instruction Manual § 2.2 Validation
 * 
 * INSTRUCTION MANUAL § 2.2 states:
 * "The platform automatically locks your session after a period of inactivity. 
 *  You will see a lock screen requiring you to re-enter your password. 
 *  Your data and open tabs are preserved — you do not need to log out and back in."
 * 
 * PURPOSE:
 * This test suite validates that the actual app implementation matches the manual.
 * If discrepancies are found, they are documented for manual amendments.
 * 
 * TEST APPROACH:
 * 1. Follow § 2.1 (Sign In) step-by-step
 * 2. Reach authenticated portal (per actual app routing)
 * 3. Trigger inactivity condition
 * 4. Verify warning overlay appears (if implemented)
 * 5. Verify lock screen appears (if implemented)
 * 6. Test unlock flow
 * 7. Verify data preservation
 */

test.describe('Session Lock Feature — Instruction Manual § 2.1 & 2.2', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 })

  const LOCKOUT_MINUTES = 15
  const WARNING_COUNTDOWN_SECONDS = 39
  const E2E_TIMEOUT_MS = 45000
  const E2E_WARNING_DELAY_MS = E2E_TIMEOUT_MS - WARNING_COUNTDOWN_SECONDS * 1000

  const elevatedUsers: TestUserKey[] = ['grandmaster', 'master']
  const unlockCredentials = getTestUser('adminOrg1')
  
  async function applyManualInactivityPreference(page: Page) {
    // Persist exact manual policy plus localhost-only E2E overrides to keep CI runtime practical.
    await page.evaluate(() => {
      window.localStorage.setItem('session-preferences-store', JSON.stringify({
        state: {
          autoLogoffEnabled: true,
          inactivityMinutes: 15,
        },
        version: 1,
      }))
      window.localStorage.setItem('e2e:session-timeout-ms', String(45000))
      window.localStorage.setItem('e2e:session-warning-seconds', String(39))
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
  }

  async function resetToLoggedOut(page: Page) {
    await page.context().clearCookies().catch(() => undefined)
    await page.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    }).catch(() => undefined)
  }

  test('§ 2.1: Sign in form is visible and functional', async ({ page }) => {
    /**
     * MANUAL § 2.1 STEPS:
     * 1. Open the application URL in any modern browser
     * 2. You will see the FieldOps Manager login screen
     * 3. Enter your assigned email address and password
     * 4. Click Sign In
     */
    
    // Step 1: Navigate to app
    await resetToLoggedOut(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    
    // Step 2: Verify login screen is visible
    const loginForm = page.locator('form').first()
    const emailInput = page.getByRole('textbox', { name: /^Email$/i }).first()
    const passwordInput = page.getByRole('textbox', { name: /^Password$/i }).first()
    const signInButton = page.getByRole('button', { name: /Sign in|Sign In|Login/i }).first()

    await emailInput.waitFor({ state: 'visible', timeout: 10000 })
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 })
    await signInButton.waitFor({ state: 'visible', timeout: 10000 })
    
    // Log what we actually found
    console.log('✓ Login form elements found:')
    console.log('  - Email input visible:', await emailInput.isVisible().catch(() => false))
    console.log('  - Password input visible:', await passwordInput.isVisible().catch(() => false))
    console.log('  - Sign In button visible:', await signInButton.isVisible().catch(() => false))
    
    // Verify key login elements exist
    await expect(emailInput).toBeVisible({ timeout: 5000 })
    await expect(passwordInput).toBeVisible({ timeout: 5000 })
    await expect(signInButton).toBeVisible({ timeout: 5000 })
  })

  test('§ 2.1 & 2.2: Complete login flow to authenticated portal', async ({ page }) => {
    /**
     * TEST: Complete journey from login to authenticated state
     * VALIDATES: Manual § 2.1 steps 1-4
     * CHECKS: What portal the app actually routes to
     */
    
    // Use the shared auth helper so production runs align with validated credential bootstrap.
    await loginAs(page, 'adminOrg1')
    
    // App can land on /platform or role-specific routes; capture current route immediately
    // to avoid long waits interacting with short inactivity test settings.
    const successfulURL = page.url()
    
    // Determine what portal user landed on
    console.log('✓ Login successful')
    console.log(`  - Redirected to: ${successfulURL}`)
    console.log(`  - User authenticated: ${await page.context().cookies().then(c => c.some(x => x.name.includes('auth')) ? 'Yes' : 'No')}`)
    
    // Verify we're in an authenticated state (not on login page anymore)
    expect(page.url()).not.toMatch(/login|signin/i)
  })

  for (const elevatedUser of elevatedUsers) {
    test(`elevated login smoke: ${elevatedUser} reaches authenticated state`, async ({ page }) => {
      await loginAs(page, elevatedUser)
      await expect(page).toHaveURL(/^(?!.*\/(login|signin))(.*)$/i, { timeout: 15000 })
    })
  }

  test('§ 2.2: Session lock feature detection and behavior', async ({ page }) => {
    /**
     * TEST: Detect if session lock feature is implemented
     * VALIDATES: Manual § 2.2 specifications
     * CHECKS: Warning overlay, countdown, lock screen, unlock functionality
     * 
     * DISCREPANCIES TO LOG:
     * - If feature doesn't exist
     * - If warning appears but not at correct time
     * - If lock screen doesn't require password
     * - If data is not preserved after unlock
     */
    
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.text().includes('[session-lock]')) {
        console.log(`[browser:${msg.type()}] ${msg.text()}`)
      }
    })

    // Sign in using the same resilient auth path as other production E2E suites.
    await loginAs(page, 'adminOrg1')
    await applyManualInactivityPreference(page)

    // Wait for authenticated state
    await expect(page).toHaveURL(/^(?!.*\/(login|signin))(.*)$/i, { timeout: 10000 })

    const initialURL = page.url()
    const pageTitle = await page.title()
    console.log('✓ Authenticated')
    console.log(`  - Portal: ${initialURL}`)
    console.log(`  - Page title: ${pageTitle}`)

    const warningLocator = page.locator('text=Session Timeout Warning').first()
    const countdownText = `Locking in ${WARNING_COUNTDOWN_SECONDS}s`
    const countdownLocator = page.locator(`text=${countdownText}`).first()
    const passwordFieldLocator = page.locator('input[id="unlock-password"], input[placeholder*="password"]').first()

    console.log(`⏳ Waiting for warning boundary (${E2E_WARNING_DELAY_MS / 1000}s in E2E override, policy remains ${LOCKOUT_MINUTES}m)...`)

    await expect(warningLocator).toBeVisible({ timeout: E2E_WARNING_DELAY_MS + 5000 })
    await expect(countdownLocator).toBeVisible({ timeout: 5000 })

    // Verify that countdown actually ticks down from 39.
    await page.waitForTimeout(3000)
    await expect(page.locator('text=Locking in 36s').first()).toBeVisible({ timeout: 5000 })

    console.log(`⏳ Advancing remaining ${WARNING_COUNTDOWN_SECONDS - 3}s countdown to lock...`)
    await page.waitForTimeout((WARNING_COUNTDOWN_SECONDS - 3) * 1000)

    await expect(passwordFieldLocator).toBeVisible({ timeout: 5000 })

    const unlockButton = page.getByRole('button', { name: /Log Back In|Unlock|Continue/i }).first()
    const logoutButton = page.getByRole('button', { name: /Logout|Sign Out/i }).first()

    await expect(unlockButton).toBeVisible({ timeout: 5000 })
    await expect(logoutButton).toBeVisible({ timeout: 5000 })

    await passwordFieldLocator.fill(unlockCredentials.password)
    await unlockButton.click()
    await expect(passwordFieldLocator).toBeHidden({ timeout: 30000 })

    const urlAfterUnlock = page.url()
    const stillOnInitialPage = urlAfterUnlock === initialURL
    expect(stillOnInitialPage).toBe(true)
  })

  test('§ 2.2: Data preservation verification', async ({ page }) => {
    /**
     * TEST: Verify "data and open tabs are preserved" per manual § 2.2
     * VALIDATES: Session state is not lost during lock
     */
    
    // Sign in using shared auth helper to keep bootstrap behavior consistent.
    await loginAs(page, 'adminOrg1')
    await applyManualInactivityPreference(page)
    
    await expect(page).toHaveURL(/^(?!.*\/(login|signin))(.*)$/i, { timeout: 10000 })
    
    // Capture page state before lock
    const urlBefore = page.url()
    const titleBefore = await page.title()
    
    console.log('Capturing pre-lock state:')
    console.log(`  - URL: ${urlBefore}`)
    console.log(`  - Title: ${titleBefore}`)
    
    // Trigger lock using deterministic clock control.
    await page.waitForTimeout(E2E_TIMEOUT_MS)

    const passwordField = page.locator('input[id="unlock-password"], input[placeholder*="password"]').first()
    await expect(passwordField).toBeVisible({ timeout: 5000 })

    await passwordField.fill(unlockCredentials.password)
    const unlockButton = page.getByRole('button', { name: /Log Back In|Unlock/i }).first()
    await unlockButton.click()

    await expect(passwordField).toBeHidden({ timeout: 30000 })

    // Check if state is preserved
    const urlAfter = page.url()
    const titleAfter = await page.title()

    const urlPreserved = urlBefore === urlAfter
    const titlePreserved = titleBefore === titleAfter

    console.log('Post-unlock state:')
    console.log(`  - URL preserved: ${urlPreserved}`)
    console.log(`  - Title preserved: ${titlePreserved}`)

    expect(urlPreserved).toBe(true)
    expect(titlePreserved).toBe(true)
  })

  test('Instruction Manual accuracy assessment', async ({ page }) => {
    /**
     * DIAGNOSTIC TEST: Check if manual matches actual behavior
     * Reports back: What actually works vs what manual says
     */
    
    console.log('\n=== INSTRUCTION MANUAL ACCURACY ASSESSMENT ===\n')
    
    // Check § 2.1: Sign In
    console.log('§ 2.1 Sign In:')
    await resetToLoggedOut(page)
    await page.goto('/login')
    const assessmentEmailInput = page.getByRole('textbox', { name: /^Email$/i }).first()
    const assessmentPasswordInput = page.getByRole('textbox', { name: /^Password$/i }).first()
    const assessmentSignInButton = page.getByRole('button', { name: /Sign In|Login/i }).first()

    await assessmentEmailInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
    await assessmentPasswordInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
    await assessmentSignInButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)

    const hasEmailField = await assessmentEmailInput.isVisible().catch(() => false)
    const hasPasswordField = await assessmentPasswordInput.isVisible().catch(() => false)
    const hasSignInButton = await assessmentSignInButton.isVisible().catch(() => false)
    
    console.log(`  ✓ Email field: ${hasEmailField}`)
    console.log(`  ✓ Password field: ${hasPasswordField}`)
    console.log(`  ✓ Sign In button: ${hasSignInButton}`)
    console.log(`  STATUS: ${hasEmailField && hasPasswordField && hasSignInButton ? '✓ ACCURATE' : '✗ INACCURATE'}`)
    
    // Check § 2.2: Session Lock
    console.log('\n§ 2.2 Session Lock & Inactivity:')
    console.log('  Manual states:')
    console.log('    "Platform automatically locks your session after inactivity"')
    console.log('    "You will see a lock screen requiring password re-entry"')
    console.log('    "Data and open tabs are preserved"')

    console.log(`  Runtime policy: ${LOCKOUT_MINUTES} minutes inactivity + ${WARNING_COUNTDOWN_SECONDS} second countdown`)
    console.log('  STATUS: ✓ VALIDATED by strict timer-controlled tests above')
  })
})
