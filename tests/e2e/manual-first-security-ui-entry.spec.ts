import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'

const SERVICE_PROVIDER_NAME = 'security guard services ltd'
const ENABLE_MANUAL_SEED = process.env.PLAYWRIGHT_ENABLE_MANUAL_SEED === '1'

const FIRST_SECURITY_BRANCHES = [
  'Ashburton - First Security',
  'Auckland - First Security',
  'Blenheim - First Security',
  'Christchurch - First Security',
  'Dunedin - First Security',
  'Far North - First Security',
  'Greymouth - First Security',
  'Hamilton - First Security',
  'Invercargill - First Security',
  'Kaitaia - First Security',
  'Kapiti - First Security',
  'Kawarau - First Security',
  'King Country - First Security',
  'Masterton - First Security',
  'Napier - First Security',
  'Nelson - First Security',
  'Oamaru - First Security',
  'Palmerston North - First Security',
  'Queenstown - First Security',
  'Rotorua - First Security',
  'Taranaki - First Security',
  'Taupo - First Security',
  'Tauranga - First Security',
  'Timaru - First Security',
  'Tokoroa - First Security',
  'Wellington - First Security',
  'Whangamata - First Security',
  'Whanganui - First Security',
  'Whangarei First Security',
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function gotoOrganizations(page: Page): Promise<void> {
  await page.goto('/organizations', { waitUntil: 'domcontentloaded' })
  const gate = page.getByRole('button', { name: /previewed impact - continue/i }).first()
  if (await gate.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gate.click()
  }
  await expect(page).toHaveURL(/\/organizations(?:\?|$|#)/, { timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function organizationVisible(page: Page, name: string): Promise<boolean> {
  const exact = page.getByText(new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i')).first()
  if (await exact.isVisible({ timeout: 1500 }).catch(() => false)) return true
  const contains = page.getByText(name, { exact: false }).first()
  return contains.isVisible({ timeout: 1500 }).catch(() => false)
}

async function openCreateDialog(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /create new organisation|new organisation|create organisation/i }).first()
  await expect(trigger).toBeVisible({ timeout: 15000 })
  await trigger.click()
  await expect(page.locator('#createName')).toBeVisible({ timeout: 10000 })
}

async function selectOptionByLabel(page: Page, triggerSelector: string, label: RegExp): Promise<void> {
  await page.locator(triggerSelector).click()
  await page.getByRole('option', { name: label }).first().click({ force: true })
}

async function createOrganization(page: Page, name: string, parentName: string | null): Promise<void> {
  await openCreateDialog(page)
  await page.locator('#createName').fill(name)

  await selectOptionByLabel(page, '#createOrgType', /service provider/i)

  await page.locator('#createParentOrg').click()
  if (parentName) {
    await page.getByRole('option', { name: new RegExp(escapeRegex(parentName), 'i') }).first().click({ force: true })
  } else {
    await page.getByRole('option', { name: /none \(top-level\)/i }).first().click({ force: true })
  }

  await page.getByRole('button', { name: /create organisation/i }).last().click()
  await expect(page.locator('#createName')).toBeHidden({ timeout: 20000 })
}

test.describe('Manual UI data entry: First Security branches', () => {
  test.skip(!ENABLE_MANUAL_SEED, 'Manual data seeding is disabled by default. Set PLAYWRIGHT_ENABLE_MANUAL_SEED=1 to run.')

  test('create requested provider and First Security branches via Organizations UI', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000)

    const created: string[] = []
    const skipped: string[] = []

    await loginAs(page, 'master')
    await gotoOrganizations(page)

    if (!(await organizationVisible(page, SERVICE_PROVIDER_NAME))) {
      await createOrganization(page, SERVICE_PROVIDER_NAME, null)
      created.push(SERVICE_PROVIDER_NAME)
      await gotoOrganizations(page)
    } else {
      skipped.push(SERVICE_PROVIDER_NAME)
    }

    for (const branch of FIRST_SECURITY_BRANCHES) {
      await gotoOrganizations(page)
      if (await organizationVisible(page, branch)) {
        skipped.push(branch)
        continue
      }

      await createOrganization(page, branch, SERVICE_PROVIDER_NAME)
      created.push(branch)
    }

    console.log(`[manual-ui-entry] created=${created.length} skipped=${skipped.length}`)
    console.log(`[manual-ui-entry] created_names=${created.join(' | ')}`)
    console.log(`[manual-ui-entry] skipped_names=${skipped.join(' | ')}`)

    await gotoOrganizations(page)
    await expect(page.getByText(new RegExp(escapeRegex(SERVICE_PROVIDER_NAME), 'i')).first()).toBeVisible({ timeout: 20000 })
  })
})
