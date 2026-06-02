import { describe, expect, it } from 'vitest'

import { estimateBobRadioSignalDurationMs } from '@/lib/bobRtcAgent'

describe('estimateBobRadioSignalDurationMs', () => {
  it('returns a positive number for the default link-test profile', () => {
    const ms = estimateBobRadioSignalDurationMs({ profile: 'link-test' })
    expect(ms).toBeGreaterThan(0)
  })

  it('returns a positive number for the attention profile', () => {
    const ms = estimateBobRadioSignalDurationMs({ profile: 'attention' })
    expect(ms).toBeGreaterThan(0)
  })

  it('returns a positive number for the warble profile', () => {
    const ms = estimateBobRadioSignalDurationMs({ profile: 'warble' })
    expect(ms).toBeGreaterThan(0)
  })

  it('returns a positive number for the spoken profile', () => {
    const ms = estimateBobRadioSignalDurationMs({ profile: 'spoken' })
    expect(ms).toBeGreaterThan(0)
  })

  it('different profiles produce different durations for the same signalText', () => {
    const text = 'ALERT'
    const linkTest = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: text })
    const attention = estimateBobRadioSignalDurationMs({ profile: 'attention', signalText: text })
    const warble = estimateBobRadioSignalDurationMs({ profile: 'warble', signalText: text })

    // All positive and not all the same
    expect(linkTest).toBeGreaterThan(0)
    expect(attention).toBeGreaterThan(0)
    expect(warble).toBeGreaterThan(0)

    // At least two differ (warble initial tones are longest)
    expect(new Set([linkTest, attention, warble]).size).toBeGreaterThan(1)
  })

  it('longer signalText produces strictly greater duration', () => {
    const short = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: 'A' })
    const long = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: 'AAAAAAAAAA' })
    expect(long).toBeGreaterThan(short)
  })

  it('returns consistent results on repeated calls (pure function)', () => {
    const opts = { profile: 'attention' as const, signalText: 'BOB CHECK' }
    expect(estimateBobRadioSignalDurationMs(opts)).toBe(estimateBobRadioSignalDurationMs(opts))
  })

  it('uses a reasonable lower bound — more than 200 ms for a minimal signal', () => {
    // Even the most minimal signal has header tones + a final tail tone
    const ms = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: 'A' })
    expect(ms).toBeGreaterThan(200)
  })

  it('truncates signalText to 24 characters so very long text has the same cost as 24-char text', () => {
    const exactly24 = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: 'ABCDEFGHIJKLMNOPQRSTUVWX' })
    const tooLong = estimateBobRadioSignalDurationMs({ profile: 'link-test', signalText: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_EXTRA_IGNORED' })
    expect(exactly24).toBe(tooLong)
  })
})
