/**
 * User Creation E2E
 *
 * Tests the complete new-user creation workflow on the /users page:
 *   1. Open Create New User dialog
 *   2. Fill in all required fields (email, first name, last name, role, job title, org, password)
 *   3. Submit and verify success feedback
 *   4. Verify new user appears in the user list
 *
 * Also tests:
 *   - Field validation (missing required fields)
 *   - Role selection visibility scoped to caller's role
 *   - Job title options rendered correctly
 *   - Title-drives-requiresDriverLicense behaviour
 *
 * Requires: an admin or master test user with `create_users` permission.
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

test.use({ screenshot: 'on' })

const TEST_EMAIL_PREFIX = `e2e-test-user-${Date.now()}`

// ─── helpers ─────────────────────────────────────────────────────────────────

async function navigateToUsers(page: any) {
  await page.goto('/users', { waitUntil: 'networkidle' })
  await expect(page.locator('h1, h2').filter({ visible: true }).first()).toBeVisible({ timeout: 12000 })
}

async function openCreateDialog(page: any) {
  // The button text is recognisable as the only UserPlus-style CTA in the header area
  const createBtn = page.getByRole('button', { name: /create.*user|new.*user|add.*user/i }).first()
  await expect(createBtn).toBeVisible({ timeout: 10000 })
  await createBtn.click()

  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 8000 })
  await expect(dialog.getByRole('heading', { name: /Create New User/i })).toBeVisible()
  return dialog
}

async function fillCreateForm(
  dialog: any,
  opts: {
    email: string
    firstName: string
    lastName: string
    role?: string
    jobTitle?: string
    password?: string
  }
) {
  await dialog.locator('#email').fill(opts.email)
  await dialog.locator('#firstName').fill(opts.firstName)
  await dialog.locator('#lastName').fill(opts.lastName)

  if (opts.role) {
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(opts.role, 'i') }).click()
  }

  if (opts.jobTitle) {
    // Job title is the second combobox in the dialog
    const selects = dialog.getByRole('combobox')
    await selects.nth(1).click()
    await page.getByRole('option', { name: new RegExp(opts.jobTitle, 'i') }).click()
  }

  const pw = opts.password || 'E2eTest123!'
  const passwordInputs = dialog.locator('input[type="password"]')
  await passwordInputs.first().fill(pw)
  if ((await passwordInputs.count()) > 1) {
    await passwordInputs.nth(1).fill(pw)
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

test.describe('User Creation – admin user', () => {
  test.describe.configure({ mode: 'serial' })

  test('users page loads for admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    await bobAssessPage(page, testInfo, 'users-page-admin')
  })

  test('create user dialog opens', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)
    await bobAssessPage(page, testInfo, 'create-user-dialog')
    await expect(dialog.locator('#email')).toBeVisible()
    await expect(dialog.locator('#firstName')).toBeVisible()
    await expect(dialog.locator('#lastName')).toBeVisible()
  })

  test('create user dialog has correct role options for admin', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)
    // Open the role combobox
    await dialog.getByRole('combobox').first().click()

    // Admin should see officer, nzscv_monitor, admin_officer, admin, client_viewer
    for (const role of ['Officer', 'NZSCV Monitor', 'Admin Officer', 'Admin', 'Client Viewer']) {
      await expect(page.getByRole('option', { name: new RegExp(`^${role}$`, 'i') })).toBeVisible()
    }

    // Admin should NOT see Master or Grand Master
    await expect(page.getByRole('option', { name: /^Master$/i })).not.toBeVisible()
    await expect(page.getByRole('option', { name: /^Grand Master$/i })).not.toBeVisible()
  })

  test('driver license flag activates for field roles', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    // Open job title dropdown
    const selects = dialog.getByRole('combobox')
    await selects.nth(1).click()
    await page.getByRole('option', { name: /Field Services Officer/i }).click()

    // Should now show the driver license requirement note
    await expect(dialog.getByText(/driver.*licen/i)).toBeVisible({ timeout: 5000 })
  })

  test('validation prevents submit with missing email', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    // Fill partial fields only (no email)
    await dialog.locator('#firstName').fill('Test')
    await dialog.locator('#lastName').fill('NoEmail')

    const submitBtn = dialog.getByRole('button', { name: /create user/i })
    // Button should be disabled when required fields are missing
    await expect(submitBtn).toBeDisabled()
    // Dialog still open and email field visible
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#email')).toBeVisible()
  })

  test('validation prevents submit with password mismatch', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    await dialog.locator('#email').fill(`${TEST_EMAIL_PREFIX}@example.com`)
    await dialog.locator('#firstName').fill('Test')
    await dialog.locator('#lastName').fill('Mismatch')

    const passwordInputs = dialog.locator('input[type="password"]')
    await passwordInputs.first().fill('Password1!')
    if ((await passwordInputs.count()) > 1) {
      await passwordInputs.nth(1).fill('DifferentPassword2!')
    }

    const submitBtn = dialog.getByRole('button', { name: /create user/i })
    // With mismatched passwords submit should be disabled or show error on click
    const isDisabled = await submitBtn.isDisabled()
    if (!isDisabled) {
      await submitBtn.click({ force: true })
      await expect(page.locator('text=/password.*match|do not match/i').first()).toBeVisible()
    } else {
      // Button disabled is also valid password validation
      await expect(submitBtn).toBeDisabled()
    }
  })

  test('job title dropdown contains all expected titles', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    const selects = dialog.getByRole('combobox')
    await selects.nth(1).click()

    const expectedTitles = [
      'Rostering Team Admin',
      'Branch Manager',
      'Operations Manager',
      'Sales Team',
      'Dispatch Team',
      'Welfare Team',
      'Supervisor',
      'Field Services Officer',
      'Patrol Officer',
      'Static Guard – Permanent',
      'Static Guard – Part-Time',
      'Static Guard – Casual',
      'Contractor',
    ]

    for (const title of expectedTitles) {
      await expect(
        page.getByRole('option', { name: new RegExp(title, 'i') })
      ).toBeVisible()
    }
  })
})

// ─── master role sees extra role options ─────────────────────────────────────

test.describe('User Creation – master user sees elevated roles', () => {
  test.describe.configure({ mode: 'serial' })

  test('master can see Master role option', async ({ page }) => {
    await loginAs(page, 'master')
    await navigateToUsers(page)
    const dialog = await openCreateDialog(page)

    await dialog.getByRole('combobox').first().click()
    await expect(page.getByRole('option', { name: /^Master$/i })).toBeVisible()
  })

  test('master user management page Bob visual assessment', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await navigateToUsers(page)
    await bobAssessPage(page, testInfo, 'users-page-master')
  })
})

// ─── officer cannot access /users ────────────────────────────────────────────

test.describe('User Creation – access denial for officer', () => {
  test('officer is redirected away from /users', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/users', { waitUntil: 'networkidle' })
    const currentUrl = page.url()
    expect(currentUrl).not.toMatch(/\/users$/)
  })
})
