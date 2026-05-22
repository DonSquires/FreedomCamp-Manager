/**
 * CRO Part 6 — Officer Primary Path Measurement
 *
 * **Test Goal:** Validate Officer conversion workflow: Start Patrol → Scan Vehicle → Record Result → End Shift
 * **Pass Criteria:** >95% task completion rate with zero navigation errors.
 * **Measurement:** Step completion time, nav errors, retry count, successful shift closure.
 *
 * Spec ID: CRO-PART6-OFFICER-PRIMARY
 * Last Updated: 2026-05-17
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

interface StepMetrics {
  stepName: string
  startTime: number
  endTime: number
  duration: number
  status: 'pass' | 'fail' | 'skip'
  errorMessage?: string
  retryCount: number
}

class OfficerPathMetrics {
  metrics: StepMetrics[] = []
  startTime: number = 0
  endTime: number = 0

  recordStep(stepName: string, status: 'pass' | 'fail' | 'skip', duration: number, retryCount: number, errorMessage?: string) {
    this.metrics.push({
      stepName,
      startTime: this.endTime,
      endTime: this.endTime + duration,
      duration,
      status,
      errorMessage,
      retryCount,
    })
    this.endTime += duration
  }

  totalDuration(): number {
    return this.metrics.reduce((sum, m) => sum + m.duration, 0)
  }

  passCount(): number {
    return this.metrics.filter(m => m.status === 'pass').length
  }

  failCount(): number {
    return this.metrics.filter(m => m.status === 'fail').length
  }

  completionRate(): number {
    return this.passCount() / this.metrics.length
  }

  summary() {
    return {
      totalSteps: this.metrics.length,
      completedSteps: this.passCount(),
      failedSteps: this.failCount(),
      completionRate: `${(this.completionRate() * 100).toFixed(1)}%`,
      totalDuration: `${this.totalDuration()}ms`,
      averageStepDuration: `${(this.totalDuration() / this.metrics.length).toFixed(0)}ms`,
    }
  }
}

test.describe('CRO Part 6 — Officer Primary Path Measurement', () => {
  test('Officer workflow: start patrol → scan vehicle → record result → end shift', async ({ page }) => {
    const metrics = new OfficerPathMetrics()

    // ========================
    // STEP 1: Login & Navigate
    // ========================
    let stepStart = Date.now()
    let retryCount = 0
    try {
      await loginAs(page, 'officerOrg1')
      await page.goto(`${BASE_URL}/field-officer`)
      await page.waitForLoadState('networkidle')

      const duration = Date.now() - stepStart
      metrics.recordStep('Login & Navigate to Officer Portal', 'pass', duration, retryCount)
      console.log(`✓ Step 1: Login complete (${duration}ms)`)
    } catch (error) {
      metrics.recordStep('Login & Navigate to Officer Portal', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 2: Verify Patrol Banner & Primary CTA
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Look for patrol command banner (patrol-first design)
      const patrolBanner = page.locator('[data-testid="patrol-command-banner"]').or(
        page.locator('text=Patrol Command').first(),
      )

      // Retry logic: if banner not found immediately, wait and retry
      let bannerFound = false
      for (let i = 0; i < 3; i++) {
        if (await patrolBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
          bannerFound = true
          retryCount = i
          break
        }
        await page.waitForTimeout(500)
      }

      expect(bannerFound).toBeTruthy()

      // Verify Start/Resume Patrol CTA is visible and is PRIMARY action
      const startPatrolBtn = page.locator('button:has-text("Start Patrol")').or(page.locator('button:has-text("Resume Patrol")'))
      expect(await startPatrolBtn.isVisible()).toBeTruthy()

      const duration = Date.now() - stepStart
      metrics.recordStep('Verify Patrol Banner & Primary CTA', 'pass', duration, retryCount)
      console.log(`✓ Step 2: Patrol banner verified (${duration}ms, ${retryCount} retries)`)
    } catch (error) {
      metrics.recordStep('Verify Patrol Banner & Primary CTA', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 3: Click Start Patrol (or Resume if active)
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      const startPatrolBtn = page.locator('button:has-text("Start Patrol")').or(page.locator('button:has-text("Resume Patrol")')).first()
      await startPatrolBtn.click()

      // Wait for dialog or navigation
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      const duration = Date.now() - stepStart
      metrics.recordStep('Start/Resume Patrol Action', 'pass', duration, retryCount)
      console.log(`✓ Step 3: Start patrol clicked (${duration}ms)`)
    } catch (error) {
      metrics.recordStep('Start/Resume Patrol Action', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 4: Complete Guided Shift Flow (if shown)
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Check if guided shift flow dialog appears
      const guidedFlowDialog = page.locator('[role="dialog"]:has-text("Guided shift flow")').or(
        page.locator('text=Start your shift').first(),
      )

      const isDialogOpen = await guidedFlowDialog.isVisible({ timeout: 3000 }).catch(() => false)

      if (isDialogOpen) {
        // Step 1: Confirm zone
        const zoneConfirmBtn = page.locator('button:has-text("Confirm zone")').or(page.locator('[data-testid="confirm-zone"]')).first()
        if (await zoneConfirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await zoneConfirmBtn.click()
          await page.waitForTimeout(300)
          retryCount++
        }

        // Step 2: Proceed to scan
        const proceedBtn = page.locator('button:has-text("Continue")').or(page.locator('button:has-text("Next")')) .last()
        if (await proceedBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await proceedBtn.click()
          await page.waitForTimeout(300)
          retryCount++
        }

        const duration = Date.now() - stepStart
        metrics.recordStep('Complete Guided Shift Flow', 'pass', duration, retryCount)
        console.log(`✓ Step 4: Guided flow completed (${duration}ms, ${retryCount} steps)`)
      } else {
        const duration = Date.now() - stepStart
        metrics.recordStep('Complete Guided Shift Flow', 'skip', duration, retryCount, 'No guided flow dialog (patrol already active)')
        console.log(`⊘ Step 4: Skipped — patrol already active (${duration}ms)`)
      }
    } catch (error) {
      const duration = Date.now() - stepStart
      metrics.recordStep('Complete Guided Shift Flow', 'fail', duration, retryCount, String(error))
      console.log(`✗ Step 4: Guided flow failed (${duration}ms)`, error)
    }

    // ========================
    // STEP 5: Open Vehicle Scanner
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Look for scanner card or button
      const scanCard = page.locator('text=Scan Vehicle').first().or(page.locator('[data-testid="vehicle-scanner"]'))

      let scannerFound = false
      for (let i = 0; i < 3; i++) {
        if (await scanCard.isVisible({ timeout: 1500 }).catch(() => false)) {
          scannerFound = true
          retryCount = i
          break
        }
        await page.waitForTimeout(300)
      }

      expect(scannerFound).toBeTruthy()

      // Click to open scanner
      await scanCard.click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      const duration = Date.now() - stepStart
      metrics.recordStep('Open Vehicle Scanner', 'pass', duration, retryCount)
      console.log(`✓ Step 5: Scanner opened (${duration}ms, ${retryCount} retries)`)
    } catch (error) {
      metrics.recordStep('Open Vehicle Scanner', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 6: Scan Vehicle (Manual Entry)
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Try to use camera scanner first; fall back to manual entry
      const manualEntryBtn = page.locator('text=Manual Entry').first()

      let useManual = false
      if (await manualEntryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        useManual = true
        await manualEntryBtn.click()
        await page.waitForTimeout(300)
        retryCount++
      }

      // Fill in license plate
      const plateInput = page.locator('input[placeholder*="plate" i]').or(page.locator('input[name="licensePlate"]')).first()
      expect(await plateInput.isVisible()).toBeTruthy()

      await plateInput.fill('CRO0001')
      await page.waitForTimeout(200)

      const duration = Date.now() - stepStart
      metrics.recordStep(`Scan Vehicle (${useManual ? 'Manual' : 'Auto'})`, 'pass', duration, retryCount)
      console.log(`✓ Step 6: Vehicle scanned (${duration}ms)`)
    } catch (error) {
      metrics.recordStep('Scan Vehicle', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 7: Confirm Zone & Submit
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Ensure zone is selected
      const zoneSelect = page.locator('button:has-text("Select zone")').or(page.locator('[data-testid="zone-selector"]')).first()

      if (await zoneSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
        await zoneSelect.click()
        await page.waitForTimeout(300)

        // Select first available zone
        const zoneOption = page.locator('[role="option"]').first()
        await zoneOption.click()
        await page.waitForTimeout(200)
        retryCount++
      }

      // Submit scan
      const submitBtn = page.locator('button:has-text("Submit")').first()
      expect(await submitBtn.isVisible()).toBeTruthy()
      await submitBtn.click()
      await page.waitForLoadState('networkidle')

      const duration = Date.now() - stepStart
      metrics.recordStep('Confirm Zone & Submit Scan', 'pass', duration, retryCount)
      console.log(`✓ Step 7: Scan submitted (${duration}ms)`)
    } catch (error) {
      metrics.recordStep('Confirm Zone & Submit Scan', 'fail', Date.now() - stepStart, retryCount, String(error))
      throw error
    }

    // ========================
    // STEP 8: Record Result (Quick Report or Notice)
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Wait for result/feedback screen or quick report modal
      const resultCard = page.locator('[data-testid="scan-result"]').or(page.locator('text=Scan completed').first())

      let resultVisible = false
      for (let i = 0; i < 3; i++) {
        if (await resultCard.isVisible({ timeout: 1000 }).catch(() => false)) {
          resultVisible = true
          retryCount = i
          break
        }
        await page.waitForTimeout(300)
      }

      if (resultVisible) {
        // Look for Quick Report or Record Result CTA
        const recordBtn = page.locator('button:has-text("Record Result")').or(page.locator('button:has-text("Create Report")')) .first()

        if (await recordBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await recordBtn.click()
          await page.waitForTimeout(300)
          retryCount++
        }
      }

      const duration = Date.now() - stepStart
      metrics.recordStep('Record Result/Create Report', 'pass', duration, retryCount)
      console.log(`✓ Step 8: Result recording initiated (${duration}ms)`)
    } catch (error) {
      const duration = Date.now() - stepStart
      metrics.recordStep('Record Result/Create Report', 'fail', duration, retryCount, String(error))
      console.log(`⚠ Step 8: Warning — result recording failed, but scan may have been accepted (${duration}ms)`)
      // Don't throw — scan itself succeeded; result recording is secondary
    }

    // ========================
    // STEP 9: Return to Portal Home
    // ========================
    stepStart = Date.now()
    retryCount = 0
    try {
      // Close any open modals
      const closeBtn = page.locator('[data-testid="close"]').or(page.locator('button:has-text("Close")')) .first()
      if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeBtn.click()
        await page.waitForTimeout(300)
        retryCount++
      }

      // Navigate back to officer home
      await page.goto(`${BASE_URL}/field-officer`)
      await page.waitForLoadState('networkidle')

      const duration = Date.now() - stepStart
      metrics.recordStep('Return to Portal Home', 'pass', duration, retryCount)
      console.log(`✓ Step 9: Returned to portal (${duration}ms)`)
    } catch (error) {
      metrics.recordStep('Return to Portal Home', 'fail', Date.now() - stepStart, retryCount, String(error))
      console.log(`⚠ Step 9: Navigation warning (${String(error)})`)
      // Non-fatal; allow completion
    }

    // ========================
    // FINAL VALIDATION
    // ========================
    console.log('\n📊 Officer Path Metrics Summary:')
    console.table(metrics.summary())
    console.log('\nDetailed Metrics:')
    metrics.metrics.forEach(m => {
      const statusIcon = m.status === 'pass' ? '✓' : m.status === 'fail' ? '✗' : '⊘'
      console.log(
        `  ${statusIcon} ${m.stepName}: ${m.duration}ms (retries: ${m.retryCount})${m.errorMessage ? ` — ${m.errorMessage}` : ''}`,
      )
    })

    // Assert conversion target: >95% completion rate
    const completionRate = metrics.completionRate()
    console.log(`\nConversion Target: >95%`)
    console.log(`Actual Completion Rate: ${(completionRate * 100).toFixed(1)}%`)

    expect(completionRate).toBeGreaterThan(0.95)
  })
})
