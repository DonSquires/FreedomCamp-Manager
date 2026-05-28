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
  zones: Array<{ name: string }>
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
}

async function gotoWithRecovery(page: Page, path: string, role: 'adminOrg1' | 'officerOrg1'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (/\/login(?:\?|$|#)/i.test(page.url())) {
    await loginAs(page, role)
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
}

async function clickWithRetry(target: Locator, attempts = 2): Promise<void> {
  let lastError: unknown = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      await target.click({ timeout: 10000 })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Click failed after retries')
}

async function resolveDeputyCsvFromStoragePreferBucket(): Promise<string> {
  const fallback = resolve(process.cwd(), 'deputy-data.csv')
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()

  if (!url || !key) return fallback

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    })

    for (const bucket of ['Service-Contracts', 'service-contracts']) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download('Deputy-Data/Deputy data.csv')

      if (!error && data) {
        const tempDir = await mkdtemp(join(tmpdir(), 'playwright-beta-storage-'))
        const filePath = join(tempDir, 'deputy-data.csv')
        await writeFile(filePath, Buffer.from(await data.arrayBuffer()))
        return filePath
      }
    }
  } catch {
    // Fall back to local CSV fixture.
  }

  return fallback
}

function buildSeedDataFromDeputyCsv(csvText: string): SeedData {
  const parsed = parseDeputyImportText(csvText)
  const usersMap = new Map<string, SeedUser>()
  const sitesMap = new Map<string, { name: string; code: string }>()
  const zonesMap = new Map<string, { name: string }>()
  const suffix = Date.now().toString().slice(-6)

  for (const row of parsed.rows) {
    const rawDisplayName = (row.employeeDisplayName || row.employeeName || '').trim()
    const locationName = (row.locationName || row.areaName || '').trim()

    if (rawDisplayName) {
      const parts = rawDisplayName.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
      const firstName = parts[0] || 'Field'
      const lastName = parts.slice(1).join(' ') || 'Officer'
      const email = `${sanitizeToken(firstName)}.${sanitizeToken(lastName)}.${suffix}@example.com`
      const key = `${firstName}|${lastName}`.toLowerCase()
      if (!usersMap.has(key)) {
        usersMap.set(key, { firstName, lastName, email })
      }
    }

    if (locationName) {
      const codeBase = sanitizeToken(locationName).slice(0, 10).toUpperCase() || 'SITE'
      if (!sitesMap.has(locationName.toLowerCase())) {
        sitesMap.set(locationName.toLowerCase(), { name: locationName, code: `${codeBase}-${suffix}` })
      }

      const zoneName = locationName.includes('Zone') ? locationName : `${locationName} Zone`
      if (!zonesMap.has(zoneName.toLowerCase())) {
        zonesMap.set(zoneName.toLowerCase(), { name: zoneName })
      }
    }
  }

  return {
    users: Array.from(usersMap.values()).slice(0, 1),
    sites: Array.from(sitesMap.values()).slice(0, 1),
    zones: Array.from(zonesMap.values()).slice(0, 1),
  }
}

async function waitForDialogSubmitToComplete(page: Page, dialog: Locator, timeoutMs: number, contextLabel: string): Promise<void> {
  const closed = await expect(dialog).not.toBeVisible({ timeout: timeoutMs }).then(() => true).catch(() => false)
  if (closed) return

  const pendingButton = dialog.getByRole('button', { name: /Creating|Create|Save|Importing|Import/i }).first()
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
  await gotoWithRecovery(page, '/client-sites', 'adminOrg1')
  await expect(page.getByRole('button', { name: /Add Site/i })).toBeVisible({ timeout: 10000 })

  const existing = await page.getByText(new RegExp(escapeRegex(site.name), 'i')).first().isVisible({ timeout: 1500 }).catch(() => false)
  if (existing) return

  await clickWithRetry(page.getByRole('button', { name: /Add Site/i }))
  const dialog = page.getByRole('dialog').filter({ hasText: /Add Client Site/i }).last()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.getByLabel(/Site Name/i).fill(site.name)
  await dialog.getByLabel(/Site Code/i).fill(site.code)
  await dialog.getByRole('button', { name: /^Create Site$/i }).click({ force: true })
  await waitForDialogSubmitToComplete(page, dialog, 15000, `Client site create for "${site.name}"`)
}

async function chooseRoleOption(page: Page, dialog: Locator, roleLabel: RegExp): Promise<void> {
  const roleTrigger = dialog.getByRole('combobox').first()
  await roleTrigger.click()
  await page.getByRole('option', { name: roleLabel }).first().click()
}

async function ensureUserExists(page: Page, user: SeedUser): Promise<void> {
  await gotoWithRecovery(page, '/users', 'adminOrg1')
  await expect(page.getByRole('button', { name: /Create User/i }).first()).toBeVisible({ timeout: 10000 })

  const existing = await page.getByText(new RegExp(escapeRegex(user.email), 'i')).first().isVisible({ timeout: 1500 }).catch(() => false)
  if (existing) return

  await clickWithRetry(page.getByRole('button', { name: /Create User/i }).first())
  const dialog = page.getByRole('dialog').filter({ hasText: /Create New User/i }).last()
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await dialog.locator('#email').fill(user.email)
  await dialog.locator('#firstName').fill(user.firstName)
  await dialog.locator('#lastName').fill(user.lastName)
  await chooseRoleOption(page, dialog, /^Officer$/i)
  await dialog.locator('#createPassword').fill('Test123!')
  await dialog.locator('#createConfirmPassword').fill('Test123!')

  await dialog.getByRole('button', { name: /^Create User$/i }).click()
  await waitForDialogSubmitToComplete(page, dialog, 15000, `User create for "${user.email}"`)
}

async function runPatrolFlow(page: Page): Promise<void> {
  await gotoWithRecovery(page, '/patrol-navigation', 'officerOrg1')
  await expect(page.getByRole('heading', { name: /Patrol Navigation/i })).toBeVisible({ timeout: 15000 })

  await page.getByLabel('Enter coordinates').first().check()
  await page.getByPlaceholder('-36.8509,174.7645').fill('-41.27120,173.28390')

  await page.getByLabel('Custom coordinates').first().check()
  await page.getByPlaceholder('-36.9100,174.8300').fill('-41.28580,173.27780')

  await page.getByRole('button', { name: /Get Directions/i }).click()
  await expect(page.getByText(/Total distance/i)).toBeVisible({ timeout: 30000 })
}

async function sweepRoutes(page: Page, paths: string[], findings: string[], roleLabel: string): Promise<void> {
  for (const path of paths) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
    if (/\/login(?:\?|$|#)/i.test(page.url())) {
      findings.push(`${roleLabel} redirected to login for ${path}`)
      continue
    }

    const hasFatal = await page.getByText(/unexpected application error|something went wrong/i).first().isVisible({ timeout: 1500 }).catch(() => false)
    if (hasFatal) {
      findings.push(`${roleLabel} saw fatal UI error on ${path}`)
      continue
    }

    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 })
  }
}

test.describe('Beta workflow via storage-driven UI seeding', () => {
  test.describe.configure({ mode: 'serial' })

  test('seed via UI from storage, then roster/patrol and core module walkthrough', async ({ page }) => {
    test.setTimeout(420000)
    const findings: string[] = []

    const deputyCsvPath = await resolveDeputyCsvFromStoragePreferBucket()
    const csvText = await readFile(deputyCsvPath, 'utf8')
    const seed = buildSeedDataFromDeputyCsv(csvText)

    await loginAs(page, 'adminOrg1')

    await test.step('Read storage bucket data and derive form seed', async () => {
      if (seed.users.length === 0) {
        findings.push('Storage read produced no users to seed into UI forms')
      }
      if (seed.sites.length === 0) {
        findings.push('Storage read produced no sites to seed into UI forms')
      }
    })

    await test.step('Create client sites via UI forms from storage-derived seed data', async () => {
      for (const site of seed.sites) {
        try {
          await ensureClientSiteExists(page, site)
        } catch (error) {
          findings.push(`Client site create failed (${site.name}): ${(error as Error).message}`)
        }
      }
    })

    await test.step('Create users via UI forms from storage-derived seed data', async () => {
      for (const user of seed.users) {
        try {
          await ensureUserExists(page, user)
        } catch (error) {
          findings.push(`User create failed (${user.email}): ${(error as Error).message}`)
        }
      }
    })

    await test.step('Publish roster week if drafts exist', async () => {
      await page.goto('/roster', { waitUntil: 'domcontentloaded', timeout: 45000 })
      const publishWeekButton = page.getByRole('button', { name: /Publish Week/i })
      const canPublish = await publishWeekButton.isEnabled({ timeout: 5000 }).catch(() => false)
      if (canPublish) {
        await publishWeekButton.click()
        await page.getByRole('button', { name: /^Publish$/i }).click()
      }
    })

    await test.step('Officer patrol workflow', async () => {
      await loginAs(page, 'officerOrg1')
      try {
        await runPatrolFlow(page)
      } catch (error) {
        findings.push(`Officer patrol flow failed: ${(error as Error).message}`)
      }
    })

    await test.step('Admin route sweep', async () => {
      await loginAs(page, 'adminOrg1')
      await sweepRoutes(
        page,
        ['/admin/dashboard', '/dispatch', '/ems', '/client-sites', '/zones', '/users', '/roster', '/audit-log'],
        findings,
        'adminOrg1'
      )
    })

    await test.step('Officer route sweep', async () => {
      await loginAs(page, 'officerOrg1')
      await sweepRoutes(page, ['/officer-home', '/field-officer', '/patrol-navigation'], findings, 'officerOrg1')
    })

    expect(findings, `Beta workflow disconnects:\n- ${findings.join('\n- ')}`).toEqual([])
  })
})
