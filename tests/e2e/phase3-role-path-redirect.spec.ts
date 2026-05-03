import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('phase3 role-path redirects', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin_officer requires portal selection when session choice is missing', async ({ page }) => {
    await loginAs(page, 'clientStaff')

    await page.evaluate(() => {
      window.sessionStorage.removeItem('adminOfficerPortalChoice')
    })

    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/portal-selection/)
  })

  test('officer redirected away from admin dashboard to officer home', async ({ page }) => {
    await loginAs(page, 'officerOrg1')

    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/officer-home/)
  })

  test('client viewer is constrained to client portal', async ({ page }) => {
    await loginAs(page, 'clientViewer')

    await page.goto('/reports', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/client-portal/)
  })

  test('grand master root route redirects to platform', async ({ page }) => {
    await loginAs(page, 'master')

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/platform/)
  })
})
