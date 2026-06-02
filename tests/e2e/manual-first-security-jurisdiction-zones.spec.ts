import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

type BranchSeed = {
  branchName: string
  address: string
  latitude: number
  longitude: number
}

// Source: https://www.firstsecurity.co.nz/api/v2/GetOfficeByLocation?rootPageID=30373
const BRANCH_SEEDS: BranchSeed[] = [
  { branchName: 'Ashburton - First Security', address: '179 Alford Forest Road, Allenton, Ashburton 7700', latitude: -43.88787, longitude: 171.73498 },
  { branchName: 'Auckland - First Security', address: '2 Arthur Brown Place, Mt Wellington 1060, New Zealand', latitude: -36.91646, longitude: 174.84614 },
  { branchName: 'Blenheim - First Security', address: 'Unit 10, 54 Scott Street, Blenheim, New Zealand', latitude: -41.5165, longitude: 173.95677 },
  { branchName: 'Christchurch - First Security', address: '17 Avenger Cres, Wigram, Christchurch, New Zealand', latitude: -43.5523, longitude: 172.56684 },
  { branchName: 'Dunedin - First Security', address: '65C Bridgman St, Kensington, New Zealand', latitude: -45.8909302, longitude: 170.4963029 },
  { branchName: 'Far North - First Security', address: '7-9 General Avenue, KeriKeri 0210, New Zealand', latitude: -35.233459, longitude: 173.957962 },
  { branchName: 'Greymouth - First Security', address: '50 Albert Street, Greymouth, New Zealand', latitude: -42.44941, longitude: 171.20943 },
  { branchName: 'Hamilton - First Security', address: '12-14 Pukete Road, Hamilton, New Zealand 3200', latitude: -37.74756, longitude: 175.24621 },
  { branchName: 'Invercargill - First Security', address: 'Unit 3, 41 Leet Street, Invercargill 9810, New Zealand', latitude: -46.41247, longitude: 168.35004 },
  { branchName: 'Kaitaia - First Security', address: 'Puckey Avenue, Kaitaia 0410', latitude: -35.11324, longitude: 173.26331 },
  { branchName: 'Kapiti - First Security', address: '202 Kapiti Road, Paraparaumu 5032', latitude: -40.90529, longitude: 175.00994 },
  { branchName: 'Kawarau - First Security', address: '60 Onslow Street, Kawarau', latitude: -45.02136, longitude: 168.72854 },
  { branchName: 'King Country - First Security', address: '21 Huia Street, Taumarunui 3920', latitude: -38.88029, longitude: 175.26172 },
  { branchName: 'Masterton - First Security', address: '2/140 Dixon Street, Masterton', latitude: -40.95426, longitude: 175.65377 },
  { branchName: 'Napier - First Security', address: '66 Wakefield Street, Onekawa, Napier 4110', latitude: -39.50795, longitude: 176.8734 },
  { branchName: 'Nelson - First Security', address: '15 Forest Road, Stoke, Nelson 7011', latitude: -41.31185, longitude: 173.23262 },
  { branchName: 'Oamaru - First Security', address: '118 Thames Street, Oamaru, New Zealand', latitude: -45.09685, longitude: 170.9704 },
  { branchName: 'Palmerston North - First Security', address: 'Unit 3/703 Tremaine Avenue, Palmerston North, New Zealand', latitude: -40.33522, longitude: 175.6278 },
  { branchName: 'Queenstown - First Security', address: '8 Duke Street, Queenstown, New Zealand', latitude: -45.03204, longitude: 168.66259 },
  { branchName: 'Rotorua - First Security', address: '65 Marguerita Street, Fenton Park, Rotorua 3010, New Zealand', latitude: -38.15949, longitude: 176.24836 },
  { branchName: 'Taranaki - First Security', address: '32 Oropuriri Road, Waiwhakaiho, New Plymouth 4312, New Zealand', latitude: -39.02215, longitude: 174.1287 },
  { branchName: 'Taupo - First Security', address: '20/15 Totara Street, Tauhara, Taupo 3330', latitude: -38.67993, longitude: 176.08301 },
  { branchName: 'Tauranga - First Security', address: '56 Tenth Avenue, Tauranga 3110, New Zealand', latitude: -37.69502, longitude: 176.15344 },
  { branchName: 'Timaru - First Security', address: '14 Edward Street, Timaru, New Zealand', latitude: -44.39153, longitude: 171.24542 },
  { branchName: 'Tokoroa - First Security', address: '65 Marguerita Street, Fenton Park, Rotorua 3010, New Zealand', latitude: -38.15949, longitude: 176.24836 },
  { branchName: 'Wellington - First Security', address: '28 Downer Street, Hutt Central, Lower Hutt 5010', latitude: -41.21131, longitude: 174.90865 },
  { branchName: 'Whangamata - First Security', address: '1st/429 Port Road, Whangamata 3620', latitude: -37.20185, longitude: 175.86913 },
  { branchName: 'Whanganui - First Security', address: '136 St Hill Street, Whanganui 4500, New Zealand', latitude: -39.93069, longitude: 175.05005 },
  { branchName: 'Whangarei First Security', address: '11 South End Ave, Raumanga, New Zealand', latitude: -35.75054, longitude: 174.29958 },
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jurisdictionName(branchName: string): string {
  return `${branchName} Jurisdiction`
}

function jurisdictionDescription(seed: BranchSeed): string {
  return `Branch jurisdiction seeded from firstsecurity.co.nz office source. Address: ${seed.address}. Coordinates: ${seed.latitude}, ${seed.longitude}.`
}

async function gotoZones(page: Page): Promise<void> {
  await page.goto('/zones', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/zones(?:\?|$|#)/, { timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function setOrganizationScope(page: Page, branchName: string): Promise<void> {
  const orgFilter = page
    .locator('button[role="combobox"]')
    .filter({ hasText: /all organisations|all organizations|first security|security guard/i })
    .first()

  if (!(await orgFilter.isVisible({ timeout: 2500 }).catch(() => false))) return

  await orgFilter.click()
  await page.getByRole('option', { name: new RegExp(`^\\s*${escapeRegex(branchName)}\\s*$`, 'i') }).first().click({ force: true })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function zoneExistsBySearch(page: Page, zoneName: string): Promise<boolean> {
  const search = page.locator('input[placeholder*="Search zones by name" i]').first()
  if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
    await search.fill(zoneName)
  }
  const match = page.getByText(new RegExp(`^\\s*${escapeRegex(zoneName)}\\s*$`, 'i')).first()
  return match.isVisible({ timeout: 2500 }).catch(() => false)
}

async function resetSearch(page: Page): Promise<void> {
  const search = page.locator('input[placeholder*="Search zones by name" i]').first()
  if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
    await search.fill('')
  }
}

async function openCreateZoneDialog(page: Page): Promise<void> {
  const addButton = page.getByRole('button', { name: /add zone/i }).first()
  await expect(addButton).toBeVisible({ timeout: 15000 })
  await addButton.click()
  const dialog = page.getByRole('dialog').filter({ hasText: /add zone|create a new enforcement or jurisdiction zone/i }).first()
  await expect(dialog).toBeVisible({ timeout: 10000 })
  await expect(dialog.locator('#createName')).toBeVisible({ timeout: 10000 })
}

async function createJurisdictionZone(page: Page, seed: BranchSeed): Promise<'created' | 'duplicate'> {
  await openCreateZoneDialog(page)
  const dialog = page.getByRole('dialog').filter({ hasText: /add zone|create a new enforcement or jurisdiction zone/i }).first()
  const nameField = dialog.locator('#createName')
  const descriptionField = dialog.locator('#createDescription')

  await nameField.click()
  await nameField.fill('')
  await nameField.type(jurisdictionName(seed.branchName), { delay: 18 })

  await descriptionField.click()
  await descriptionField.fill('')
  await descriptionField.type(jurisdictionDescription(seed), { delay: 8 })

  const createOrganization = dialog.locator('#createOrganization')
  if (await createOrganization.isVisible({ timeout: 5000 }).catch(() => false)) {
    await createOrganization.scrollIntoViewIfNeeded()
    await createOrganization.click()
    await page.getByRole('option', { name: new RegExp(`^\\s*${escapeRegex(seed.branchName)}\\s*$`, 'i') }).first().click({ force: true })
  }

  await dialog.locator('#createZoneType').click()
  await page.getByRole('option', { name: /general \(jurisdiction area\)/i }).first().click({ force: true })

  const submitButton = dialog.getByRole('button', { name: /create zone/i }).first()
  await expect(submitButton).toBeVisible({ timeout: 5000 })
  await expect(submitButton).toBeEnabled({ timeout: 5000 })

  const createRequest = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/rest/v1/zones'),
    { timeout: 15000 }
  ).catch(() => null)

  await submitButton.click({ force: true })

  const createResponse = await createRequest
  let createResponseStatus: number | null = null
  let createResponseBody = ''
  if (createResponse) {
    const status = createResponse.status()
    const bodyText = await createResponse.text().catch(() => '')
    createResponseStatus = status
    createResponseBody = bodyText

    if (status >= 200 && status < 300) {
      if (!(await dialog.isHidden({ timeout: 2000 }).catch(() => false))) {
        const cancel = dialog.getByRole('button', { name: /cancel/i }).first()
        if (await cancel.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancel.click()
          await dialog.isHidden({ timeout: 10000 }).catch(() => undefined)
        }
      }
      return 'created'
    }

    if (status === 409 || /already exists|idx_zones_unique_org_name_active/i.test(bodyText)) {
      const cancel = dialog.getByRole('button', { name: /cancel/i }).first()
      if (await cancel.isVisible({ timeout: 1000 }).catch(() => false)) {
        await cancel.click()
        await expect(dialog).toBeHidden({ timeout: 10000 })
      }
      return 'duplicate'
    }
  }

  const successToast = page.getByText(/zone created successfully/i).first()
  const duplicateMessage = page
    .getByText(/already exists in this organisation|already exists/i)
    .first()

  const settled = await Promise.race([
    dialog.isHidden({ timeout: 15000 }).then((hidden) => (hidden ? 'closed' : 'none')).catch(() => 'none'),
    successToast.isVisible({ timeout: 15000 }).then((visible) => (visible ? 'success' : 'none')).catch(() => 'none'),
    duplicateMessage.isVisible({ timeout: 15000 }).then((visible) => (visible ? 'duplicate' : 'none')).catch(() => 'none'),
  ])

  if (settled === 'closed' || settled === 'success') {
    return 'created'
  }

  if (settled === 'duplicate') {
    const cancel = dialog.getByRole('button', { name: /cancel/i }).first()
    if (await cancel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancel.click()
      await expect(dialog).toBeHidden({ timeout: 10000 })
    }
    return 'duplicate'
  }

  const submitDisabled = await submitButton.isDisabled().catch(() => false)

  const anyError = await page
    .locator('[role="alert"], [data-variant="destructive"], .toast-error')
    .first()
    .textContent()
    .catch(() => null)

  const apiError = createResponse
    ? `API status=${createResponseStatus} body=${createResponseBody.slice(0, 300)}`
    : 'No POST /rest/v1/zones response captured.'

  throw new Error(
    `Create Zone dialog did not close after submit. ` +
    `${anyError ? `UI error: ${anyError.trim()}` : 'No duplicate/error toast detected.'} ` +
    `Submit disabled=${submitDisabled}. ${apiError}`
  )
}

test.describe('Manual UI data entry: First Security jurisdiction zones', () => {
  test('create one jurisdiction zone for each First Security branch', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000)

    const created: string[] = []
    const skipped: string[] = []

    await loginAs(page, 'master')
    await gotoZones(page)

    for (const seed of BRANCH_SEEDS) {
      await gotoZones(page)
      await setOrganizationScope(page, seed.branchName)

      const zoneName = jurisdictionName(seed.branchName)
      if (await zoneExistsBySearch(page, zoneName)) {
        skipped.push(zoneName)
        await resetSearch(page)
        continue
      }

      await resetSearch(page)
      const result = await createJurisdictionZone(page, seed)
      if (result === 'duplicate') {
        skipped.push(zoneName)
      } else {
        created.push(zoneName)
      }
    }

    console.log(`[manual-jurisdiction-entry] created=${created.length} skipped=${skipped.length}`)
    console.log(`[manual-jurisdiction-entry] created_names=${created.join(' | ')}`)
    console.log(`[manual-jurisdiction-entry] skipped_names=${skipped.join(' | ')}`)

    await gotoZones(page)
  })
})
