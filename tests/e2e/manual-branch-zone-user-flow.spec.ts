import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

const ENABLE_MANUAL_SEED = process.env.PLAYWRIGHT_ENABLE_MANUAL_SEED === '1'
const TARGET_BRANCH = process.env.PLAYWRIGHT_MANUAL_BRANCH || 'Ashburton - First Security'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function pickOrganizationOption(page: Page, preferredName: string): Promise<void> {
  const exact = page.getByRole('option', { name: new RegExp(`^\\s*${escapeRegex(preferredName)}\\s*$`, 'i') }).first()
  if (await exact.isVisible({ timeout: 1200 }).catch(() => false)) {
    await exact.click({ force: true })
    return
  }

  const partials = [
    /ashburton/i,
    /first security/i,
    /security/i,
  ]

  for (const matcher of partials) {
    const candidate = page.getByRole('option', { name: matcher }).first()
    if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
      await candidate.click({ force: true })
      return
    }
  }

  const firstAssignable = page
    .getByRole('option')
    .filter({ hasNotText: /^no organisation$|^no organization$/i })
    .first()
  if (await firstAssignable.isVisible({ timeout: 1200 }).catch(() => false)) {
    await firstAssignable.click({ force: true })
    return
  }

  throw new Error('No assignable organisation option is available for this account')
}

async function loginForManualSeed(page: Page): Promise<void> {
  const email =
    process.env.PLAYWRIGHT_MASTER_EMAIL ||
    process.env.E2E_MASTER_EMAIL ||
    process.env.PLAYWRIGHT_TEST_EMAIL ||
    ''
  const password =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!email || !password) {
    await loginAs(page, 'master')
  } else {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox', { name: /email/i }).first().fill(email)
    await page.getByRole('textbox', { name: /password/i }).first().fill(password)
    await page.getByRole('button', { name: /^sign in$/i }).first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  }

  const workspaceHeading = page.getByText(/choose a workspace to continue your shift/i).first()
  if (await workspaceHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    const adminPortalCard = page.getByTestId('portal-card-admin').first()
    const adminPortalFallback = page.getByRole('button', { name: /open admin portal|admin portal/i }).first()

    if (await adminPortalCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await adminPortalCard.click({ force: true })
    } else {
      await expect(adminPortalFallback).toBeVisible({ timeout: 5000 })
      await adminPortalFallback.click({ force: true })
    }
    await expect(workspaceHeading).toBeHidden({ timeout: 20000 }).catch(() => undefined)
  }

  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function gotoZones(page: Page): Promise<void> {
  await page.goto('/zones', { waitUntil: 'domcontentloaded' })
  const inZones = await page
    .waitForURL(/\/zones(?:\?|$|#)/, { timeout: 10000 })
    .then(() => true)
    .catch(() => false)

  if (!inZones) {
    const zonesLink = page.getByRole('button', { name: /^zones$/i }).first()
    if (await zonesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zonesLink.click({ force: true })
    }
    await expect(page).toHaveURL(/\/zones(?:\?|$|#)/, { timeout: 20000 })
  }
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function gotoZonesFromOrganizations(page: Page, branchName: string): Promise<void> {
  await page.goto('/organizations', { waitUntil: 'domcontentloaded' })

  const orgSearch = page.locator('input[placeholder*="Search organizations" i], input[placeholder*="Search organisations" i]').first()
  if (await orgSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
    await orgSearch.fill(branchName)
  }

  const orgCard = page
    .locator('[data-testid^="organization-card-"]')
    .filter({ hasText: new RegExp(escapeRegex(branchName), 'i') })
    .first()

  await expect(orgCard).toBeVisible({ timeout: 15000 })

  const setZoneButton = orgCard.getByRole('button', { name: /set zone|zones/i }).first()
  await expect(setZoneButton).toBeVisible({ timeout: 10000 })
  await setZoneButton.click({ force: true })

  await expect(page).toHaveURL(/\/zones(?:\?|$|#)/, { timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function setOrganizationScope(page: Page, branchName: string): Promise<void> {
  const orgFilter = page
    .locator('button[role="combobox"]')
    .filter({ hasText: /all organisations|all organizations|first security|security guard/i })
    .first()

  if (!(await orgFilter.isVisible({ timeout: 3000 }).catch(() => false))) return

  await orgFilter.click()
  await pickOrganizationOption(page, branchName)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function drawPolygonGeofence(page: Page): Promise<void> {
  const boundaryButton = page.getByRole('button', { name: /draw boundary on map|edit boundary map/i }).first()
  await expect(boundaryButton).toBeVisible({ timeout: 10000 })
  await boundaryButton.click()

  await expect(page.getByText(/geofence editor/i).first()).toBeVisible({ timeout: 15000 })
  const polygonModeButton = page.getByRole('button', { name: /polygon\s+custom shape|polygon/i }).first()
  await expect(polygonModeButton).toBeVisible({ timeout: 10000 })
  await polygonModeButton.click()

  await expect(page.getByRole('heading', { name: /polygon configuration/i }).first()).toBeVisible({ timeout: 10000 })

  const addPointButton = page.getByRole('button', { name: /add point from center/i }).first()
  await expect(addPointButton).toBeVisible({ timeout: 10000 })
  await addPointButton.click()
  await addPointButton.click()
  await addPointButton.click()

  const latInputs = page.locator('input[placeholder="Latitude"]')
  const lngInputs = page.locator('input[placeholder="Longitude"]')
  await expect(latInputs.nth(2)).toBeVisible({ timeout: 10000 })
  await expect(lngInputs.nth(2)).toBeVisible({ timeout: 10000 })

  await latInputs.nth(0).fill('-43.903200')
  await lngInputs.nth(0).fill('171.748900')
  await latInputs.nth(1).fill('-43.902700')
  await lngInputs.nth(1).fill('171.744500')
  await latInputs.nth(2).fill('-43.898900')
  await lngInputs.nth(2).fill('171.746800')

  await expect(page.getByText(/vertices:\s*3/i).first()).toBeVisible({ timeout: 10000 })

  let geofenceSaved = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const saveGeofence = page.getByRole('button', { name: /save geofence/i }).first()
    if (!(await saveGeofence.isVisible({ timeout: 1500 }).catch(() => false))) {
      continue
    }

    await expect(saveGeofence).toBeEnabled({ timeout: 10000 })
    await saveGeofence.click({ force: true })

    geofenceSaved = await page
      .getByText(/geofence editor/i)
      .first()
      .waitFor({ state: 'hidden', timeout: 7000 })
      .then(() => true)
      .catch(() => false)

    if (geofenceSaved) break
  }

  if (!geofenceSaved) {
    await expect(page.getByText(/geofence editor/i).first()).toBeHidden({ timeout: 20000 })
  }
}

async function createBranchJurisdictionZone(page: Page, branchName: string): Promise<string> {
  const zoneName = `${branchName} Jurisdiction Manual ${Date.now()}`

  const openCreateDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const addZoneButton = page.getByRole('button', { name: /add zone|create zone|new zone/i }).first()
      if (await addZoneButton.isVisible({ timeout: 4000 }).catch(() => false)) {
        await addZoneButton.click({ force: true })
        return
      }

      await gotoZones(page)
      await setOrganizationScope(page, branchName)
      await page.waitForLoadState('networkidle').catch(() => undefined)
    }

    throw new Error('Add Zone button was not visible after retries')
  }

  await openCreateDialog()
  let dialog = page.getByRole('dialog').filter({ hasText: /add zone|create a new enforcement or jurisdiction zone/i }).first()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#createName').fill(zoneName)
  await dialog.locator('#createDescription').fill(`Manual single-branch polygon zone for ${branchName}.`)

  const createOrg = dialog.locator('#createOrganization')
  if (await createOrg.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createOrg.click()
    await pickOrganizationOption(page, branchName)
  }

  await dialog.locator('#createZoneType').click()
  await page.getByRole('option', { name: /general \(jurisdiction area\)/i }).first().click({ force: true })

  await drawPolygonGeofence(page)

  if (!(await dialog.isVisible({ timeout: 1500 }).catch(() => false))) {
    await openCreateDialog()
    dialog = page.getByRole('dialog').filter({ hasText: /add zone|create a new enforcement or jurisdiction zone/i }).first()
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const existingName = (await dialog.locator('#createName').inputValue().catch(() => '')).trim()
    if (!existingName) {
      await dialog.locator('#createName').fill(zoneName)
    }

    const existingDescription = (await dialog.locator('#createDescription').inputValue().catch(() => '')).trim()
    if (!existingDescription) {
      await dialog.locator('#createDescription').fill(`Manual single-branch polygon zone for ${branchName}.`)
    }
  }

  const creatingState = dialog.getByRole('button', { name: /creating\.\.\./i }).first()
  if (!(await creatingState.isVisible({ timeout: 1200 }).catch(() => false))) {
    const createZoneButton = dialog.getByRole('button', { name: /create zone/i }).first()
    if (await createZoneButton.isVisible({ timeout: 6000 }).catch(() => false)) {
      await createZoneButton.click()
    } else if (!(await creatingState.isVisible({ timeout: 1200 }).catch(() => false))) {
      throw new Error('Create Zone action unavailable after geofence save')
    }
  }

  const createCompleted = await dialog
    .waitFor({ state: 'hidden', timeout: 90000 })
    .then(() => true)
    .catch(() => false)

  if (!createCompleted) {
    const stillCreating = await creatingState.isVisible({ timeout: 1000 }).catch(() => false)
    if (stillCreating) {
      throw new Error('Zone creation remained in progress and did not complete within timeout')
    }

    const visibleError = await page
      .locator('[role="alert"], [data-sonner-toast]')
      .filter({ hasText: /failed|error|unable|invalid|required/i })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)

    if (visibleError) {
      throw new Error('Zone creation failed with a visible UI validation or error message')
    }
  }

  await gotoZones(page)
  await setOrganizationScope(page, branchName)

  const fillZoneSearch = async () => {
    const search = page.locator('input[placeholder*="Search zones by name" i]').first()
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill(zoneName)
    }
  }

  await fillZoneSearch()

  const loadingIndicator = page.getByText(/loading zones/i).first()
  if (await loadingIndicator.isVisible({ timeout: 1500 }).catch(() => false)) {
    const loaded = await loadingIndicator
      .waitFor({ state: 'hidden', timeout: 15000 })
      .then(() => true)
      .catch(() => false)

    if (!loaded) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await gotoZones(page)
      await setOrganizationScope(page, branchName)
      await fillZoneSearch()
      await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined)
    }
  }

  await expect(page.getByText(new RegExp(escapeRegex(zoneName), 'i')).first()).toBeVisible({ timeout: 20000 })
  return zoneName
}

async function createBranchAssignedUser(page: Page, branchName: string): Promise<string> {
  const email = `manual.branch.user.${Date.now()}@example.com`

  await page.goto('/users', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: /^create user$/i }).first()).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /^create user$/i }).first().click()

  const dialog = page.getByRole('dialog').filter({ hasText: /create new user/i }).first()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#email').fill(email)
  await dialog.locator('#firstName').fill('Manual')
  await dialog.locator('#lastName').fill('BranchUser')

  const roleTrigger = dialog.getByRole('combobox').first()
  await roleTrigger.click()
  await page.getByRole('option', { name: /^officer$/i }).first().click()

  await dialog.locator('#createPassword').fill('Test123!')
  await dialog.locator('#createConfirmPassword').fill('Test123!')

  await dialog.getByRole('tab', { name: /access/i }).click()
  const orgTrigger = dialog.locator('#createOrg')
  await expect(orgTrigger).toBeVisible({ timeout: 10000 })
  await orgTrigger.click()
  await pickOrganizationOption(page, branchName)

  const createReq = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/functions/v1/manage-user'),
    { timeout: 90000 },
  ).catch(() => null)

  await dialog.getByRole('button', { name: /^create user$/i }).first().click()
  const createRes = await createReq

  if (createRes) {
    const status = createRes.status()
    const body = await createRes.text().catch(() => '')
    if (!(status >= 200 && status < 300) && !/already exists/i.test(body)) {
      throw new Error(`User create failed (${status}): ${body.slice(0, 240)}`)
    }
  }

  await expect(dialog).toBeHidden({ timeout: 90000 }).catch(() => undefined)
  await expect(page.getByText(new RegExp(escapeRegex(email), 'i')).first()).toBeVisible({ timeout: 30000 })
  return email
}

test.describe('Manual UI one-branch zone + user flow', () => {
  test.skip(!ENABLE_MANUAL_SEED, 'Manual data seeding is disabled by default. Set PLAYWRIGHT_ENABLE_MANUAL_SEED=1 to run.')

  test('create one jurisdiction polygon and one branch-assigned user', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000)

    console.log('[manual-branch-flow] step=login:start')
    await loginForManualSeed(page)
    console.log('[manual-branch-flow] step=login:done')

    console.log('[manual-branch-flow] step=zones-from-organizations:start')
    await gotoZonesFromOrganizations(page, TARGET_BRANCH)
    console.log('[manual-branch-flow] step=zones-from-organizations:done')

    console.log('[manual-branch-flow] step=set-org-scope:start')
    await setOrganizationScope(page, TARGET_BRANCH)
    console.log('[manual-branch-flow] step=set-org-scope:done')

    console.log('[manual-branch-flow] step=create-zone:start')
    const zoneName = await createBranchJurisdictionZone(page, TARGET_BRANCH)
    console.log('[manual-branch-flow] step=create-zone:done')

    console.log('[manual-branch-flow] step=create-user:start')
    const userEmail = await createBranchAssignedUser(page, TARGET_BRANCH)
    console.log('[manual-branch-flow] step=create-user:done')

    console.log(`[manual-branch-flow] branch=${TARGET_BRANCH}`)
    console.log(`[manual-branch-flow] zone=${zoneName}`)
    console.log(`[manual-branch-flow] user=${userEmail}`)
  })
})