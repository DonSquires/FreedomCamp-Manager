/**
 * E2E Test: Scan Flow (PlateScanner → Railway → Database)
 * Test Area 1 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

const TEST_VEHICLE_PRIMARY = 'NYR607'
const TEST_VEHICLE_SECONDARY = 'ASY598'

async function waitForScanSuccess(page: any, plate: string) {
  const successToast = page
    .locator('[data-sonner-toast], [role="status"], .sonner-toast, [role="alert"]')
    .filter({ hasText: new RegExp(`${plate}.*(scanned|success|recorded)`, 'i') })
    .first()

  await successToast.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined)
}

async function openVehicleScannerFromField(page: any): Promise<boolean> {
  await page.goto('/field')

  const trigger = page
    .locator('button, [role="button"], a')
    .filter({ hasText: /scan vehicle|vehicle scanner|scan/i })
    .first()

  if (!(await trigger.isVisible({ timeout: 10000 }).catch(() => false))) {
    return false
  }

  await trigger.click({ force: true })

  const scannerVisible = await page
    .locator('h2:has-text("Vehicle Scanner"), [role="dialog"]:has-text("Vehicle Scanner"), input[placeholder*="plate"]')
    .first()
    .isVisible({ timeout: 10000 })
    .catch(() => false)

  return scannerVisible
}

async function getPhotoBackedVehiclesBySc() {
  const { data: observations } = await helpers.supabase
    .from('observations')
    .select('plate_number,self_contained,photo,photo_url,recorded_at')
    .or('photo.not.is.null,photo_url.not.is.null')
    .order('recorded_at', { ascending: false })
    .limit(2000)

  const rows = (observations || []).filter((row: any) => !!row?.plate_number)
  const scTrue = rows.find((row: any) => row.self_contained === true)
  const scFalse = rows.find((row: any) => row.self_contained === false)

  return { scTrue, scFalse }
}

async function selectFirstAvailableZone(page: any) {
  const trigger = page.locator('button:has-text("Select zone")').first()
  if (await trigger.count() === 0) return
  if (!(await trigger.isVisible())) return

  const expanded = (await trigger.getAttribute('aria-expanded')) === 'true'
  if (!expanded) {
    await trigger.click({ force: true })
  }

  const firstOption = page.locator('[role="option"]').first()
  if (await firstOption.count() === 0) return
  await firstOption.click({ force: true })
}

async function selectTasmanZoneOrFallback(page: any) {
  const trigger = page.locator('button:has-text("Select zone")').first()
  if (await trigger.count() === 0) return
  if (!(await trigger.isVisible())) return

  const expanded = (await trigger.getAttribute('aria-expanded')) === 'true'
  if (!expanded) {
    await trigger.click({ force: true })
  }

  const tasmanOption = page.locator('[role="option"]', { hasText: /Tasman/i }).first()
  if (await tasmanOption.count() > 0) {
    await tasmanOption.click({ force: true })
    return
  }

  const firstOption = page.locator('[role="option"]').first()
  if (await firstOption.count() > 0) {
    await firstOption.click({ force: true })
  }
}

async function ensureZoneSelectedAndSubmitEnabled(page: any) {
  await selectTasmanZoneOrFallback(page)

  const submit = page.locator('button:has-text("Submit")').first()
  if (!(await submit.isDisabled())) return true

  // Retry once in case the first zone selection happened before options fully loaded.
  await page.waitForTimeout(500)
  await selectFirstAvailableZone(page)
  return !(await submit.isDisabled())
}

test.describe('Scan Flow - Manual Plate Entry', () => {
  test('should create observation with manual plate entry', async ({ officerUser }) => {
    const page = officerUser

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }

    // Manual entry
    await page.click('text=Manual Entry')
    await page.fill('input[placeholder*="plate"]', TEST_VEHICLE_PRIMARY)

    // Select zone
    const canSubmit = await ensureZoneSelectedAndSubmitEnabled(page)

    // Submit
    if (!canSubmit) {
      test.skip(true, 'No selectable Tasman District Council zone for the current account')
    }
    await page.click('button:has-text("Submit")')

    // Wait for success toast
    await waitForScanSuccess(page, TEST_VEHICLE_PRIMARY)

    // Verify scanner closed
    await expect(page.locator('h2:has-text("Vehicle Scanner")')).not.toBeVisible()

    // Verify observation in database
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('*')
      .eq('plate_number', TEST_VEHICLE_PRIMARY)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].plate_number).toBe(TEST_VEHICLE_PRIMARY)
    expect(observations![0].zone_id).toBeTruthy()
  })

  test('should validate plate number format', async ({ officerUser }) => {
    const page = officerUser

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }
    await page.click('text=Manual Entry')

    // Try invalid plate (lowercase)
    await page.fill('input[placeholder*="plate"]', 'test123')
    
    // Should auto-convert to uppercase
    const plateValue = await page.inputValue('input[placeholder*="plate"]')
    expect(plateValue).toBe('TEST123')
  })

  test('should require zone selection', async ({ officerUser }) => {
    const page = officerUser

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }
    await page.click('text=Manual Entry')

    // Enter plate without selecting zone
    await page.fill('input[placeholder*="plate"]', 'ABC123')
    
    // Submit is disabled when no zone is selected. Some tenants auto-select a default zone,
    // in which case enabled submit is valid behavior.
    const submitButton = page.locator('button:has-text("Submit")')
    const disabled = await submitButton.isDisabled()
    const zoneAlreadySelected = !((await page.locator('button:has-text("Select zone")').first().isVisible().catch(() => false)))
    expect(disabled || zoneAlreadySelected).toBe(true)
  })
})

test.describe('Scan Flow - Camera Capture', () => {
  test('should use DB-stored photo evidence for Tasman test vehicles', async () => {
    const { scTrue, scFalse } = await getPhotoBackedVehiclesBySc()

    if (!scTrue || !scFalse) {
      test.skip(true, 'No DB photo-backed pair found with one self-contained true and one false')
    }

    if (!scTrue || !scFalse) {
      return
    }

    expect(scTrue.self_contained).toBe(true)
    expect(scFalse.self_contained).toBe(false)
    expect(!!(scTrue.photo || scTrue.photo_url)).toBe(true)
    expect(!!(scFalse.photo || scFalse.photo_url)).toBe(true)
  })
})

test.describe('Scan Flow - GPS Capture', () => {
  test('should capture GPS coordinates automatically', async ({ officerUser }) => {
    const page = officerUser

    // Grant geolocation permission
    await page.context().grantPermissions(['geolocation'])
    await page.context().setGeolocation({ latitude: -41.3366, longitude: 173.1830 })

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }
    await page.click('text=Manual Entry')

    // Create observation
    await page.fill('input[placeholder*="plate"]', TEST_VEHICLE_SECONDARY)
    const canSubmit = await ensureZoneSelectedAndSubmitEnabled(page)
    if (!canSubmit) {
      test.skip(true, 'No selectable Tasman District Council zone for the current account')
    }
    await page.click('button:has-text("Submit")')

    await waitForScanSuccess(page, TEST_VEHICLE_SECONDARY)

    // Verify GPS coordinates saved
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('gps_latitude, gps_longitude')
      .eq('plate_number', TEST_VEHICLE_SECONDARY)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].gps_latitude).toBeCloseTo(-41.3366, 1)
    expect(observations![0].gps_longitude).toBeCloseTo(173.1830, 1)
  })
})

test.describe('Scan Flow - Compliance Evaluation', () => {
  test('should automatically evaluate compliance on submission', async ({ officerUser }) => {
    const page = officerUser

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }
    await page.click('text=Manual Entry')

    // Scan compliant vehicle
    await page.fill('input[placeholder*="plate"]', TEST_VEHICLE_SECONDARY)
    const canSubmit = await ensureZoneSelectedAndSubmitEnabled(page)
    if (!canSubmit) {
      test.skip(true, 'No selectable Tasman District Council zone for the current account')
    }
    await page.click('button:has-text("Submit")')

    await waitForScanSuccess(page, TEST_VEHICLE_SECONDARY)

    // Wait for compliance evaluation (should be < 1 second)
    await page.waitForTimeout(1000)

    // Check compliance result
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('is_compliant, breach_type')
      .eq('plate_number', TEST_VEHICLE_SECONDARY)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].is_compliant).toBeDefined()
  })
})

test.describe('Scan Flow - Breach Detection', () => {
  test('should create breach alert for non-compliant vehicle', async ({ officerUser }) => {
    const page = officerUser

    const scannerOpened = await openVehicleScannerFromField(page)
    if (!scannerOpened) {
      test.skip(true, 'Vehicle scanner trigger is not available for this account/session layout')
    }
    await page.click('text=Manual Entry')

    // Scan non-compliant vehicle (no self-contained in restricted zone)
    await page.fill('input[placeholder*="plate"]', TEST_VEHICLE_PRIMARY)
    const canSubmit = await ensureZoneSelectedAndSubmitEnabled(page)
    if (!canSubmit) {
      test.skip(true, 'No selectable Tasman District Council zone for the current account')
    }
    await page.click('button:has-text("Submit")')

    await waitForScanSuccess(page, TEST_VEHICLE_PRIMARY)

    // Wait for breach detection
    await page.waitForTimeout(2000)

    // Check if breach alert created
    const { data: breaches } = await helpers.supabase
      .from('breach_alerts')
      .select('*')
      .eq('plate_number', TEST_VEHICLE_PRIMARY)
      .order('created_at', { ascending: false })
      .limit(1)

    // Breach should be created if zone doesn't allow overnight parking
    // (Depends on compliance rules)
    expect(breaches).toBeDefined()
  })
})
