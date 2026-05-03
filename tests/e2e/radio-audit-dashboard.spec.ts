/**
 * E2E: RadioAuditDashboard — Ticket Group E
 *
 * Verifies:
 * - Admin can navigate to /radio/audit and see summary stat cards
 * - Consent Records tab renders the table
 * - Render Audit Log tab renders the table
 * - Non-admin (officer) is blocked by role guard
 */

import { test, expect } from './setup'

const syntheticAudioEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VITE_RADIO_SYNTHETIC_AUDIO_ENABLED || '').toLowerCase(),
)

test.describe('RadioAuditDashboard', () => {
  test('admin can view audit dashboard stat cards', async ({ adminUser: page }) => {
    test.skip(!syntheticAudioEnabled, 'Requires VITE_RADIO_SYNTHETIC_AUDIO_ENABLED=true')

    await page.goto('/radio/audit')
    await expect(page.getByRole('heading', { name: /Radio Audit Dashboard/i })).toBeVisible({ timeout: 20000 })

    await expect(page.getByTestId('stat-active-consents')).toBeVisible()
    await expect(page.getByTestId('stat-revoked-consents')).toBeVisible()
    await expect(page.getByTestId('stat-synthetic-renders')).toBeVisible()
    await expect(page.getByTestId('stat-voice-twin-renders')).toBeVisible()
  })

  test('consent records tab is visible and accessible', async ({ adminUser: page }) => {
    test.skip(!syntheticAudioEnabled, 'Requires VITE_RADIO_SYNTHETIC_AUDIO_ENABLED=true')

    await page.goto('/radio/audit')
    await expect(page.getByRole('heading', { name: /Radio Audit Dashboard/i })).toBeVisible({ timeout: 20000 })

    // Default tab is "Consent Records"
    await expect(page.getByRole('tab', { name: /Consent Records/i })).toBeVisible()
    await page.getByRole('tab', { name: /Consent Records/i }).click()
    // Table header or empty message should be visible
    const tableOrEmpty = page.locator('[data-testid="consent-audit-table"], :text("No consent records found")')
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10000 })
  })

  test('render audit log tab is visible and accessible', async ({ adminUser: page }) => {
    test.skip(!syntheticAudioEnabled, 'Requires VITE_RADIO_SYNTHETIC_AUDIO_ENABLED=true')

    await page.goto('/radio/audit')
    await expect(page.getByRole('heading', { name: /Radio Audit Dashboard/i })).toBeVisible({ timeout: 20000 })

    await page.getByRole('tab', { name: /Render Audit Log/i }).click()
    const tableOrEmpty = page.locator('[data-testid="render-audit-table"], :text("No synthetic render records found")')
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10000 })
  })

  test('officer role is blocked from audit dashboard', async ({ officerUser: page }) => {
    test.skip(!syntheticAudioEnabled, 'Requires VITE_RADIO_SYNTHETIC_AUDIO_ENABLED=true')

    await page.goto('/radio/audit')
    // RoleRoute redirects or renders an access-denied message; either way the audit page heading should NOT appear
    await expect(page.getByRole('heading', { name: /Radio Audit Dashboard/i })).not.toBeVisible({ timeout: 10000 })
  })
})
