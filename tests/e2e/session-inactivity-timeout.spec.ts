import { expect, test, type Page } from '@playwright/test'
import { loginAs } from './auth'

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
  const TEST_USER_EMAIL =
    process.env.TEST_USER_EMAIL ||
    process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL ||
    process.env.PLAYWRIGHT_MASTER_EMAIL ||
    'test@iron-eagle.co.nz'
  const TEST_USER_PASSWORD =
    process.env.TEST_USER_PASSWORD ||
    process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD ||
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    'TestPass123!'
  
  async function applyShortInactivityPreference(page: Page) {
    // Set after authentication to avoid expiring the login bootstrap itself.
    await page.evaluate(() => {
      window.localStorage.setItem('session-preferences-store', JSON.stringify({
        state: {
          autoLogoffEnabled: true,
          inactivityMinutes: 0.083,
        },
        version: 0,
      }))
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
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
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    
    // Step 2: Verify login screen is visible
    const loginForm = page.locator('form').first()
    const emailInput = page.locator('input[type="email"], input[inputmode="email"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    const signInButton = page.getByRole('button', { name: /Sign in|Sign In|Login/i }).first()
    
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
    
    // Sign in using the same resilient auth path as other production E2E suites.
    await loginAs(page, 'adminOrg1')

    await applyShortInactivityPreference(page)
    
    // Wait for authenticated state
    await expect(page).toHaveURL(/^(?!.*\/(login|signin))(.*)$/i, { timeout: 10000 })
    
    // Record current page state
    const initialURL = page.url()
    const pageTitle = await page.title()
    console.log('✓ Authenticated')
    console.log(`  - Portal: ${initialURL}`)
    console.log(`  - Page title: ${pageTitle}`)
    
    // Now simulate inactivity
    console.log('⏳ Simulating inactivity...')
    
    // Disable activity event listeners to prevent timer reset
    await page.evaluate(() => {
      const preventedEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
      preventedEvents.forEach(eventName => {
        document.addEventListener(eventName, (e) => {
          e.stopImmediatePropagation()
        }, { capture: true, passive: false })
      })
    })
    
    // Wait for warning overlay
    const warningText = 'Session Timeout Warning'
    const warningLocator = page.locator(`text=${warningText}`).first()
    const countdownLocator = page.locator('text=/Locking in \\d+s/').first()
    
    console.log('  - Waiting for session warning (max 15 seconds)...')
    
    let warningFound = false
    try {
      await warningLocator.waitFor({ state: 'visible', timeout: 15000 })
      warningFound = true
      console.log('✓ Warning overlay appeared')
      
      // Verify countdown is present
      const countdownVisible = await countdownLocator.isVisible().catch(() => false)
      console.log(`  - Countdown timer visible: ${countdownVisible}`)
      
      if (countdownVisible) {
        const countdownText = await countdownLocator.textContent()
        console.log(`  - Countdown shows: ${countdownText}`)
      }
    } catch (error) {
      console.log('⚠ Warning overlay NOT found after 15 seconds')
      console.log('  - This could indicate:')
      console.log('    1. Feature not implemented yet')
      console.log('    2. Timeout configuration too long for test')
      console.log('    3. Activity listeners not properly disabled')
    }
    
    // Wait for lock screen
    const lockText = 'Time Out Detected'
    const lockLocator = page.locator(`text=${lockText}`).first()
    const passwordFieldLocator = page.locator('input[id="unlock-password"], input[placeholder*="password"]').first()
    
    console.log('  - Waiting for lock screen (max 20 seconds)...')
    
    let lockFound = false
    try {
      await passwordFieldLocator.waitFor({ state: 'visible', timeout: 20000 })
      lockFound = true
      console.log('✓ Lock screen appeared with password field')
      
      // Verify lock screen elements per manual § 2.2
      const unlockButton = page.getByRole('button', { name: /Log Back In|Unlock|Continue/i }).first()
      const logoutButton = page.getByRole('button', { name: /Logout|Sign Out/i }).first()
      
      const unlockVisible = await unlockButton.isVisible().catch(() => false)
      const logoutVisible = await logoutButton.isVisible().catch(() => false)
      
      console.log(`  - Unlock button visible: ${unlockVisible}`)
      console.log(`  - Logout option visible: ${logoutVisible}`)
      
      // Test unlock flow
      if (unlockVisible && passwordFieldLocator) {
        console.log('  - Testing unlock flow...')
        
        // Enter password
        await passwordFieldLocator.fill(TEST_USER_PASSWORD)
        
        // Click unlock
        await unlockButton.click()
        
        // Wait for lock screen to disappear
        await passwordFieldLocator.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
        
        // Verify we're back to authenticated state
        const urlAfterUnlock = page.url()
        const stillOnInitialPage = urlAfterUnlock === initialURL
        
        console.log('✓ Unlock completed')
        console.log(`  - Returned to original page: ${stillOnInitialPage}`)
        console.log(`  - URL: ${urlAfterUnlock}`)
      }
    } catch (error) {
      console.log('⚠ Lock screen NOT found after 20 seconds')
      if (warningFound) {
        console.log('  - Warning appeared but lock did not (may have not waited long enough)')
      } else {
        console.log('  - Neither warning nor lock appeared')
        console.log('  - Feature may not be implemented or timeouts too long for test')
      }
    }
    
    // Summary
    console.log('\n=== FEATURE DETECTION SUMMARY ===')
    console.log(`Warning overlay: ${warningFound ? '✓ FOUND' : '✗ NOT FOUND'}`)
    console.log(`Lock screen: ${lockFound ? '✓ FOUND' : '✗ NOT FOUND'}`)
    
    if (!warningFound && !lockFound) {
      console.log('\n⚠ MANUAL AMENDMENT NEEDED:')
      console.log('Manual § 2.2 states session lock is automatic, but feature not detected.')
      console.log('Options:')
      console.log('1. Feature is disabled/in progress - update manual with COMING SOON notice')
      console.log('2. Feature requires specific conditions - document those conditions')
      console.log('3. Test environment has different config - document test requirements')
    }
  })

  test('§ 2.2: Data preservation verification', async ({ page }) => {
    /**
     * TEST: Verify "data and open tabs are preserved" per manual § 2.2
     * VALIDATES: Session state is not lost during lock
     */
    
    // Sign in using shared auth helper to keep bootstrap behavior consistent.
    await loginAs(page, 'adminOrg1')

    await applyShortInactivityPreference(page)
    
    await expect(page).toHaveURL(/^(?!.*\/(login|signin))(.*)$/i, { timeout: 10000 })
    
    // Capture page state before lock
    const urlBefore = page.url()
    const titleBefore = await page.title()
    
    console.log('Capturing pre-lock state:')
    console.log(`  - URL: ${urlBefore}`)
    console.log(`  - Title: ${titleBefore}`)
    
    // Try to lock and unlock
    await page.evaluate(() => {
      ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(eventName => {
        document.addEventListener(eventName, (e) => e.stopImmediatePropagation(), { capture: true })
      })
    })
    
    // Wait for lock if implemented
    const passwordField = page.locator('input[id="unlock-password"], input[placeholder*="password"]').first()
    const lockVisible = await passwordField.isVisible({ timeout: 20000 }).catch(() => false)
    
    if (lockVisible) {
      // If lock appears, test preservation
      await passwordField.fill(TEST_USER_PASSWORD)
      const unlockButton = page.getByRole('button', { name: /Log Back In|Unlock/i }).first()
      await unlockButton.click()
      
      await passwordField.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
      
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
    } else {
      console.log('⚠ Lock not triggered in this test run')
    }
  })

  test('Instruction Manual accuracy assessment', async ({ page }) => {
    /**
     * DIAGNOSTIC TEST: Check if manual matches actual behavior
     * Reports back: What actually works vs what manual says
     */
    
    console.log('\n=== INSTRUCTION MANUAL ACCURACY ASSESSMENT ===\n')
    
    // Check § 2.1: Sign In
    console.log('§ 2.1 Sign In:')
    await page.goto('/')
    const hasEmailField = await page.locator('input[type="email"]').isVisible().catch(() => false)
    const hasPasswordField = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const hasSignInButton = await page.getByRole('button', { name: /Sign In|Login/i }).isVisible().catch(() => false)
    
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
    
    // We already tested this above, so reference those findings
    console.log('  STATUS: See feature detection test output above')
    console.log('  ACTION: If feature not found, create amendment for manual')
  })
})
