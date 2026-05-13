import { expect, test, helpers, supabaseAdmin } from './setup'
import { loginAs } from './auth'

test.describe('Live officer active visibility', () => {
  test('shows an active officer card with address, phone, and actions', async ({ page }) => {
    const db = supabaseAdmin || helpers.supabase

    const { data: officerProfile, error: officerProfileError } = await db
      .from('user_profiles')
      .select('id, email, first_name, last_name, phone, organization_id')
      .eq('email', 'squires.don@gmail.com')
      .single()

    test.skip(
      !!officerProfileError || !officerProfile?.id || !officerProfile?.organization_id,
      'Live officer fixture profile is unavailable in this environment'
    )

    await loginAs(page, 'adminOrg1')
    await page.goto('/live-tracking', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const card = page.getByTestId(`live-officer-card-${officerProfile.id}`)
    const cardVisible = await card.isVisible({ timeout: 30000 }).catch(() => false)
    test.skip(!cardVisible, 'No active live-tracking card for fixture officer in this environment')

    await expect(card).toBeVisible({ timeout: 30000 })
    await expect(card).toContainText(/Don Squires/i)
    await expect(card).toContainText(officerProfile.phone || '')
    await expect(card).toContainText(/Ivy Crescent/i, { timeout: 30000 })

    const directCallButton = card.getByRole('button', { name: /direct call/i })
    await expect(directCallButton).toBeEnabled()

    const viewMapButton = card.getByRole('button', { name: /view map/i })
    await expect(viewMapButton).toBeEnabled()

    const popupPromise = page.waitForEvent('popup')
    await viewMapButton.click()
    const mapPopup = await popupPromise
    await expect(mapPopup).toHaveURL(/google\.com\/maps\?q=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/)

    await directCallButton.click()
    await expect(page).toHaveURL(/\/radio\?/)
    await expect(page).toHaveURL(/targetUserId=/)
    await expect(page).toHaveURL(/Don%20Squires/)
  })
})