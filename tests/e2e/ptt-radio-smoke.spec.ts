import { test, expect } from './setup'

async function assertRadioLoads(page: any) {
  await page.goto('/radio')

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page).toHaveURL(/\/radio/)

  // Stable radio UI markers on PTTRadio page.
  await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Emergency — All Channels')).toBeVisible({ timeout: 20000 })
}

test.describe('PTT radio route smoke', () => {
  test('officer can open /radio', async ({ officerUser }) => {
    await assertRadioLoads(officerUser)
  })

  test('admin can open /radio', async ({ adminUser }) => {
    await assertRadioLoads(adminUser)
  })

  test('master can open /radio', async ({ masterUser }) => {
    await assertRadioLoads(masterUser)
  })
})
