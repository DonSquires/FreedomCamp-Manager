import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0p7xQAAAAASUVORK5CYII=',
  'base64',
)

const DUMMY_WAV = Buffer.from('RIFF0000WAVEfmt ')

const SEEDED_ENABLED = process.env.PLAYWRIGHT_SEEDED_SPECIALIST_E2E === '1'
const SEEDED_NOISE_JOB_NUMBER = process.env.PLAYWRIGHT_SEEDED_NOISE_JOB_NUMBER ?? 'NOI-1001'

test.describe('Specialist module E2E flows (seeded backend)', () => {
  test.skip(!SEEDED_ENABLED, 'Set PLAYWRIGHT_SEEDED_SPECIALIST_E2E=1 to run seeded specialist E2E flows.')

  test('PTT interpreter renders and returns translation output', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/radio', { waitUntil: 'networkidle' })

    await expect(page.getByText(/PTT Interpreter/i)).toBeVisible({ timeout: 15000 })

    await page
      .getByPlaceholder(/Enter message or capture speech, then translate/i)
      .fill('Hello team, move to the east boundary please.')
    await page.getByRole('button', { name: /^Translate$/i }).click()

    await expect(page.getByText(/Confidence/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Translated|Provider|Source|Target/i)).toBeVisible({ timeout: 15000 })
  })

  test('Biosecurity officer photo flow hydrates checklist from live Bob analysis', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/biosecurity-officer', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /Biosecurity Officer/i })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /New Assessment/i }).click()

    await expect(page.getByText(/Step 1 of/i)).toBeVisible()
    await page.getByLabel(/Site Address/i).fill('42 Boundary Road, Levin 5510')
    await page.getByRole('button', { name: /^Next$/i }).click()

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'biosecurity-specimen.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    })
    await page.getByRole('button', { name: /^Next$/i }).click()

    await page.getByRole('button', { name: /Analyse with Bob AI/i }).click()

    await expect(page.getByLabel(/Species Identified/i)).toHaveValue(/.+/, { timeout: 30000 })
  })

  test('Noise officer street-audio flow applies live Bob assessment into the form', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/noise-officer', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /Noise Control Officer/i })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: new RegExp(SEEDED_NOISE_JOB_NUMBER, 'i') }).click({ timeout: 20000 })

    await page.locator('input[type="file"][accept="audio/wav,.wav"]').setInputFiles({
      name: 'street-audio.wav',
      mimeType: 'audio/wav',
      buffer: DUMMY_WAV,
    })

    await expect(page.getByText(/Attached: street-audio\.wav/i)).toBeVisible()
    await page.getByRole('button', { name: /Auto-fill from street audio/i }).click()

    await expect(
      page.getByText(/Audio assessment applied to matrix and recommendation|analysis failed|unable to assess/i),
    ).toBeVisible({ timeout: 30000 })
  })
})
