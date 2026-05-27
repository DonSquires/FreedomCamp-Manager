import { expect, test } from '@playwright/test'
import { loginAs } from './auth'
import { supabaseAdmin } from './setup'

const hasAdminCreds = !!(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL)

test.describe('phase4 operations map emergency escalation', () => {
  test('shows emergency GPS broadcast banner when SOS alert is present', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Admin credentials not configured')
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

    const adminEmail = String(
      process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL ||
      process.env.PLAYWRIGHT_ADMIN_EMAIL ||
      process.env.E2E_ADMIN_EMAIL ||
      ''
    ).trim().toLowerCase()

    test.skip(!adminEmail, 'Admin Org 1 email is required')

    const { data: profile, error: profileError } = await (supabaseAdmin as any)
      .from('user_profiles')
      .select('id, organization_id')
      .ilike('email', adminEmail)
      .limit(1)
      .maybeSingle()

    test.skip(!profile || !!profileError, 'Could not resolve adminOrg1 profile for seeded emergency alert')

    const seedOfficerName = `Phase Four Officer ${Date.now()}`
    const seedLat = -41.27123
    const seedLng = 173.28456

    const { data: seededAlert, error: seededError } = await (supabaseAdmin as any)
      .from('officer_welfare_alerts')
      .insert({
        officer_id: profile.id,
        organization_id: profile.organization_id,
        officer_name: seedOfficerName,
        officer_phone: '0200000000',
        alert_type: 'armed_danger',
        status: 'pending',
        gps_latitude: seedLat,
        gps_longitude: seedLng,
        last_activity_at: new Date().toISOString(),
        alert_sent_at: new Date().toISOString(),
        escalation_level: 2,
      })
      .select('id')
      .single()

    test.skip(!seededAlert || !!seededError, 'Failed to seed emergency welfare alert')

    try {
      await loginAs(page, 'adminOrg1')
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      await page.goto('/operations-map', { waitUntil: 'domcontentloaded' })

      const banner = page.getByText(/Emergency channel broadcast active:/i)
      await expect(banner).toBeVisible({ timeout: 25000 })
      await expect(banner).toContainText(seedOfficerName)
      await expect(banner).toContainText('(-41.27123, 173.28456)')
    } finally {
      await (supabaseAdmin as any)
        .from('officer_welfare_alerts')
        .delete()
        .eq('id', seededAlert.id)
    }
  })
})
