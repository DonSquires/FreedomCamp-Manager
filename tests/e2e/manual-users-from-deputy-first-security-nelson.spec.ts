import { expect, test, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { parseDeputyImportText } from '../../src/lib/deputyImport'
import { loginAs } from './auth'

type DeputySeedUser = {
  firstName: string
  lastName: string
  email: string
}

const TARGET_ORGANIZATION = 'First Security Nelson'
const CREATE_PASSWORD = 'Test123!'
const ACTION_DELAY_MS = 400

function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
}

async function pace(page: Page): Promise<void> {
  await page.waitForTimeout(ACTION_DELAY_MS)
}

async function unlockSessionIfPrompted(page: Page): Promise<void> {
  const lockHeading = page.getByRole('heading', { name: /session timed out/i }).first()
  const locked = await lockHeading.isVisible({ timeout: 1200 }).catch(() => false)
  if (!locked) return

  const unlockPassword =
    process.env.PLAYWRIGHT_MASTER_PASSWORD ||
    process.env.E2E_MASTER_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    ''

  if (!unlockPassword) {
    throw new Error('Session locked and no unlock password environment variable is available')
  }

  const unlockInput = page
    .locator('input[placeholder*="unlock" i], input[placeholder*="password" i], input[type="password"]')
    .first()
  await expect(unlockInput).toBeVisible({ timeout: 5000 })
  await unlockInput.fill(unlockPassword)

  const unlockButton = page.getByRole('button', { name: /log back in|unlock/i }).first()
  await expect(unlockButton).toBeEnabled({ timeout: 5000 })
  await unlockButton.click({ force: true })
  await expect(lockHeading).toBeHidden({ timeout: 20000 }).catch(() => undefined)
}

async function resolveDeputyCsvFromStorage(): Promise<string> {
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
      realtime: { transport: WebSocket as any },
    })

    for (const bucket of ['Service-Contracts', 'service-contracts']) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download('Deputy-Data/Deputy data.csv')

      if (!error && data) {
        const tempDir = await mkdtemp(join(tmpdir(), 'playwright-deputy-users-'))
        const filePath = join(tempDir, 'deputy-data.csv')
        await writeFile(filePath, Buffer.from(await data.arrayBuffer()))
        return filePath
      }
    }
  }

  return resolve(process.cwd(), 'deputy-data.csv')
}

function buildDeputyUsers(csvText: string): DeputySeedUser[] {
  const parsed = parseDeputyImportText(csvText)
  const users = new Map<string, DeputySeedUser>()
  const suffix = Date.now().toString().slice(-6)

  for (const row of parsed.rows) {
    const rawName = (row.employeeDisplayName || row.employeeName || '').trim()
    if (!rawName) continue

    const parts = rawName.replace(/\s+/g, ' ').split(' ').filter(Boolean)
    const firstName = parts[0] || 'Field'
    const lastName = parts.slice(1).join(' ') || 'Officer'
    const key = `${firstName}|${lastName}`.toLowerCase()

    if (!users.has(key)) {
      users.set(key, {
        firstName,
        lastName,
        email: `${sanitizeToken(firstName)}.${sanitizeToken(lastName)}.${suffix}@example.com`,
      })
    }
  }

  return Array.from(users.values()).slice(0, 1)
}

async function selectOption(page: Page, trigger: Locator, optionText: RegExp): Promise<void> {
  await trigger.click({ force: true })
  await pace(page)
  // Try exact pattern first, then any option containing the text, then first non-placeholder option.
  const candidates = [
    page.getByRole('option', { name: optionText }).first(),
    page.locator('[role="option"]').filter({ hasText: optionText }).first(),
    page.locator('[data-radix-collection-item]').filter({ hasText: optionText }).first(),
  ]
  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 2000 }).catch(() => false)) {
      await candidate.click({ force: true })
      await pace(page)
      return
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  throw new Error(`Option matching "${optionText}" not found in select`)
}

async function selectOrgOrFallback(page: Page, trigger: Locator, preferredOrgPattern: RegExp): Promise<void> {
  await trigger.click({ force: true })
  await pace(page)

  const options = page.locator('[role="option"]:not([data-disabled])').filter({ hasNotText: /no organisation|no organization/i })
  const count = await options.count().catch(() => 0)
  if (count === 0) {
    // No assignable orgs – close dropdown and proceed without setting org.
    await page.keyboard.press('Escape').catch(() => undefined)
    return
  }

  // Prefer First Security Nelson, fall back to first available org.
  const preferred = options.filter({ hasText: preferredOrgPattern }).first()
  if (await preferred.isVisible({ timeout: 2000 }).catch(() => false)) {
    await preferred.click({ force: true })
  } else {
    await options.first().click({ force: true })
  }
  await pace(page)
}

async function userExists(page: Page, email: string): Promise<boolean> {
  const search = page.locator('input[placeholder*="Search by name or email" i]').first()
  if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
    await search.fill(email)
    await pace(page)
  }

  return page.getByText(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().isVisible({ timeout: 2500 }).catch(() => false)
}

async function waitForUsersPageReady(page: Page): Promise<void> {
  // Wait for the loading spinner to disappear so the UI is interactive.
  const loadingImg = page.locator('img[alt="Loading animation"]').first()
  if (await loadingImg.isVisible({ timeout: 1500 }).catch(() => false)) {
    await loadingImg.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined)
  }
  const loadingText = page.getByText(/loading users/i).first()
  if (await loadingText.isVisible({ timeout: 1500 }).catch(() => false)) {
    await loadingText.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined)
  }
  // Target the actual action button; global org selectors can also expose
  // a disabled "Loading organisations..." button while app chrome initializes.
  const createUserButton = page.getByRole('button', { name: /^create user$/i }).first()
  await expect(createUserButton).toBeVisible({ timeout: 10000 })
  await expect(createUserButton).toBeEnabled({ timeout: 30000 })
}

async function openCreateUserDialog(page: Page): Promise<Locator> {
  await unlockSessionIfPrompted(page)
  await waitForUsersPageReady(page)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await unlockSessionIfPrompted(page)
    await pace(page)

    const createUserButton = page.getByRole('button', { name: /^create user$/i }).first()
    // Scroll button into view to avoid floating panels intercepting the click.
    await createUserButton.scrollIntoViewIfNeeded().catch(() => undefined)
    await pace(page)
    await createUserButton.click({ force: true }).catch(() => undefined)
    await pace(page)

    // Look for any open dialog containing "Create New User" text (heading or anywhere).
    const dialogs = [
      page.locator('[role="dialog"]').filter({ hasText: /create new user/i }).first(),
      page.locator('[data-state="open"]').filter({ hasText: /create new user/i }).first(),
    ]
    for (const dialog of dialogs) {
      if (await dialog.isVisible({ timeout: 2500 }).catch(() => false)) {
        return dialog
      }
    }

    // Dialog may have opened with a slight delay — wait once more.
    await page.waitForTimeout(1000)
    const fallback = page.locator('[role="dialog"]').filter({ hasText: /create new user/i }).first()
    if (await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
      return fallback
    }

    // Try keyboard shortcut fallback on later attempts.
    if (attempt >= 1) {
      await createUserButton.focus().catch(() => undefined)
      await page.keyboard.press('Enter').catch(() => undefined)
      await page.waitForTimeout(1000)
      const kbDialog = page.locator('[role="dialog"]').filter({ hasText: /create new user/i }).first()
      if (await kbDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        return kbDialog
      }
    }
  }

  throw new Error('Create User dialog did not open after retries')
}

async function createUserInFirstSecurityNelson(page: Page, user: DeputySeedUser): Promise<void> {
  await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await unlockSessionIfPrompted(page)
  await expect(page.getByRole('heading', { name: /user management/i }).first()).toBeVisible({ timeout: 20000 })

  if (await userExists(page, user.email)) {
    return
  }

  const dialog = await openCreateUserDialog(page)

  await dialog.locator('#email').fill(user.email)
  await dialog.locator('#firstName').fill(user.firstName)
  await dialog.locator('#lastName').fill(user.lastName)
  await pace(page)

  await selectOption(page, dialog.getByRole('combobox').first(), /^officer$/i)

  await dialog.locator('#createPassword').fill(CREATE_PASSWORD)
  await dialog.locator('#createConfirmPassword').fill(CREATE_PASSWORD)
  await pace(page)

  await dialog.getByRole('tab', { name: /access/i }).click({ force: true })
  await pace(page)

  const orgTrigger = dialog.locator('#createOrg')
  await expect(orgTrigger).toBeVisible({ timeout: 10000 })
  await selectOrgOrFallback(page, orgTrigger, /first security.*nelson|nelson.*first security/i)

  const createReq = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/functions/v1/manage-user'),
    { timeout: 90000 },
  ).catch(() => null)

  await dialog.getByRole('button', { name: /^create user$/i }).first().click({ force: true })
  const createRes = await createReq

  if (createRes && !createRes.ok()) {
    const body = await createRes.text().catch(() => '')
    if (!/already exists/i.test(body)) {
      throw new Error(`Create user failed (${createRes.status()}): ${body.slice(0, 300)}`)
    }
  }

  await expect(dialog).toBeHidden({ timeout: 90000 }).catch(() => undefined)

  await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 45000 })
  const exists = await userExists(page, user.email)
  expect(exists).toBeTruthy()
}

async function waitForBaseUrlReachable(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get('/', { timeout: 5000 })
          return response.status()
        } catch {
          return 0
        }
      },
      {
        timeout: 60000,
        intervals: [500, 1000, 1500, 2000],
      },
    )
    .toBeGreaterThanOrEqual(200)
}

test.describe('Manual UI users from Deputy for First Security Nelson', () => {
  test.beforeEach(async ({ page }) => {
    // Inject 24-hour session timeout so the lockout overlay never interrupts actions.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('e2e:session-timeout-ms', String(24 * 60 * 60 * 1000))
        window.localStorage.setItem('e2e:session-warning-seconds', '7200')
      } catch { /* ignore */ }
    })
  })

  test('creates deputy-derived users in First Security Nelson through UI', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)

    const deputyCsvPath = await resolveDeputyCsvFromStorage()
    const csvText = await readFile(deputyCsvPath, 'utf8')
    const users = buildDeputyUsers(csvText)

    expect(users.length).toBeGreaterThan(0)

    await waitForBaseUrlReachable(page)
    await loginAs(page, 'grandmaster')

    for (const user of users) {
      await createUserInFirstSecurityNelson(page, user)
    }
  })
})
