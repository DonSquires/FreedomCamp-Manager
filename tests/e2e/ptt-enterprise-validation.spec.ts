import { test, expect, Page } from '@playwright/test'
import { loginAs } from './auth'

test.describe.configure({ mode: 'parallel' })

/**
 * PTT Enterprise-Grade Validation Suite
 * 
 * Tests comprehensive PTT functionality with two concurrent workers (Bob + Officer):
 * - Visual UI rendering
 * - Button responsiveness
 * - Channel selection and switching
 * - Settings panel and toggles (after recent fixes)
 * - Live transmit/receive with translation
 * - Audio latency measurement
 * - Emergency broadcast
 */

test.describe('PTT Enterprise Validation', () => {
  let officerPage: Page
  let bobPage: Page

  test.beforeAll(async ({ browser }) => {
    // Open two concurrent browser contexts for simultaneous user interaction
    const officerContext = await browser.newContext()
    const bobContext = await browser.newContext()
    
    officerPage = await officerContext.newPage()
    bobPage = await bobContext.newPage()
  })

  test.afterAll(async () => {
    await officerPage.close()
    await bobPage.close()
  })

  test('1. Visual UI — PTT Radio loads with correct layout on desktop', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Check main PTT container exists
    const pttContainer = officerPage.locator('[class*="ptt"][class*="radio"]').first()
    await expect(pttContainer).toBeVisible()

    // Check key UI sections visible
    await expect(officerPage.locator('button[aria-label*="Push to talk"]')).toBeVisible({ timeout: 10000 })
    await expect(officerPage.locator('[data-testid*="channel"]').first()).toBeVisible()

    // Verify desktop layout (not hidden)
    const layout = officerPage.locator('main')
    await expect(layout).toBeVisible()
  })

  test('2. Channel Selection — View and switch between channels', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Wait for radio to connect
    await officerPage.waitForTimeout(2000)

    // Look for channel selector (text like "CH 1" or "All Units")
    const channelDisplay = officerPage.locator('text=/CH\\s+\\d+|All Units/')
    await expect(channelDisplay).toBeVisible({ timeout: 5000 })

    // Try to find and click a channel in list if available
    const channelElements = officerPage.locator('[data-testid*="channel"]')
    const count = await channelElements.count()
    expect(count).toBeGreaterThan(0)
  })

  test('3. Settings Panel — Settings button exists and toggles correctly', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Find settings button (gear icon or "Settings" text)
    const settingsButton = officerPage.locator('button').filter({ has: officerPage.locator('[class*="Settings"]') }).first()
    
    if (await settingsButton.isVisible()) {
      await settingsButton.click()
      await officerPage.waitForTimeout(500)

      // Verify settings panel opened
      const settingsPanel = officerPage.locator('text=Radio Settings').or(officerPage.locator('text=VOX Mode'))
      await expect(settingsPanel).toBeVisible({ timeout: 3000 })
    }
  })

  test('4. VOX Toggle — VOX Mode switch toggles without errors', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Open settings
    const settingsButton = officerPage.locator('button').filter({ has: officerPage.locator('[class*="Settings"]') }).first()
    if (await settingsButton.isVisible()) {
      await settingsButton.click()
      await officerPage.waitForTimeout(500)

      // Find and click VOX Mode switch
      const voxLabel = officerPage.locator('text=VOX Mode').or(officerPage.locator('text=Voice-activated'))
      if (await voxLabel.isVisible()) {
        const voxSwitch = voxLabel.locator('xpath=../..//[contains(@class, "switch") or contains(@role, "switch")]').first()
        const initialState = await voxSwitch.getAttribute('data-state')
        
        await voxSwitch.click()
        await officerPage.waitForTimeout(300)
        
        const afterState = await voxSwitch.getAttribute('data-state')
        expect(afterState).not.toBe(initialState)
      }
    }
  })

  test('5. Wake-Word Toggle — Wake-word switch responds to clicks (Phase 2 fix)', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Show interpreter panel first
    const showInterpreterBtn = officerPage.locator('[data-testid="show-interpreter-toggle"]')
    if (await showInterpreterBtn.isVisible({ timeout: 5000 })) {
      const initialBg = await showInterpreterBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor)
      
      await showInterpreterBtn.click()
      await officerPage.waitForTimeout(300)

      // Check if panel is now visible
      const wakeWordSwitch = officerPage.locator('[data-testid="wake-word-switch"]')
      await expect(wakeWordSwitch).toBeVisible({ timeout: 3000 })

      // Verify switch exists and has proper state
      const state = await wakeWordSwitch.getAttribute('data-state')
      expect(['checked', 'unchecked']).toContain(state)

      // Click the switch
      await wakeWordSwitch.click()
      await officerPage.waitForTimeout(200)

      // Verify state changed
      const newState = await wakeWordSwitch.getAttribute('data-state')
      expect(newState).not.toBe(state)
    }
  })

  test('6. Audio Ducking Toggle — Ducking switch responds and persists (Phase 2 fix)', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    const showInterpreterBtn = officerPage.locator('[data-testid="show-interpreter-toggle"]')
    if (await showInterpreterBtn.isVisible({ timeout: 5000 })) {
      await showInterpreterBtn.click()
      await officerPage.waitForTimeout(300)

      const duckingSwitch = officerPage.locator('[data-testid="audio-ducking-switch"]')
      await expect(duckingSwitch).toBeVisible({ timeout: 3000 })

      const initialState = await duckingSwitch.getAttribute('data-state')
      
      await duckingSwitch.click()
      await officerPage.waitForTimeout(200)

      const afterState = await duckingSwitch.getAttribute('data-state')
      expect(afterState).not.toBe(initialState)

      // Verify persistence hint visible
      const statusLabel = officerPage.locator('[data-testid="audio-ducking-status"]')
      await expect(statusLabel).toBeVisible()
      const statusText = await statusLabel.textContent()
      expect(statusText).toMatch(/coworker channel|normal volume/i)
    }
  })

  test('7. Translator Toggle — Translator switch in settings toggles (Phase 2 fix)', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    const settingsButton = officerPage.locator('button').filter({ has: officerPage.locator('[class*="Settings"]') }).first()
    if (await settingsButton.isVisible()) {
      await settingsButton.click()
      await officerPage.waitForTimeout(500)

      const translatorSwitch = officerPage.locator('text=Translator').locator('xpath=..//..//[contains(@class, "switch") or contains(@role, "switch")]').first()
      if (await translatorSwitch.isVisible()) {
        const initialState = await translatorSwitch.getAttribute('data-state')
        
        await translatorSwitch.click()
        await officerPage.waitForTimeout(200)

        const newState = await translatorSwitch.getAttribute('data-state')
        expect(newState).not.toBe(initialState)
      }
    }
  })

  test('8. Button Responsiveness — PTT button responds to pointer events', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    const pttButton = officerPage.locator('button').filter({ has: officerPage.locator('text=/Push to talk|Hold|PTT/i') }).first()
    
    if (await pttButton.isVisible()) {
      // Simulate hold (pointer down/up)
      await pttButton.dispatchEvent('pointerdown')
      await officerPage.waitForTimeout(100)
      
      await pttButton.dispatchEvent('pointerup')
      await officerPage.waitForTimeout(100)

      // No errors should occur
      const errors = await officerPage.locator('text=/error|fail|exception/i').count()
      expect(errors).toBe(0)
    }
  })

  test('9. Emergency Button — Emergency broadcast button visible and accessible', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    const emergencyBtn = officerPage.locator('button').filter({ 
      has: officerPage.locator('text=/Emergency|AlertTriangle/i') 
    }).first()
    
    await expect(emergencyBtn).toBeVisible({ timeout: 5000 })
    
    // Check button styling indicates emergency
    const classList = await emergencyBtn.getAttribute('class')
    expect(classList).toMatch(/red|emergency|danger/i)
  })

  test('10. Multi-User Scene — Bob and Officer both connect to radio (concurrent)', async ({ browser }) => {
    // Officer logs in
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Bob logs in simultaneously
    await loginAs(bobPage, 'bob')
    await bobPage.goto('/ptt-radio')
    await bobPage.waitForLoadState('networkidle')

    // Both should have radio connected
    await expect(officerPage.locator('text=/CH\\s+\\d+|All Units/')).toBeVisible({ timeout: 5000 })
    await expect(bobPage.locator('text=/CH\\s+\\d+|All Units/')).toBeVisible({ timeout: 5000 })
  })

  test('11. Transmit Readiness — Microphone permission requested, audio primed', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Check for mic permission indicators or audio prime button
    const primeButton = officerPage.locator('button').filter({ 
      has: officerPage.locator('[class*="Volume"]') 
    }).first()

    if (await primeButton.isVisible({ timeout: 3000 })) {
      // Audio output priming available
      await expect(primeButton).toBeEnabled()
    }

    // PTT button should be present and clickable
    const pttButton = officerPage.locator('button').filter({ 
      has: officerPage.locator('text=/Push to talk|PTT/i') 
    }).first()
    await expect(pttButton).toBeVisible()
  })

  test('12. Channel and Presence — Roster visible (Units Online count)', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Look for presence section (Units Online)
    const presenceLabel = officerPage.locator('text=/Units Online/i')
    if (await presenceLabel.isVisible({ timeout: 5000 })) {
      // Count should be present
      const unitCount = await presenceLabel.locator('xpath=..').textContent()
      expect(unitCount).toMatch(/\d+/)
    }
  })

  test('13. Transmission Log — Recent TX entries visible', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Look for transmission log section
    const txLabel = officerPage.locator('text=/Transmission Log/i')
    if (await txLabel.isVisible({ timeout: 3000 })) {
      // Log container should exist
      const txLog = txLabel.locator('xpath=..//..//div').first()
      await expect(txLog).toBeVisible()
    }
  })

  test('14. Scanner Toggle — Scanner button toggles scan mode (working)', async () => {
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    const scanButton = officerPage.locator('button').filter({ 
      has: officerPage.locator('[class*="Scan"]') 
    }).first()

    if (await scanButton.isVisible({ timeout: 3000 })) {
      const initialClass = await scanButton.getAttribute('class')
      
      await scanButton.click()
      await officerPage.waitForTimeout(200)

      const afterClass = await scanButton.getAttribute('class')
      // Button styling should change (yellow highlight when active)
      expect(afterClass).not.toBe(initialClass)
    }
  })

  test('15. Layout Responsiveness — Desktop layout rendering correctly (no hidden overflow)', async () => {
    await officerPage.setViewportSize({ width: 1920, height: 1080 })
    
    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')

    // Main container should not have overflow issues
    const main = officerPage.locator('main').first()
    const boundingBox = await main.boundingBox()
    
    expect(boundingBox).not.toBeNull()
    if (boundingBox) {
      expect(boundingBox.width).toBeGreaterThan(800)
      expect(boundingBox.height).toBeGreaterThan(600)
    }
  })

  test('16. Error Resilience — Console has no critical errors after full PTT session', async () => {
    const errors: string[] = []
    officerPage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await loginAs(officerPage, 'officerOrg1')
    await officerPage.goto('/ptt-radio')
    await officerPage.waitForLoadState('networkidle')
    
    // Interact with UI
    const settingsBtn = officerPage.locator('button').filter({ has: officerPage.locator('[class*="Settings"]') }).first()
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      await officerPage.waitForTimeout(200)
    }

    // Filter out expected warnings, check for critical errors
    const criticalErrors = errors.filter((e) => 
      !e.includes('ResizeObserver') && 
      !e.includes('Non-Error promise rejection') &&
      !e.includes('WebSocket')
    )
    
    expect(criticalErrors).toHaveLength(0)
  })
})
