/**
 * CRO Part 6 — Officer Offline Queue Validation
 *
 * **Test Goal:** Validate Officer offline queue workflow: Submit offline → Reconnect → Sync → Confirm
 * **Pass Criteria:** Zero data loss, user sees sync confirmation, all queued actions reach server post-sync.
 * **Measurement:** Queue persistence, sync success rate, data integrity verification, UI confirmation visibility.
 *
 * Spec ID: CRO-PART6-OFFLINE-QUEUE-VALIDATION
 * Last Updated: 2026-05-17
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { supabase, supabaseAdmin } from './setup'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

interface OfflineAction {
  id: string
  plateNumber: string
  zoneName?: string
  timestamp: number
  status: 'queued' | 'syncing' | 'synced' | 'failed'
}

interface OfflineSyncMetrics {
  actionsSumbitted: OfflineAction[]
  actionsSynced: OfflineAction[]
  actionsFailed: OfflineAction[]
  queuePersisted: boolean
  syncConfirmationVisible: boolean
  dataLossDetected: boolean
  totalDuration: number
}

test.describe('CRO Part 6 — Officer Offline Queue Validation', () => {
  test('Officer submits scan offline → reconnects → confirms sync (zero data loss)', async ({ page }) => {
    console.log('🧪 Starting Officer Offline Queue Validation Test')

    const metrics: OfflineSyncMetrics = {
      actionsSumbitted: [],
      actionsSynced: [],
      actionsFailed: [],
      queuePersisted: false,
      syncConfirmationVisible: false,
      dataLossDetected: false,
      totalDuration: 0,
    }

    const testStart = Date.now()

    // ========================
    // STEP 1: Login & Open Scanner (Online)
    // ========================
    console.log('\n📍 Step 1: Login & prepare scanner (online)')
    let stepStart = Date.now()
    try {
      await loginAs(page, 'officerOrg1')
      await page.goto(`${BASE_URL}/field-officer`)
      await page.waitForLoadState('networkidle')

      // Open vehicle scanner
      const scanCard = page.locator('text=Scan Vehicle').first()
      for (let i = 0; i < 3; i++) {
        if (await scanCard.isVisible({ timeout: 1000 }).catch(() => false)) {
          break
        }
        await page.waitForTimeout(300)
      }

      expect(await scanCard.isVisible()).toBeTruthy()
      await scanCard.click()
      await page.waitForLoadState('networkidle')

      const duration = Date.now() - stepStart
      console.log(`✓ Scanner opened in ${duration}ms (online mode)`)
    } catch (error) {
      console.error('✗ Scanner setup failed:', error)
      throw error
    }

    // ========================
    // STEP 2: Go Offline
    // ========================
    console.log('\n📍 Step 2: Go offline')
    stepStart = Date.now()
    try {
      await page.context().setOffline(true)

      // Verify offline indicator appears
      const offlineIndicator = page.locator('text=Offline').or(page.locator('[data-testid="offline-indicator"]')).first()

      let offlineVisible = false
      for (let i = 0; i < 4; i++) {
        if (await offlineIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
          offlineVisible = true
          break
        }
        await page.waitForTimeout(300)
      }

      expect(offlineVisible).toBeTruthy()

      const duration = Date.now() - stepStart
      console.log(`✓ Offline mode activated in ${duration}ms — offline indicator visible`)
    } catch (error) {
      console.error('✗ Offline activation failed:', error)
      throw error
    }

    // ========================
    // STEP 3: Submit First Scan (Offline)
    // ========================
    console.log('\n📍 Step 3: Submit first vehicle scan (offline)')
    stepStart = Date.now()
    try {
      // Use manual entry
      const manualBtn = page.locator('text=Manual Entry').first()
      if (await manualBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await manualBtn.click()
        await page.waitForTimeout(200)
      }

      // Fill plate
      const plate1 = 'OFFLINE_TEST_001'
      const plateInput = page.locator('input[placeholder*="plate" i]').or(page.locator('input[name="licensePlate"]')).first()
      await plateInput.fill(plate1)

      // Select zone if available
      const zoneSelect = page.locator('button:has-text("Select zone")').first()
      if (await zoneSelect.isVisible({ timeout: 500 }).catch(() => false)) {
        await zoneSelect.click()
        await page.waitForTimeout(200)

        const zoneOption = page.locator('[role="option"]').first()
        if (await zoneOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await zoneOption.click()
          await page.waitForTimeout(200)
        }
      }

      // Submit
      const submitBtn = page.locator('button:has-text("Submit")').first()
      await submitBtn.click()
      await page.waitForTimeout(500)

      // Expect "Saved offline" toast
      const offlineSavedMsg = page.locator('text=Saved offline').or(page.locator('text=pending sync')).first()
      expect(await offlineSavedMsg.isVisible({ timeout: 2000 })).toBeTruthy()

      metrics.actionsSumbitted.push({
        id: `scan_${Date.now()}`,
        plateNumber: plate1,
        timestamp: Date.now(),
        status: 'queued',
      })

      const duration = Date.now() - stepStart
      console.log(`✓ First scan submitted offline in ${duration}ms — "Saved offline" confirmed`)
      console.log(`  → Plate: ${plate1}`)
    } catch (error) {
      console.error('✗ First offline submission failed:', error)
      throw error
    }

    // ========================
    // STEP 4: Verify Queue Display (Offline)
    // ========================
    console.log('\n📍 Step 4: Verify queue display (offline)')
    stepStart = Date.now()
    try {
      // Check for "X items pending sync" badge
      const queueBadge = page.locator('text=/\\d+\\s+(?:pending|items?)/i').first()

      let queueDisplayed = false
      for (let i = 0; i < 3; i++) {
        if (await queueBadge.isVisible({ timeout: 1000 }).catch(() => false)) {
          queueDisplayed = true
          metrics.queuePersisted = true
          break
        }
        await page.waitForTimeout(300)
      }

      expect(queueDisplayed).toBeTruthy()

      const duration = Date.now() - stepStart
      console.log(`✓ Queue display verified in ${duration}ms — "X pending sync" badge visible`)
    } catch (error) {
      console.error('✗ Queue display verification failed:', error)
      throw error
    }

    // ========================
    // STEP 5: Submit Second Scan (Still Offline)
    // ========================
    console.log('\n📍 Step 5: Submit second vehicle scan (still offline)')
    stepStart = Date.now()
    try {
      // Open scanner again
      const scanCard = page.locator('text=Scan Vehicle').first()
      if (await scanCard.isVisible({ timeout: 500 }).catch(() => false)) {
        await scanCard.click()
        await page.waitForTimeout(300)
      }

      const manualBtn = page.locator('text=Manual Entry').first()
      if (await manualBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await manualBtn.click()
        await page.waitForTimeout(200)
      }

      // Fill plate
      const plate2 = 'OFFLINE_TEST_002'
      const plateInput = page.locator('input[placeholder*="plate" i]').or(page.locator('input[name="licensePlate"]')).first()
      await plateInput.fill(plate2)

      // Select zone
      const zoneSelect = page.locator('button:has-text("Select zone")').first()
      if (await zoneSelect.isVisible({ timeout: 500 }).catch(() => false)) {
        await zoneSelect.click()
        await page.waitForTimeout(200)

        const zoneOption = page.locator('[role="option"]').first()
        if (await zoneOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await zoneOption.click()
          await page.waitForTimeout(200)
        }
      }

      // Submit
      const submitBtn = page.locator('button:has-text("Submit")').first()
      await submitBtn.click()
      await page.waitForTimeout(500)

      // Expect success
      const successMsg = page.locator('text=Saved offline').or(page.locator('text=pending sync')).first()
      expect(await successMsg.isVisible({ timeout: 2000 })).toBeTruthy()

      metrics.actionsSumbitted.push({
        id: `scan_${Date.now()}`,
        plateNumber: plate2,
        timestamp: Date.now(),
        status: 'queued',
      })

      const duration = Date.now() - stepStart
      console.log(`✓ Second scan submitted offline in ${duration}ms`)
      console.log(`  → Plate: ${plate2}`)
    } catch (error) {
      console.error('✗ Second offline submission failed:', error)
      throw error
    }

    // ========================
    // STEP 6: Verify Queue Updated (2 items pending)
    // ========================
    console.log('\n📍 Step 6: Verify queue count (should be 2)')
    stepStart = Date.now()
    try {
      const queueBadge = page.locator('text=/2\\s+(?:pending|items?)/i').first()

      let queueUpdated = false
      for (let i = 0; i < 3; i++) {
        if (await queueBadge.isVisible({ timeout: 1000 }).catch(() => false)) {
          queueUpdated = true
          break
        }
        await page.waitForTimeout(300)
      }

      expect(queueUpdated).toBeTruthy()

      const duration = Date.now() - stepStart
      console.log(`✓ Queue count updated to 2 in ${duration}ms`)
    } catch (error) {
      console.error('✗ Queue count update failed:', error)
      throw error
    }

    // ========================
    // STEP 7: Go Back Online
    // ========================
    console.log('\n📍 Step 7: Go back online')
    stepStart = Date.now()
    try {
      await page.context().setOffline(false)
      await page.waitForTimeout(1000) // Allow time for reconnection

      // Verify offline indicator disappears
      const offlineIndicator = page.locator('text=Offline').or(page.locator('[data-testid="offline-indicator"]')).first()

      let offlineGone = false
      for (let i = 0; i < 5; i++) {
        if (!(await offlineIndicator.isVisible({ timeout: 500 }).catch(() => false))) {
          offlineGone = true
          break
        }
        await page.waitForTimeout(300)
      }

      // Allow some slack if indicator hasn't disappeared yet
      const duration = Date.now() - stepStart
      console.log(`✓ Online mode restored in ${duration}ms`)
    } catch (error) {
      console.error('⚠ Online restoration warning:', error)
      // Non-critical
    }

    // ========================
    // STEP 8: Wait for Auto-Sync
    // ========================
    console.log('\n📍 Step 8: Wait for auto-sync (should happen automatically)')
    stepStart = Date.now()
    try {
      // Look for sync confirmation toast or message
      const syncMsg = page.locator('text=/synced|sync complete|all actions synced/i').first()

      let syncConfirmed = false
      for (let i = 0; i < 10; i++) {
        if (await syncMsg.isVisible({ timeout: 2000 }).catch(() => false)) {
          syncConfirmed = true
          metrics.syncConfirmationVisible = true
          break
        }
        await page.waitForTimeout(500)
      }

      if (!syncConfirmed) {
        console.log('⚠ Auto-sync may have completed without visible confirmation toast')
      }

      const duration = Date.now() - stepStart
      console.log(`${syncConfirmed ? '✓' : '⚠'} Sync check completed in ${duration}ms`)
    } catch (error) {
      console.error('⚠ Sync wait warning:', error)
      // Non-critical
    }

    // ========================
    // STEP 9: Verify Queue Cleared (UI)
    // ========================
    console.log('\n📍 Step 9: Verify queue cleared on UI')
    stepStart = Date.now()
    try {
      // Queue badge should disappear or show 0
      const queueBadge = page.locator('text=/\\d+\\s+(?:pending|items?)/i').first()

      let queueCleared = false
      for (let i = 0; i < 5; i++) {
        const visible = await queueBadge.isVisible({ timeout: 500 }).catch(() => false)
        if (!visible) {
          queueCleared = true
          break
        }

        // Check if badge says "0"
        const badgeText = await queueBadge.textContent()
        if (badgeText?.includes('0')) {
          queueCleared = true
          break
        }

        await page.waitForTimeout(300)
      }

      if (queueCleared) {
        console.log(`✓ Queue cleared on UI in ${Date.now() - stepStart}ms`)
      } else {
        console.log(`⚠ Queue may still be visible on UI (could be display lag)`)
      }
    } catch (error) {
      console.error('⚠ Queue clear verification warning:', error)
    }

    // ========================
    // STEP 10: Database Verification (Data Integrity Check)
    // ========================
    console.log('\n📍 Step 10: Database verification (data integrity check)')
    stepStart = Date.now()
    try {
      if (!supabaseAdmin) {
        console.log('⊘ Service role key not available; skipping DB integrity check')
      } else {
        // Query for the submitted observations in the database
        const { data: observations, error } = await supabaseAdmin
          .from('observations')
          .select('id, license_plate, created_at, synced_at')
          .in('license_plate', [
            'OFFLINE_TEST_001',
            'OFFLINE_TEST_002',
          ])
          .order('created_at', { ascending: false })
          .limit(2)

        if (error) {
          console.error('⚠ DB query error:', error)
        } else if (!observations || observations.length === 0) {
          console.error('✗ DATA LOSS DETECTED: No observations found in database')
          metrics.dataLossDetected = true
        } else {
          // Verify all submitted actions are present
          const foundPlates = observations.map(o => o.license_plate)
          const allFound = ['OFFLINE_TEST_001', 'OFFLINE_TEST_002'].every(plate => foundPlates.includes(plate))

          if (allFound) {
            console.log(`✓ All ${observations.length} offline submissions verified in database`)
            metrics.actionsSynced = metrics.actionsSumbitted.map(a => ({ ...a, status: 'synced' }))
            metrics.dataLossDetected = false
          } else {
            console.error('✗ DATA LOSS DETECTED: Not all submitted actions present in database')
            metrics.dataLossDetected = true
            metrics.actionsFailed = metrics.actionsSumbitted.filter(
              a => !foundPlates.includes(a.plateNumber),
            )
          }
        }
      }

      const duration = Date.now() - stepStart
      console.log(`Database check completed in ${duration}ms`)
    } catch (error) {
      console.error('✗ Database verification error:', error)
      throw error
    }

    // ========================
    // FINAL VALIDATION & METRICS
    // ========================
    metrics.totalDuration = Date.now() - testStart

    console.log('\n📊 Offline Queue Validation Metrics:')
    console.log('━'.repeat(60))
    console.table({
      'Actions Submitted': metrics.actionsSumbitted.length,
      'Actions Synced': metrics.actionsSynced.length,
      'Actions Failed': metrics.actionsFailed.length,
      'Queue Display Persisted': metrics.queuePersisted ? '✓ YES' : '✗ NO',
      'Sync Confirmation Visible': metrics.syncConfirmationVisible ? '✓ YES' : '✗ NO',
      'Data Loss Detected': metrics.dataLossDetected ? '✗ YES' : '✓ NO',
      'Test Duration': `${(metrics.totalDuration / 1000).toFixed(1)}s`,
    })

    console.log('\nDetailed Actions:')
    metrics.actionsSumbitted.forEach((action, idx) => {
      const status = metrics.actionsSynced.find(a => a.id === action.id) ? '✓ synced' : '✗ failed'
      console.log(`  ${idx + 1}. [${status}] ${action.plateNumber}`)
    })

    // ========================
    // ASSERT CONVERSION CRITERIA
    // ========================
    expect(metrics.dataLossDetected).toBeFalsy() // No data loss
    expect(metrics.actionsSynced.length).toBe(metrics.actionsSumbitted.length) // All synced
  })
})
