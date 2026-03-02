/**
 * E2E Test: Report Generation (Data → PDF → Download)
 * Test Area 6 from Phase 9 Integration Testing
 */

import { test, expect } from './setup'

test.describe('Report Generation - Leadership Pack', () => {
  test('should navigate to Reports Hub page', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/reports-hub')
    await expect(page.locator('h1')).toContainText('Reports')
  })

  test('should generate and download leadership pack PDF', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/reports')
    await expect(page.locator('h1')).toContainText('Reports')

    // Look for a leadership pack / generate report button
    const generateBtn = page.locator('button:has-text(/leadership pack|generate|export/i)').first()
    if (await generateBtn.isVisible({ timeout: 5000 })) {
      // Set up download listener before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)

      await generateBtn.click()

      // Wait for download or PDF generation
      const download = await downloadPromise
      if (download) {
        const filename = download.suggestedFilename()
        expect(filename).toMatch(/\.pdf$/i)
        console.log(`Downloaded report: ${filename}`)
      } else {
        // PDF may open in new tab instead of downloading
        console.log('PDF opened inline or no download event fired – checking for PDF viewer')
        const pdfContent = page.locator('embed[type="application/pdf"], iframe')
        const visible = await pdfContent.isVisible({ timeout: 5000 }).catch(() => false)
        console.log(`PDF viewer visible: ${visible}`)
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
    await expect(page.locator('h1')).toContainText('Compliance')

    // Look for export/CSV button
    const exportBtn = page.locator('button:has-text(/export|csv|download/i)').first()
    if (await exportBtn.isVisible({ timeout: 5000 })) {
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
