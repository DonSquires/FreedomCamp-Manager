import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseDeputyImportText } from '../../src/lib/deputyImport'
import { getTestUser, loginAs } from './auth'

type SeedUser = {
  firstName: string
  lastName: string
  email: string
}

function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
}

function buildSeedOfficerFromDeputyCsv(csvText: string): SeedUser {
  const parsed = parseDeputyImportText(csvText)
  const suffix = Date.now().toString().slice(-6)

  const firstNamedRow = parsed.rows.find((row) => (row.employeeDisplayName || row.employeeName || '').trim().length > 0)
  const fullName = (firstNamedRow?.employeeDisplayName || firstNamedRow?.employeeName || 'Field Officer').trim().replace(/\s+/g, ' ')
  const parts = fullName.split(' ').filter(Boolean)
  const firstName = parts[0] || 'Field'
  const lastName = parts.slice(1).join(' ') || 'Officer'

  return {
    firstName,
    lastName,
    email: `${sanitizeToken(firstName)}.${sanitizeToken(lastName)}.${suffix}@example.com`,
  }
}

async function resolveDeputyCsvFromStorage(): Promise<string> {
  const fallbackPath = resolve(process.cwd(), 'deputy-data.csv')

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()

  if (url && key) {
    try {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })

      for (const bucket of ['Service-Contracts', 'service-contracts']) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .download('Deputy-Data/Deputy data.csv')

        if (!error && data) {
          const tempDir = await mkdtemp(join(tmpdir(), 'playwright-deputy-'))
          const downloadedFilePath = join(tempDir, 'deputy-data.csv')
          await writeFile(downloadedFilePath, Buffer.from(await data.arrayBuffer()))
          return downloadedFilePath
        }
      }
    } catch {
      // Fall back to repository fixture when storage access is unavailable.
    }
  }

  await access(fallbackPath)
  return fallbackPath
}

async function ensureUserExists(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await expect(page.getByRole('button', { name: /Create User/i }).first()).toBeVisible({ timeout: 15000 })

  const existing = await page.getByText(new RegExp(user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().isVisible({ timeout: 1500 }).catch(() => false)
  if (existing) return

  await page.getByRole('button', { name: /Create User/i }).first().click()
  const dialog = page.getByRole('dialog').filter({ hasText: /Create New User/i }).last()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#email').fill(user.email)
  await dialog.locator('#firstName').fill(user.firstName)
  await dialog.locator('#lastName').fill(user.lastName)

  const roleTrigger = dialog.getByRole('combobox').first()
  await roleTrigger.click()
  await page.getByRole('option', { name: /^Officer$/i }).first().click()

  await dialog.locator('#createPassword').fill('Test123!')
  await dialog.locator('#createConfirmPassword').fill('Test123!')
  await dialog.getByRole('button', { name: /^Create User$/i }).click()

  await expect(dialog).not.toBeVisible({ timeout: 90000 })
}

async function ensureOfficerRosteredForPatrol(page: Page, seedOfficer: SeedUser) {
  const officerEmail = seedOfficer.email || getTestUser('officerOrg1').email
  const emailTokens = officerEmail
    .split('@')[0]
    .split(/[._+-]/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
  let seededOfficer = false

  for (const adminUser of ['adminOrg1', 'adminOrg2'] as const) {
    await loginAs(page, adminUser)
    await page.goto('/roster', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await expect(page.getByRole('button', { name: /Add Shift/i })).toBeVisible({ timeout: 15000 })

    const noOfficersFound = await page.getByText(/No officers found\./i).isVisible({ timeout: 3000 }).catch(() => false)
    if (noOfficersFound) {
      if (!seededOfficer) {
        await ensureUserExists(page, seedOfficer)
        await page.goto('/roster', { waitUntil: 'domcontentloaded', timeout: 45000 })
        seededOfficer = true
        const stillNoOfficers = await page.getByText(/No officers found\./i).isVisible({ timeout: 5000 }).catch(() => false)
        if (!stillNoOfficers) {
          // Continue with the same admin user after creating a seed officer.
        } else {
          continue
        }
      } else {
        continue
      }
    }

    await page.getByRole('button', { name: /Add Shift/i }).click()

    const shiftDialog = page.getByRole('dialog')
    await expect(shiftDialog.getByRole('heading', { name: /Add Shift|Edit Shift/i })).toBeVisible({ timeout: 10000 })

    // Select officer in the dialog (first combobox is Officer).
    const officerCombobox = shiftDialog.locator('[role="combobox"]').first()
    await officerCombobox.click()

    const options = page.getByRole('option')
    const optionCount = await options.count()
    if (optionCount === 0) {
      await page.keyboard.press('Escape').catch(() => undefined)
      continue
    }

    let selectedOfficer = false
    for (const token of emailTokens) {
      const candidate = options.filter({ hasText: new RegExp(token, 'i') }).first()
      if (await candidate.isVisible({ timeout: 800 }).catch(() => false)) {
        await candidate.click()
        selectedOfficer = true
        break
      }
    }

    if (!selectedOfficer) {
      await options.first().click()
    }

    // Set service type to patrol so officer login routes to patrol-capable flow.
    const serviceTypeLabel = shiftDialog.getByText('Service Type').first()
    const serviceTypeRow = serviceTypeLabel.locator('..')
    const serviceTypeCombobox = serviceTypeRow.locator('[role="combobox"]').first()
    await serviceTypeCombobox.click()
    await page.getByRole('option', { name: /General Patrol/i }).click()

    await shiftDialog.getByRole('button', { name: /^Add Shift$/i }).click()
    await expect(shiftDialog).not.toBeVisible({ timeout: 15000 })

    const publishWeekButton = page.getByRole('button', { name: /Publish Week/i })
    if (await publishWeekButton.isEnabled({ timeout: 5000 }).catch(() => false)) {
      await publishWeekButton.click()
      await page.getByRole('button', { name: /^Publish$/i }).click()
    }

    return
  }

  // Patrol navigation itself does not require creating a roster shift in every
  // seeded environment. If roster assignment cannot be completed, continue with
  // direct officer login and validate in-house routing behavior.
  return
}

test.describe('Patrol navigation in-house routing', () => {
  test('calculates route with in-house provider or in-app fallback', async ({ page }) => {
    test.setTimeout(180000)
    const deputyCsvPath = await resolveDeputyCsvFromStorage()
    const csvText = await readFile(deputyCsvPath, 'utf8')
    const seedOfficer = buildSeedOfficerFromDeputyCsv(csvText)

    await ensureOfficerRosteredForPatrol(page, seedOfficer)
    await loginAs(page, 'officerOrg1')
    await page.goto('/patrol-navigation', { waitUntil: 'domcontentloaded', timeout: 45000 })

    await expect(page.getByRole('heading', { name: /Patrol Navigation/i })).toBeVisible({ timeout: 15000 })

    await page.getByLabel('Enter coordinates').first().check()
    await page.getByPlaceholder('-36.8509,174.7645').fill('-41.27120,173.28390')

    await page.getByLabel('Custom coordinates').first().check()
    await page.getByPlaceholder('-36.9100,174.8300').fill('-41.28580,173.27780')

    await page.getByRole('button', { name: /Get Directions/i }).click()

    const summaryDistance = page.getByText(/Total distance/i)
    await expect(summaryDistance).toBeVisible({ timeout: 20000 })

    const providerHeading = page.getByText(/In-house map provider/i)
    await expect(providerHeading).toBeVisible({ timeout: 20000 })

    const providerText = page.locator('text=/in_house_mapping_gateway|inbuilt-patrol-route-engine/i').first()
    await expect(providerText).toBeVisible({ timeout: 20000 })

    await expect(page.getByText(/Turn-by-Turn Directions/i)).toBeVisible({ timeout: 10000 })
  })
})
