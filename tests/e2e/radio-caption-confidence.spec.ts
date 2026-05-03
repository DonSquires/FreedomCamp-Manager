import { test, expect } from './setup'

const captionsEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VITE_RADIO_CAPTIONS_ENABLED || '').toLowerCase(),
)
const translationsEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VITE_RADIO_TRANSLATION_ENABLED || '').toLowerCase(),
)
const syntheticAudioEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VITE_RADIO_SYNTHETIC_AUDIO_ENABLED || '').toLowerCase(),
)

test.describe('radio caption confidence indicators', () => {
  test('shows low-confidence badges and header aggregate', async ({ officerUser: page }) => {
    test.skip(!captionsEnabled, 'Requires VITE_RADIO_CAPTIONS_ENABLED=true')

    await page.goto('/radio')
    await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('radio:inject-caption', {
        detail: {
          transmissionId: 'tx-confidence-test',
          sequenceNum: 1,
          segmentStartMs: 0,
          segmentEndMs: 900,
          text: 'Vehicle now moving toward dispatch lane',
          language: 'en',
          confidence: 0.92,
          isFinal: true,
        },
      }))

      window.dispatchEvent(new CustomEvent('radio:inject-caption', {
        detail: {
          transmissionId: 'tx-confidence-test',
          sequenceNum: 2,
          segmentStartMs: 900,
          segmentEndMs: 1800,
          text: 'Possible plate mismatch on second vehicle',
          language: 'en',
          confidence: 0.41,
          isFinal: true,
        },
      }))
    })

    await expect(page.getByText('Possible plate mismatch on second vehicle')).toBeVisible()
    await expect(page.getByText('Low confidence').first()).toBeVisible()
    await expect(page.getByText('1 low-confidence').first()).toBeVisible()
  })

  test('shows translation low-confidence indicators', async ({ officerUser: page }) => {
    test.skip(!captionsEnabled || !translationsEnabled, 'Requires caption+translation flags enabled')

    await page.goto('/radio')
    await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('radio:inject-translation', {
        detail: {
          transcriptSegmentId: 'segment-high-confidence',
          targetLanguage: 'en-NZ',
          text: 'All clear at dispatch boundary',
          confidence: 0.95,
          provider: 'test',
          isLowConfidence: false,
        },
      }))

      window.dispatchEvent(new CustomEvent('radio:inject-translation', {
        detail: {
          transcriptSegmentId: 'segment-low-confidence',
          targetLanguage: 'en-NZ',
          text: 'Possible mismatch in translated phrase',
          confidence: 0.42,
          provider: 'test',
          isLowConfidence: true,
        },
      }))
    })

    await expect(page.getByText(/Live Translation \(en-NZ\)/i)).toBeVisible()
    await expect(page.getByText('Possible mismatch in translated phrase')).toBeVisible()
    await expect(page.getByText('1 low-confidence').first()).toBeVisible()
  })

  test('shows synthetic translated-audio relay indicators', async ({ officerUser: page }) => {
    test.skip(
      !captionsEnabled || !translationsEnabled || !syntheticAudioEnabled,
      'Requires caption+translation+synthetic-audio flags enabled',
    )

    await page.goto('/radio')
    await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('radio:inject-tts-render', {
        detail: {
          translationSegmentId: 'segment-fast-render',
          targetLanguage: 'en-NZ',
          provider: 'piper',
          isSynthetic: true,
          renderLatencyMs: 820,
          durationMs: 1100,
          storagePath: null,
        },
      }))

      window.dispatchEvent(new CustomEvent('radio:inject-tts-render', {
        detail: {
          translationSegmentId: 'segment-slow-render',
          targetLanguage: 'en-NZ',
          provider: 'coqui-xtts',
          isSynthetic: true,
          renderLatencyMs: 2210,
          durationMs: 1900,
          storagePath: null,
        },
      }))
    })

    await expect(page.getByText(/Translated Audio Relay/i)).toBeVisible()
    await expect(page.getByText(/Synthetic/i).first()).toBeVisible()
    await expect(page.getByText(/coqui-xtts/i)).toBeVisible()
    await expect(page.getByText('1 delayed')).toBeVisible()
  })

  test('shows voice twin consent status indicators', async ({ officerUser: page }) => {
    test.skip(
      !captionsEnabled || !translationsEnabled || !syntheticAudioEnabled,
      'Requires caption+translation+synthetic-audio flags enabled',
    )

    await page.goto('/radio')
    await expect(page.getByRole('heading', { name: 'Radio' })).toBeVisible({ timeout: 20000 })

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('radio:inject-voice-consent-status', {
        detail: {
          consentId: 'consent-active-1',
          provider: 'coqui-xtts',
          purpose: 'voice_twin_training',
          retentionDays: 90,
          consentedAt: new Date().toISOString(),
          revokedAt: null,
          revocationReason: null,
          voiceProfileId: 'profile-1',
          profileProvider: 'coqui-xtts',
          profileModelRef: 'officer-voice-profile-v1',
          profileEnrolledAt: new Date().toISOString(),
          profileRevokedAt: null,
          profileActive: true,
        },
      }))
    })

    await expect(page.getByText(/Voice Twin Consent/i)).toBeVisible()
    await expect(page.getByText(/Consented/i).first()).toBeVisible()
    await expect(page.getByText(/Retention: 90 days/i)).toBeVisible()
    await expect(page.getByText(/officer-voice-profile-v1/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Revoke Consent/i })).toBeVisible()
  })
})
