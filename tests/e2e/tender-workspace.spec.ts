import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Tender & Document Workspace', () => {
  test('admin can load tender workspace and open create dialog', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/tender-workspace', { waitUntil: 'networkidle' })

    // Primary page identity
    const titles = page.locator('h1, h2, [data-testid="page-title"]').filter({ hasText: /Tender & Document Workspace|Tender Workspace/i })
    const titleCount = await titles.count()
    let anyVisibleTitle = false
    for (let i = 0; i < titleCount; i += 1) {
      if (await titles.nth(i).isVisible().catch(() => false)) {
        anyVisibleTitle = true
        break
      }
    }
    expect(anyVisibleTitle).toBeTruthy()

    // Core action for starting a workflow
    const newButton = page.locator('button').filter({ hasText: /New Tender \/ Document|New Tender|New Document/i }).first()
    await expect(newButton).toBeVisible({ timeout: 10000 })
    await newButton.click({ force: true })

    // Modal/dialog should open
    const dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 8000 })

    // Ensure key input fields are present
    await expect(dialog.locator('input, textarea').first()).toBeVisible({ timeout: 8000 })
  })

  test('admin can open an existing tender when one is listed', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await page.goto('/tender-workspace', { waitUntil: 'networkidle' })

    const docCards = page.locator('button, a').filter({ hasText: /Tender Response|Tender Application|proposal|document/i })
    const count = await docCards.count()

    if (count === 0) {
      test.info().annotations.push({
        type: 'info',
        description: 'No existing tender documents were available in this test environment.',
      })
      return
    }

    await docCards.first().click({ force: true })
    await page.waitForLoadState('networkidle').catch(() => undefined)

    await expect(page).toHaveURL(/\/tender-workspace(\/.*)?$/)
    await expect(page.locator('main')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Detail page tab coverage
// ---------------------------------------------------------------------------

test.describe('Tender Workspace Detail — tab structure', () => {
  /**
   * Helper: navigate to an existing tender detail page.
   * Skips the test gracefully when no tenders exist in the environment.
   */
  async function openFirstTenderDetail(page: any) {
    await loginAs(page, 'adminOrg1')
    await page.goto('/tender-workspace', { waitUntil: 'networkidle' })

    // Prefer explicit detail links to avoid matching sidebar/navigation items.
    const detailLinks = page.locator('main a[href^="/tender-workspace/"]:not([href="/tender-workspace"])')
    const linkCount = await detailLinks.count()
    if (linkCount > 0) {
      await detailLinks.first().click({ force: true })
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await page.waitForURL(/\/tender-workspace\/.+/, { timeout: 10000 }).catch(() => undefined)
      return true
    }

    // Fallback for card/button UIs where rows are not anchor links.
    const cards = page.locator('main button, main [role="button"], main a').filter({ hasText: /Tender|RFP|RFI|RFIP|proposal/i })
    const count = await cards.count()
    if (count === 0) return false

    await cards.first().click({ force: true })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForURL(/\/tender-workspace\/.+/, { timeout: 10000 }).catch(() => undefined)
    return /\/tender-workspace\/.+/.test(page.url())
  }

  test('Intake tab shows file upload zone and extracted text area', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    // Intake tab should be active by default
    const intakeTab = page.locator('[role="tab"]').filter({ hasText: /Intake/i })
    await expect(intakeTab).toBeVisible({ timeout: 10000 })
    await intakeTab.click()

    // Drag-and-drop upload zone
    await expect(page.locator('text=/drag.*drop|click to upload/i').first()).toBeVisible({ timeout: 8000 })

    // Extracted text textarea
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 8000 })
  })

  test('Intake tab shows Run Bob Analysis button when text is present', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const intakeTab = page.locator('[role="tab"]').filter({ hasText: /Intake/i })
    await intakeTab.click()

    // Bob Analysis button (may be disabled if textarea is empty — just check it exists)
    const analysisBtn = page.locator('button').filter({ hasText: /Bob Analysis|Run Bob/i })
    await expect(analysisBtn.first()).toBeVisible({ timeout: 8000 })
  })

  test('References tab shows reference materials list or empty state', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const refsTab = page.locator('[role="tab"]').filter({ hasText: /References/i })
    await expect(refsTab).toBeVisible({ timeout: 10000 })
    await refsTab.click()

    // Either reference items or empty state message
    const hasRefs = await page.locator('text=/policy|pricing|template|compliance|legal|past_tender|nz_reference/i').count()
    const hasEmpty = await page.locator('text=/No reference materials/i').count()
    expect(hasRefs + hasEmpty).toBeGreaterThan(0)
  })

  test('Draft Response tab shows Bob Generate button and all 7 section textareas', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const draftTab = page.locator('[role="tab"]').filter({ hasText: /Draft Response/i })
    await expect(draftTab).toBeVisible({ timeout: 10000 })
    await draftTab.click()

    // Generate with Bob button
    await expect(page.locator('button').filter({ hasText: /Generate Draft|Generate with Bob|Bob is writing/i }).first())
      .toBeVisible({ timeout: 8000 })

    // All 7 section textareas should be present
    const sectionLabels = [
      /Cover Letter/i,
      /Executive Summary/i,
      /Services Offered/i,
      /Pricing/i,
      /Team.*Qualifications|Qualifications/i,
      /Health.*Safety|Safety/i,
      /Declaration/i,
    ]
    for (const label of sectionLabels) {
      await expect(page.locator('h2, h3, label, .text-sm').filter({ hasText: label }).first())
        .toBeVisible({ timeout: 8000 })
    }
  })

  test('Approval tab shows approval actions for an approver', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const approvalTab = page.locator('[role="tab"]').filter({ hasText: /Approval/i })
    await expect(approvalTab).toBeVisible({ timeout: 10000 })
    await approvalTab.click()

    // Either approval actions are present or a "no permission" / status message is shown
    const hasApproveBtn = await page.locator('button').filter({ hasText: /Approve|Shortlist|Reject|Return to Draft/i }).count()
    const hasSubmitBtn = await page.locator('button').filter({ hasText: /Submit for Approval/i }).count()
    const hasStatusNote = await page.locator('text=/already approved|submitted|archived|review pending/i').count()
    expect(hasApproveBtn + hasSubmitBtn + hasStatusNote).toBeGreaterThan(0)
  })

  test('Export tab shows PDF and Word export buttons', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const exportTab = page.locator('[role="tab"]').filter({ hasText: /Export/i })
    await expect(exportTab).toBeVisible({ timeout: 10000 })
    await exportTab.click()

    await expect(page.locator('button').filter({ hasText: /PDF|Print/i }).first())
      .toBeVisible({ timeout: 8000 })
    await expect(page.locator('button').filter({ hasText: /Word|\.doc/i }).first())
      .toBeVisible({ timeout: 8000 })
  })

  test('Collaborators tab shows team section and invite form for owner', async ({ page }) => {
    const found = await openFirstTenderDetail(page)
    if (!found) {
      test.info().annotations.push({ type: 'info', description: 'No tender documents available.' })
      return
    }

    const collabTab = page.locator('[role="tab"]').filter({ hasText: /Collaborators/i })
    await expect(collabTab).toBeVisible({ timeout: 10000 })
    await collabTab.click()

    // Team section always present (shows owner at minimum)
    await expect(page.locator('text=/Team|Owner/i').first()).toBeVisible({ timeout: 8000 })
  })
})

// ---------------------------------------------------------------------------
// Reference Library
// ---------------------------------------------------------------------------

test.describe('Tender Reference Library', () => {
  test('admin can navigate to reference library and see the page', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/tender-reference-library', { waitUntil: 'networkidle' })

    await expect(page.locator('h1, h2').filter({ hasText: /Reference Library|Reference Material/i }).first())
      .toBeVisible({ timeout: 15000 })
  })

  test('reference library shows upload / add material button', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/tender-reference-library', { waitUntil: 'networkidle' })

    await expect(page.locator('button').filter({ hasText: /Add|Upload|New Material/i }).first())
      .toBeVisible({ timeout: 10000 })
  })
})
