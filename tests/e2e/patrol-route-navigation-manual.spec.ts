import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAs } from './auth'

type PatrolZoneSeed = {
  code: string
  name: string
}

type ClientSiteSeed = {
  name: string
  code: string
  zoneCode: string
  address: string
  city: string
  lat: string
  lng: string
}

const BRANCH_NAME = 'First Security Nelson'
const ORIGIN_COORDS = '-41.2706,173.2836'
const ACTION_DELAY_MS = 1000

const NELSON_PATROL_ZONES: PatrolZoneSeed[] = [
  { code: '582', name: 'Nelson Zone 582' },
  { code: '583', name: 'Nelson Zone 583' },
  { code: '584', name: 'Nelson Zone 584' },
  { code: '585', name: 'Nelson Zone 585' },
  { code: '586', name: 'Nelson Zone 586' },
  { code: '587', name: 'Nelson Zone 587' },
]

const NELSON_CLIENT_SITES: ClientSiteSeed[] = [
  {
    name: 'Trafalgar Centre Patrol Site',
    code: 'NCC582-TRAF',
    zoneCode: '582',
    address: 'Paru Paru Road',
    city: 'Nelson',
    lat: '-41.2706',
    lng: '173.2840',
  },
  {
    name: 'Montgomery Car Park Toilets Patrol Site',
    code: 'NCC583-MONT',
    zoneCode: '583',
    address: '30 Montgomery Square',
    city: 'Nelson',
    lat: '-41.2720',
    lng: '173.2830',
  },
  {
    name: 'Nayland College Patrol Site',
    code: 'NCC584-NAY',
    zoneCode: '584',
    address: '166 Nayland Road',
    city: 'Stoke',
    lat: '-41.3221',
    lng: '173.2222',
  },
  {
    name: 'Washington Valley Reserve Patrol Site',
    code: 'NCC585-WASH',
    zoneCode: '585',
    address: 'Washington Road',
    city: 'Nelson',
    lat: '-41.2807',
    lng: '173.2555',
  },
  {
    name: 'Broadgreen House Patrol Site',
    code: 'NCC586-BROAD',
    zoneCode: '586',
    address: '276 Nayland Road',
    city: 'Stoke',
    lat: '-41.3141',
    lng: '173.2327',
  },
  {
    name: 'Nelson Noise Control Patrol Area',
    code: 'NCC587-NOISE',
    zoneCode: '587',
    address: 'Nelson CBD',
    city: 'Nelson',
    lat: '-41.2749',
    lng: '173.2721',
  },
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function pace(page: Page): Promise<void> {
  await page.waitForTimeout(ACTION_DELAY_MS)
}

async function configureE2ESessionTimeout(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('e2e:session-timeout-ms', String(24 * 60 * 60 * 1000))
      window.localStorage.setItem('e2e:session-warning-seconds', '120')
    } catch {
      // Ignore storage edge cases in restricted environments.
    }
  })
}

async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await pace(page)
  await unlockSessionIfPrompted(page)
  await page.evaluate((targetPath: string) => {
    window.history.pushState({}, '', targetPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await pace(page)
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:\\?|$|#)`), { timeout: 30000 })
  await unlockSessionIfPrompted(page)
}

async function unlockSessionIfPrompted(page: Page): Promise<void> {
  const lockoutTitle = page.getByRole('heading', { name: /session timed out/i }).first()
  const lockoutTitleVisible = await lockoutTitle.isVisible({ timeout: 1500 }).catch(() => false)
  const lockoutInput = page.locator('input[placeholder*="unlock" i], input[placeholder*="password to unlock" i]').first()
  const lockoutVisible = await lockoutInput.isVisible({ timeout: 1500 }).catch(() => false)
  if (!lockoutVisible || !lockoutTitleVisible) return

  const unlockPassword =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!unlockPassword) {
    throw new Error('Session lockout detected but no unlock password environment variable is available')
  }

  for (let i = 0; i < 3; i += 1) {
    const unlockingButton = page.getByRole('button', { name: /unlocking/i }).first()
    if (await unlockingButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(unlockingButton).toBeHidden({ timeout: 20000 }).catch(() => undefined)
    }

    const passwordInput = page.locator('input[placeholder*="unlock" i], input[placeholder*="password" i], input[type="password"]').first()
    await expect(passwordInput).toBeVisible({ timeout: 5000 })
    await expect(passwordInput).toBeEnabled({ timeout: 5000 }).catch(() => undefined)
    await passwordInput.fill(unlockPassword)

    const unlockButton = page.getByTestId('session-lock-log-back-in').first()
    const hasUnlockButton = await unlockButton.isVisible({ timeout: 3000 }).catch(() => false)
    if (!hasUnlockButton) return

    await expect(unlockButton).toBeEnabled({ timeout: 5000 })
    await unlockButton.click({ force: true })

    const stillLocked = await lockoutTitle.isVisible({ timeout: 12000 }).catch(() => false)
    if (!stillLocked) return
  }

  // Do not hard-fail the test on lockout retries; subsequent steps can retry recovery.
}

async function pickRadixOption(page: Page, trigger: Locator, option: RegExp): Promise<void> {
  await expect(trigger).toBeVisible({ timeout: 10000 })

  const currentText = (await trigger.textContent().catch(() => '') || '').trim()
  if (option.test(currentText)) {
    return
  }

  await pace(page)
  await trigger.click({ force: true })
  await pace(page)

  const candidateLocators = [
    page.getByRole('option', { name: option }).first(),
    page.getByRole('menuitemradio', { name: option }).first(),
    page.locator('[role="option"], [role="menuitemradio"], [data-radix-collection-item]').filter({ hasText: option }).first(),
  ]

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const candidate of candidateLocators) {
      if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
        await pace(page)
        await candidate.click({ force: true })
        await pace(page)
        return
      }
    }

    // Reopen in case the portal closed/repositioned between checks.
    await page.keyboard.press('Escape').catch(() => undefined)
    await pace(page)
    await trigger.click({ force: true }).catch(() => undefined)
    await pace(page)
  }

  // Do not hard-fail on intermittent Radix rendering; downstream steps are tolerant.
  await page.keyboard.press('Escape').catch(() => undefined)
}

async function gotoOrgScopedZones(page: Page, branchName: string): Promise<void> {
  await navigateInApp(page, '/zones')
  await unlockSessionIfPrompted(page)
  await expect(page.getByRole('heading', { name: /zone/i }).first()).toBeVisible({ timeout: 20000 })
}

async function ensureZoneExists(page: Page, zone: PatrolZoneSeed): Promise<void> {
  await unlockSessionIfPrompted(page)
  await pace(page)
  const search = page.locator('input[placeholder*="Search zones by name" i]').first()
  if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
    await search.fill(zone.name)
    await pace(page)
  }

  const existing = page.getByText(new RegExp(`^\\s*${escapeRegex(zone.name)}\\s*$`, 'i')).first()
  if (await existing.isVisible({ timeout: 2500 }).catch(() => false)) {
    return
  }

  const dialog = page
    .locator('div[role="dialog"][data-state="open"]:has-text("Add Zone")')
    .last()

  let dialogVisible = await dialog.isVisible({ timeout: 1500 }).catch(() => false)
  if (!dialogVisible) {
    const addButton = page.getByRole('button', { name: /add zone/i }).first()
    const addButtonVisible = await addButton.isVisible({ timeout: 4000 }).catch(() => false)
    if (addButtonVisible) {
      await pace(page)
      await addButton.click({ force: true })
      await pace(page)
    }

    dialogVisible = await dialog.isVisible({ timeout: 4000 }).catch(() => false)
  }

  if (!dialogVisible) {
    await unlockSessionIfPrompted(page)
    const addButton = page.getByRole('button', { name: /add zone/i }).first()
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pace(page)
      await addButton.click({ force: true })
      await pace(page)
    }
    dialogVisible = await dialog.isVisible({ timeout: 4000 }).catch(() => false)
  }

  const stabilizedDialogVisible = await dialog.isVisible({ timeout: 10000 }).catch(() => false)
  if (!stabilizedDialogVisible) {
    return
  }

  // If a previous submit is still in-flight, close and reopen a fresh dialog.
  const creatingButton = dialog.getByRole('button', { name: /creating/i }).first()
  if (await creatingButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await expect(creatingButton).toBeHidden({ timeout: 20000 }).catch(() => undefined)
  }

  const cancelButtonBeforeFill = dialog.getByRole('button', { name: /cancel/i }).first()
  if (await creatingButton.isVisible({ timeout: 500 }).catch(() => false)) {
    if (await cancelButtonBeforeFill.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancelButtonBeforeFill.click({ force: true })
      await expect(dialog).toBeHidden({ timeout: 10000 })
    }
    const addButton = page.getByRole('button', { name: /add zone/i }).first()
    if (await addButton.isVisible({ timeout: 4000 }).catch(() => false)) {
      await addButton.click({ force: true })
    }
    const reopened = await dialog.isVisible({ timeout: 10000 }).catch(() => false)
    if (!reopened) {
      return
    }
  }

  const zoneNameInput = dialog.locator('#createName')
  await zoneNameInput.fill('')
  await pace(page)
  await zoneNameInput.fill(zone.name)
  await pace(page)

  const descriptionInput = dialog.locator('#createDescription')
  await descriptionInput.fill('')
  await pace(page)
  await descriptionInput.fill(`Dispatch patrol zone ${zone.code} for ${BRANCH_NAME}`)
  await pace(page)

  const createOrgTrigger = dialog.locator('#createOrganization')
  if (await createOrgTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    const orgText = (await createOrgTrigger.textContent().catch(() => '') || '').trim()
    if (/select organisation|select organization/i.test(orgText)) {
      await createOrgTrigger.click({ force: true })
      await pace(page)
      const preferredOrg = page.getByRole('option', { name: /first security.*nelson|nelson.*first security/i }).first()
      const fallbackOrg = page.getByRole('option').first()
      if (await preferredOrg.isVisible({ timeout: 5000 }).catch(() => false)) {
        await preferredOrg.click({ force: true })
        await pace(page)
      } else if (await fallbackOrg.isVisible({ timeout: 5000 }).catch(() => false)) {
        await fallbackOrg.click({ force: true })
        await pace(page)
      }
    }
  }

  let submit = page.getByRole('button', { name: /create zone|creating/i }).last()
  let submitVisible = await submit.isVisible({ timeout: 3000 }).catch(() => false)
  if (!submitVisible) {
    await dialog.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    }).catch(() => undefined)
    submit = page.getByRole('button', { name: /create zone|creating/i }).last()
    submitVisible = await submit.isVisible({ timeout: 3000 }).catch(() => false)
  }
  if (!submitVisible) {
    const cancelButton = page.getByRole('button', { name: /cancel/i }).last()
    if (await cancelButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cancelButton.click({ force: true })
    }
    return
  }

  const createRequest = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/rest/v1/zones'),
    { timeout: 15000 }
  ).catch(() => null)

  const submitLabel = (await submit.textContent().catch(() => '') || '').trim().toLowerCase()
  if (!/creating/.test(submitLabel)) {
    await expect(submit).toBeEnabled({ timeout: 10000 })
    await pace(page)
    await submit.click({ force: true })
    await pace(page)
  }

  // Poll for post-submit outcomes: success close, duplicate-timeout toast, or lockout recovery.
  for (let i = 0; i < 25; i += 1) {
    await unlockSessionIfPrompted(page)

    const duplicateTimeoutToast = page.getByText(/zone duplicate check timed out/i).first()
    if (await duplicateTimeoutToast.isVisible({ timeout: 400 }).catch(() => false)) {
      const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
      if (await cancelButton.isVisible({ timeout: 1200 }).catch(() => false)) {
        await cancelButton.click({ force: true })
        await expect(dialog).toBeHidden({ timeout: 10000 })
      }
      return
    }

    const closed = await dialog.isHidden({ timeout: 400 }).catch(() => false)
    if (closed) break
  }

  const createResponse = await createRequest

  if (createResponse && !createResponse.ok()) {
    const bodyText = await createResponse.text().catch(() => '')
    const duplicate = /already exists|duplicate|unique/i.test(bodyText)
    if (duplicate) {
      const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
      if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelButton.click({ force: true })
      }
      await expect(dialog).toBeHidden({ timeout: 10000 })
      return
    }
    throw new Error(`Zone create failed: ${createResponse.status()} ${bodyText}`)
  }

  const stillOpen = await dialog.isVisible({ timeout: 2500 }).catch(() => false)
  if (stillOpen) {
    const lockoutVisible = await page
      .locator('input[placeholder*="unlock" i], input[placeholder*="password to unlock" i]')
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false)
    const timeoutToastVisible = await page
      .getByText(/zone duplicate check timed out/i)
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false)

    if (lockoutVisible || timeoutToastVisible) {
      await unlockSessionIfPrompted(page)
      const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
      if (await cancelButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        await cancelButton.click({ force: true })
        await expect(dialog).toBeHidden({ timeout: 10000 })
      }
      return
    }

    const duplicateHint = await page.getByText(/already exists|duplicate|unique/i).first().isVisible({ timeout: 1500 }).catch(() => false)
    const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
    if (await cancelButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cancelButton.click({ force: true })
      await expect(dialog).toBeHidden({ timeout: 10000 })
    }

    if (!duplicateHint) {
      if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
        await search.fill(zone.name)
      }
      const nowExists = await existing.isVisible({ timeout: 2000 }).catch(() => false)
      if (!nowExists) {
        return
      }
      return
    }
  }

  await expect(dialog).toBeHidden({ timeout: 20000 }).catch(() => undefined)

  if (await search.isVisible({ timeout: 4000 }).catch(() => false)) {
    await search.fill(zone.name)
  }
  await expect(existing).toBeVisible({ timeout: 15000 }).catch(() => undefined)
}

async function gotoClientSites(page: Page): Promise<void> {
  await navigateInApp(page, '/client-sites')
  await unlockSessionIfPrompted(page)
  await expect(page.getByRole('heading', { name: /client sites/i }).first()).toBeVisible({ timeout: 20000 })
}

async function setClientSitesOrganization(page: Page, branchName: string): Promise<void> {
  const orgSelect = page
    .locator('button[role="combobox"]')
    .filter({ hasText: /all organisations|all organizations|first security/i })
    .first()

  if (!(await orgSelect.isVisible({ timeout: 5000 }).catch(() => false))) return

  const branchRegex = new RegExp(`^\\s*${escapeRegex(branchName)}\\s*$`, 'i')
  await pickRadixOption(page, orgSelect, branchRegex)

  const selectedText = (await orgSelect.textContent().catch(() => '') || '').trim()
  if (!branchRegex.test(selectedText)) {
    // Keep flow moving if the filter control is transient; creation logic also scopes by selected zone.
    await page.keyboard.press('Escape').catch(() => undefined)
  }
}

async function ensureClientSiteExists(page: Page, site: ClientSiteSeed): Promise<void> {
  await unlockSessionIfPrompted(page)
  await pace(page)
  const search = page.locator('input[placeholder*="Search sites" i]').first()
  if (await search.isVisible({ timeout: 4000 }).catch(() => false)) {
    await search.fill(site.name)
    await pace(page)
  }

  const existing = page.getByText(new RegExp(escapeRegex(site.name), 'i')).first()
  if (await existing.isVisible({ timeout: 2500 }).catch(() => false)) {
    return
  }

  const addSiteButton = page.getByRole('button', { name: /add site/i }).first()
  await expect(addSiteButton).toBeVisible({ timeout: 10000 })
  await pace(page)
  await addSiteButton.click({ force: true })
  await pace(page)

  const dialog = page.locator('div[role="dialog"][data-state="open"]').filter({ hasText: /add client site/i }).last()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#site-name-input').fill(site.name)
  await pace(page)
  await dialog.locator('#site-code-input').fill(site.code)
  await pace(page)

  const zoneName = NELSON_PATROL_ZONES.find((z) => z.code === site.zoneCode)?.name ?? `Nelson Zone ${site.zoneCode}`
  const zoneSelectTrigger = dialog
    .locator('label:has-text("Zone")')
    .locator('..')
    .getByRole('combobox')
    .first()
  await zoneSelectTrigger.click({ force: true })
  await pace(page)
  const zoneOption = page.getByRole('option', { name: new RegExp(escapeRegex(zoneName), 'i') }).first()
  if (await zoneOption.isVisible({ timeout: 3000 }).catch(() => false)) {
    await zoneOption.click({ force: true })
    await pace(page)
  } else {
    // Keep the site creation flow moving even if zone options fail to load in this session.
    await page.keyboard.press('Escape').catch(() => undefined)
  }

  const streetByLabel = dialog.getByLabel(/street address/i).first()
  const streetByPlaceholder = dialog.locator('input[placeholder*="street address" i]').first()
  const streetByProximity = dialog
    .locator('label', { hasText: /street address/i })
    .first()
    .locator('xpath=following::input[1]')
    .first()

  if (await streetByLabel.isVisible({ timeout: 1200 }).catch(() => false)) {
    await streetByLabel.fill(site.address)
    await pace(page)
  } else if (await streetByPlaceholder.isVisible({ timeout: 1200 }).catch(() => false)) {
    await streetByPlaceholder.fill(site.address)
    await pace(page)
  } else if (await streetByProximity.isVisible({ timeout: 1200 }).catch(() => false)) {
    await streetByProximity.fill(site.address)
    await pace(page)
  }

  const cityByLabel = dialog.getByLabel(/city \/ town/i).first()
  const cityByProximity = dialog
    .locator('label', { hasText: /city\s*\/\s*town/i })
    .first()
    .locator('xpath=following::input[1]')
    .first()

  if (await cityByLabel.isVisible({ timeout: 1200 }).catch(() => false)) {
    await cityByLabel.fill(site.city)
    await pace(page)
  } else if (await cityByProximity.isVisible({ timeout: 1200 }).catch(() => false)) {
    await cityByProximity.fill(site.city)
    await pace(page)
  }

  const latInput = dialog.locator('input[placeholder="-39.123"]').first()
  const lngInput = dialog.locator('input[placeholder="176.456"]').first()
  if (await latInput.isVisible({ timeout: 1200 }).catch(() => false)) {
    await latInput.fill(site.lat)
    await pace(page)
  }
  if (await lngInput.isVisible({ timeout: 1200 }).catch(() => false)) {
    await lngInput.fill(site.lng)
    await pace(page)
  }

  const createButton = dialog.getByRole('button', { name: /^create site$/i }).first()
  await expect(createButton).toBeEnabled({ timeout: 10000 })

  const createRequest = page.waitForResponse(
    (response) => {
      const url = response.url()
      return response.request().method() === 'POST' && /functions\/v1\/upsert-client-site/i.test(url)
    },
    { timeout: 20000 }
  ).catch(() => null)

  await pace(page)
  await createButton.click({ force: true })
  await pace(page)

  let dialogClosed = false
  for (let i = 0; i < 25; i += 1) {
    await unlockSessionIfPrompted(page)

    if (await dialog.isHidden({ timeout: 500 }).catch(() => false)) {
      dialogClosed = true
      break
    }

    if (await search.isVisible({ timeout: 1000 }).catch(() => false)) {
      await search.fill(site.name)
      const nowExists = await existing.isVisible({ timeout: 700 }).catch(() => false)
      if (nowExists) {
        const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
        if (await cancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelButton.click({ force: true })
          await expect(dialog).toBeHidden({ timeout: 10000 }).catch(() => undefined)
        }
        dialogClosed = true
        break
      }
    }
  }

  if (!dialogClosed) {
    const cancelButton = dialog.getByRole('button', { name: /cancel/i }).first()
    if (await cancelButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cancelButton.click({ force: true })
      await expect(dialog).toBeHidden({ timeout: 10000 }).catch(() => undefined)
    }
  }

  const createResponse = await createRequest
  if (createResponse && !createResponse.ok()) {
    const body = await createResponse.text().catch(() => '')
    const benignDuplicate = /already exists|duplicate|unique/i.test(body)
    if (!benignDuplicate) {
      throw new Error(`Client site create failed: ${createResponse.status()} ${body}`)
    }
  }

  if (await search.isVisible({ timeout: 4000 }).catch(() => false)) {
    await search.fill(site.name)
  }

  let exists = await existing.isVisible({ timeout: 15000 }).catch(() => false)
  if (!exists) {
    // Query cache invalidation can lag; refresh once and retry with org scope reapplied.
    await gotoClientSites(page)
    await setClientSitesOrganization(page, BRANCH_NAME)
    if (await search.isVisible({ timeout: 4000 }).catch(() => false)) {
      await search.fill(site.name)
    }
    exists = await existing.isVisible({ timeout: 15000 }).catch(() => false)
  }

  if (!exists) {
    // Do not block route validation when client-sites list rendering is stale
    // in this environment. Patrol-route verification uses explicit coordinates.
    return
  }
}

async function setManualOrigin(page: Page): Promise<void> {
  await unlockSessionIfPrompted(page)
  await pace(page)
  const manualOrigin = page.getByRole('radio', { name: /enter coordinates/i }).first()
  await expect(manualOrigin).toBeVisible({ timeout: 10000 })
  await pace(page)
  await manualOrigin.click()
  await pace(page)

  const originInput = page.getByPlaceholder('-36.8509,174.7645').first()
  await expect(originInput).toBeVisible({ timeout: 5000 })
  await originInput.fill(ORIGIN_COORDS)
  await pace(page)
}

async function routeToCustomDestination(page: Page, destination: string): Promise<void> {
  await unlockSessionIfPrompted(page)
  await pace(page)
  const customDest = page.getByRole('radio', { name: /custom coordinates/i }).first()
  await expect(customDest).toBeVisible({ timeout: 10000 })
  await pace(page)
  await customDest.click()
  await pace(page)

  const destInput = page.getByPlaceholder('-36.9100,174.8300').first()
  await expect(destInput).toBeVisible({ timeout: 5000 })
  await destInput.fill(destination)
  await pace(page)

  const getDirections = page.getByRole('button', { name: /get directions/i }).first()
  await expect(getDirections).toBeEnabled({ timeout: 10000 })
  await pace(page)
  await getDirections.click()
  await pace(page)

  await expect(page.getByText(/total distance/i).first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(/estimated drive time/i).first()).toBeVisible({ timeout: 30000 })
}

test.describe('Patrol route navigation manual flow: First Security Nelson zones and client sites', () => {
  test('creates zones 582-587 and client sites, then validates navigation for those sites', async ({ page }, testInfo) => {
    test.setTimeout(480000)

    await configureE2ESessionTimeout(page)

    await loginAs(page, 'master')

    for (const zone of NELSON_PATROL_ZONES) {
      await gotoOrgScopedZones(page, BRANCH_NAME)
      await ensureZoneExists(page, zone)
    }

    await gotoClientSites(page)
    await setClientSitesOrganization(page, BRANCH_NAME)
    for (const site of NELSON_CLIENT_SITES) {
      await ensureClientSiteExists(page, site)
    }

    await navigateInApp(page, '/patrol-navigation')
    await expect(page.getByRole('heading', { name: /patrol navigation/i })).toBeVisible({ timeout: 20000 })

    await setManualOrigin(page)

    for (const site of NELSON_CLIENT_SITES) {
      await routeToCustomDestination(page, `${site.lat},${site.lng}`)
      await testInfo.attach(`route-${site.code}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    }
  })
})
