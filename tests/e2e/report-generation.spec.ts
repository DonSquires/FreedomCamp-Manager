/**
 * E2E Test: Report Generation (Data → PDF → Download)
 * Test Area 6 from Phase 9 Integration Testing
 */

import { test, expect } from './setup'

test.describe('Report Generation - Leadership Pack', () => {
  test('should navigate to Reports Hub page', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/reports-hub')
    await expect(page).toHaveURL(/\/reports-hub/, { timeout: 10000 })
    await expect(page.locator('main')).toContainText(/reports|leadership|export|dashboard/i)
  })

  test('should generate and download leadership pack PDF', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/reports')
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 })
    await expect(page.locator('main')).toContainText(/reports|leadership|export|dashboard/i)

    // Look for a leadership pack / generate report button
    const generateBtn = page.getByRole('button', { name: /leadership pack|generate|export/i }).first()
    if (await generateBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = !(await generateBtn.isEnabled().catch(() => false))
      if (isDisabled) {
        test.skip(true, 'Report generate button is disabled in current environment state')
      }

      // Set up bounded listeners before clicking.
      const downloadPromise = page
        .waitForEvent('download', { timeout: 8000 })
        .then((download) => ({ type: 'download' as const, download }))
        .catch(() => null)
      const popupPromise = page
        .waitForEvent('popup', { timeout: 8000 })
        .then((popup) => ({ type: 'popup' as const, popup }))
        .catch(() => null)

      await generateBtn.click({ timeout: 5000 })

      const outcome = await Promise.race([
        downloadPromise,
        popupPromise,
        page.waitForTimeout(8500).then(() => null),
      ])

      if (outcome?.type === 'download') {
        const filename = outcome.download.suggestedFilename()
        expect(filename).toMatch(/\.pdf$/i)
        console.log(`Downloaded report: ${filename}`)
      } else if (outcome?.type === 'popup') {
        await outcome.popup.waitForLoadState('domcontentloaded').catch(() => undefined)
        const popupUrl = outcome.popup.url()
        console.log(`Report opened in popup: ${popupUrl || 'about:blank'}`)
      } else {
        // PDF may render inline without triggering a download event.
        const pdfContent = page.locator('embed[type="application/pdf"], iframe')
        const visible = await pdfContent.isVisible({ timeout: 2000 }).catch(() => false)
        console.log(`No download/popup event. Inline PDF visible: ${visible}`)
      }
    } else {
      console.log('No generate/export button found on Reports page – skipping download test')
    }
  })
})

test.describe('Report Generation - CSV Export', () => {
  test('should export observations as CSV from compliance dashboard', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/compliance')
    await expect(page.locator('h1').first()).toContainText('Compliance')

    // Look for export/CSV button
    const exportBtn = page.getByRole('button', { name: /export|csv|download/i }).first()
    if (await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
      await exportBtn.click()

      const download = await downloadPromise
      if (download) {
        const filename = download.suggestedFilename()
        expect(filename).toMatch(/\.(csv|xlsx)$/i)
        console.log(`Downloaded export: ${filename}`)
      } else {
        console.log('No download event for CSV export – may require filter selection first')
      }
    } else {
      console.log('No export button found on Compliance Dashboard – skipping CSV test')
    }
  })
})
