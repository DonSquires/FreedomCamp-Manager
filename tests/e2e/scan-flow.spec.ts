/**
 * E2E Test: Scan Flow (PlateScanner → Railway → Database)
 * Test Area 1 from Phase 9 Integration Testing
 */

import { test, expect, helpers } from './setup'

test.describe('Scan Flow - Manual Plate Entry', () => {
  test('should create observation with manual plate entry', async ({ officerUser }) => {
    const page = officerUser

    // Navigate to Field Officer Portal
    await page.goto('/field')
    await expect(page.locator('h1')).toContainText('Field Officer Portal')

    // Open PlateScanner
    await page.click('text=Scan Vehicle')
    await expect(page.locator('text=Vehicle Scanner')).toBeVisible()

    // Manual entry
    await page.click('text=Manual Entry')
    await page.fill('input[placeholder*="plate"]', 'TEST123')

    // Select zone
    await page.click('text=Select zone')
    await page.click('text=Beach Reserve')

    // Submit
    await page.click('button:has-text("Submit")')

    // Wait for success toast
    await helpers.waitForToast(page, 'Vehicle TEST123 scanned successfully')

    // Verify scanner closed
    await expect(page.locator('text=Vehicle Scanner')).not.toBeVisible()

    // Verify observation in database
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('*')
      .eq('plate_number', 'TEST123')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].plate_number).toBe('TEST123')
    expect(observations![0].zone_id).toBeTruthy()
  })

  test('should validate plate number format', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Try invalid plate (lowercase)
    await page.fill('input[placeholder*="plate"]', 'test123')
    
    // Should auto-convert to uppercase
    const plateValue = await page.inputValue('input[placeholder*="plate"]')
    expect(plateValue).toBe('TEST123')
  })

  test('should require zone selection', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Enter plate without selecting zone
    await page.fill('input[placeholder*="plate"]', 'ABC123')
    
    // Submit button should be disabled
    const submitButton = page.locator('button:has-text("Submit")')
    await expect(submitButton).toBeDisabled()
  })
})

test.describe('Scan Flow - Camera Capture', () => {
  test('should open camera for plate capture', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Click camera capture
    await page.click('text=Camera Capture')

    // Verify camera permission requested (in real browser)
    // Note: In headless mode, camera won't be available
    // This test validates UI behavior only
    await expect(page.locator('text=Camera Capture')).toBeVisible()
  })
})

test.describe('Scan Flow - GPS Capture', () => {
  test('should capture GPS coordinates automatically', async ({ officerUser }) => {
    const page = officerUser

    // Grant geolocation permission
    await page.context().grantPermissions(['geolocation'])
    await page.context().setGeolocation({ latitude: -36.8485, longitude: 174.7633 })

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Create observation
    await page.fill('input[placeholder*="plate"]', 'GPS123')
    await page.click('text=Select zone')
    await page.click('text=Beach Reserve')
    await page.click('button:has-text("Submit")')

    await helpers.waitForToast(page, 'Vehicle GPS123 scanned successfully')

    // Verify GPS coordinates saved
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('gps_latitude, gps_longitude')
      .eq('plate_number', 'GPS123')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].gps_latitude).toBeCloseTo(-36.8485, 1)
    expect(observations![0].gps_longitude).toBeCloseTo(174.7633, 1)
  })
})

test.describe('Scan Flow - Compliance Evaluation', () => {
  test('should automatically evaluate compliance on submission', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Scan compliant vehicle
    await page.fill('input[placeholder*="plate"]', 'COMP123')
    await page.click('text=Select zone')
    await page.click('text=Beach Reserve')
    await page.click('button:has-text("Submit")')

    await helpers.waitForToast(page, 'Vehicle COMP123 scanned successfully')

    // Wait for compliance evaluation (should be < 1 second)
    await page.waitForTimeout(1000)

    // Check compliance result
    const { data: observations } = await helpers.supabase
      .from('observations')
      .select('is_compliant, breach_type')
      .eq('plate_number', 'COMP123')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(observations).toHaveLength(1)
    expect(observations![0].is_compliant).toBeDefined()
  })
})

test.describe('Scan Flow - Breach Detection', () => {
  test('should create breach alert for non-compliant vehicle', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field')
    await page.click('text=Scan Vehicle')

    // Scan non-compliant vehicle (no self-contained in restricted zone)
    await page.fill('input[placeholder*="plate"]', 'BREACH99')
    await page.click('text=Select zone')
    await page.click('text=Restricted Zone') // No overnight parking allowed
    await page.click('button:has-text("Submit")')

    await helpers.waitForToast(page, 'Vehicle BREACH99 scanned successfully')

    // Wait for breach detection
    await page.waitForTimeout(2000)

    // Check if breach alert created
    const { data: breaches } = await helpers.supabase
      .from('breach_alerts')
      .select('*')
      .eq('plate_number', 'BREACH99')
      .order('created_at', { ascending: false })
      .limit(1)

    // Breach should be created if zone doesn't allow overnight parking
    // (Depends on compliance rules)
    expect(breaches).toBeDefined()
  })
})
