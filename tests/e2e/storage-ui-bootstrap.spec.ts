import { expect, test, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { parseDeputyImportText } from '../../src/lib/deputyImport'
import { loginAs } from './auth'

type SeedUser = {
  firstName: string
  lastName: string
  email: string
}

type SeedData = {
  users: SeedUser[]
  sites: Array<{ name: string; code: string }>
}

async function resolveDeputyCsvFromStoragePreferBucket(): Promise<string> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()

  if (url && key) {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        transport: WebSocket,
      },
    })

    for (const bucket of ['Service-Contracts', 'service-contracts']) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download('Deputy-Data/Deputy data.csv')
      if (!error && data) {
        const tempDir = await mkdtemp(join(tmpdir(), 'playwright-storage-seed-'))
        const filePath = join(tempDir, 'deputy-data.csv')
        await writeFile(filePath, Buffer.from(await data.arrayBuffer()))
        return filePath
      }
    }
  }

  return resolve(process.cwd(), 'deputy-data.csv')
}

function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
}

function buildSeedDataFromDeputyCsv(csvText: string): SeedData {
  const parsed = parseDeputyImportText(csvText)
  const usersMap = new Map<string, SeedUser>()
  const sitesMap = new Map<string, { name: string; code: string }>()
  const suffix = Date.now().toString().slice(-6)

  for (const row of parsed.rows) {
    const rawDisplayName = (row.employeeDisplayName || row.employeeName || '').trim()
    const locationName = (row.locationName || row.areaName || '').trim()

    if (rawDisplayName) {
      const collapsed = rawDisplayName.replace(/\s+/g, ' ').trim()
      const parts = collapsed.split(' ').filter(Boolean)
      const firstName = parts[0] || 'Field'
      const lastName = parts.slice(1).join(' ') || 'Officer'
      const email = `${sanitizeToken(firstName)}.${sanitizeToken(lastName || 'officer')}.${suffix}@example.com`
      const key = `${firstName}|${lastName}`.toLowerCase()
      if (!usersMap.has(key)) {
        usersMap.set(key, { firstName, lastName, email })
      }
    }

    if (locationName) {
      const siteCode = sanitizeToken(locationName).slice(0, 12).toUpperCase() || 'SITE'
      if (!sitesMap.has(locationName.toLowerCase())) {
        sitesMap.set(locationName.toLowerCase(), { name: locationName, code: `${siteCode}-${suffix}` })
      }

    }
  }

  return {
    users: Array.from(usersMap.values()).slice(0, 3),
    sites: Array.from(sitesMap.values()).slice(0, 3),
  }
}

async function clickSelectOption(page: Page, trigger: Locator, optionMatcher: RegExp): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: optionMatcher }).first().click()
}

async function waitForDialogSubmitToComplete(page: Page, dialog: Locator, timeoutMs: number, contextLabel: string): Promise<void> {
  const closed = await expect(dialog).not.toBeVisible({ timeout: timeoutMs }).then(() => true).catch(() => false)
  if (closed) return

  const pendingButton = dialog.getByRole('button', { name: /Creating|Create|Save/i }).first()
  const stillDisabled = await pendingButton.isDisabled().catch(() => false)
  const alertText = await page
    .locator('[data-sonner-toast], [role="status"], [role="alert"]')
    .first()
    .textContent()
    .catch(() => null)

  await dialog.getByRole('button', { name: /Close|Cancel/i }).first().click().catch(() => undefined)

  throw new Error(
    `${contextLabel} did not complete through UI.${stillDisabled ? ' Submit stayed in pending/disabled state.' : ''}${
      alertText ? ` Latest message: ${alertText.trim()}` : ''
    }`
  )
}

async function ensureClientSiteExists(page: Page, site: { name: string; code: string }): Promise<void> {
  await page.goto('/client-sites', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await expect(page.getByRole('button', { name: /Add Site/i })).toBeVisible({ timeout: 10000 })

  const existing = await page.getByText(new RegExp(site.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().isVisible({ timeout: 1500 }).catch(() => false)
  if (existing) return

  await page.getByRole('button', { name: /Add Site/i }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: /Add Client Site/i }).first()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  const inputs = dialog.locator('input')
  await inputs.first().fill(site.name)
  await dialog.getByLabel(/Site Code/i).fill(site.code)
  await dialog.getByRole('button', { name: /^Create Site$/i }).click()
  await waitForDialogSubmitToComplete(page, dialog, 90000, `Client site create for "${site.name}"`)
}

async function ensureUserExists(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await expect(page.getByRole('button', { name: /Create User/i })).toBeVisible({ timeout: 10000 })

  const existing = await page.getByText(new RegExp(user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().isVisible({ timeout: 1500 }).catch(() => false)
  if (existing) return

  await page.getByRole('button', { name: /Create User/i }).first().click()
  const dialog = page.getByRole('dialog').filter({ hasText: /Create New User/i }).first()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#email').fill(user.email)
  await dialog.locator('#firstName').fill(user.firstName)
  await dialog.locator('#lastName').fill(user.lastName)

  const roleTrigger = dialog.getByRole('combobox').first()
  await clickSelectOption(page, roleTrigger, /^Officer$/i)

  await dialog.locator('#createPassword').fill('Test123!')
  await dialog.locator('#createConfirmPassword').fill('Test123!')

  await dialog.getByRole('button', { name: /^Create User$/i }).click()
  await waitForDialogSubmitToComplete(page, dialog, 90000, `User create for "${user.email}"`)
}

test.describe('Storage bucket UI bootstrap', () => {
  test('creates users and client sites via UI from Deputy storage data', async ({ page }) => {
    test.setTimeout(240000)

    const deputyCsvPath = await resolveDeputyCsvFromStoragePreferBucket()
    const csvText = await readFile(deputyCsvPath, 'utf8')
    const seed = buildSeedDataFromDeputyCsv(csvText)

    await loginAs(page, 'adminOrg1')

    for (const site of seed.sites) {
      await ensureClientSiteExists(page, site)
    }

    for (const user of seed.users) {
      await ensureUserExists(page, user)
    }

    await expect(seed.users.length > 0 || seed.sites.length > 0).toBeTruthy()
  })
})
