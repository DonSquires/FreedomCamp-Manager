import { describe, it, expect } from 'vitest'
import {
  normalizeHomelessStatus,
  isHomelessForUi,
  homelessStatusLabel,
  HOMELESS_UI_STATUSES,
} from '../homelessStatus'

// ── normalizeHomelessStatus ─────────────────────────────────────────────────

describe('normalizeHomelessStatus', () => {
  it('returns "confirmed" for "confirmed"', () => {
    expect(normalizeHomelessStatus('confirmed')).toBe('confirmed')
  })

  it('returns "claimed" for "claimed"', () => {
    expect(normalizeHomelessStatus('claimed')).toBe('claimed')
  })

  it('returns "suspected" for "suspected"', () => {
    expect(normalizeHomelessStatus('suspected')).toBe('suspected')
  })

  it('normalizes "likely" to "suspected"', () => {
    expect(normalizeHomelessStatus('likely')).toBe('suspected')
  })

  it('returns "declined" for "declined"', () => {
    expect(normalizeHomelessStatus('declined')).toBe('declined')
  })

  it('normalizes "not_homeless" to "freedom_camper"', () => {
    expect(normalizeHomelessStatus('not_homeless')).toBe('freedom_camper')
  })

  it('normalizes "none" to "freedom_camper"', () => {
    expect(normalizeHomelessStatus('none')).toBe('freedom_camper')
  })

  it('normalizes "not homeless" to "freedom_camper"', () => {
    expect(normalizeHomelessStatus('not homeless')).toBe('freedom_camper')
  })

  it('defaults to "freedom_camper" for null', () => {
    expect(normalizeHomelessStatus(null)).toBe('freedom_camper')
  })

  it('defaults to "freedom_camper" for undefined', () => {
    expect(normalizeHomelessStatus(undefined)).toBe('freedom_camper')
  })

  it('defaults to "freedom_camper" for empty string', () => {
    expect(normalizeHomelessStatus('')).toBe('freedom_camper')
  })

  it('defaults to "freedom_camper" for unknown values', () => {
    expect(normalizeHomelessStatus('something_else')).toBe('freedom_camper')
  })

  it('is case-insensitive', () => {
    expect(normalizeHomelessStatus('CONFIRMED')).toBe('confirmed')
    expect(normalizeHomelessStatus('Claimed')).toBe('claimed')
    expect(normalizeHomelessStatus('LIKELY')).toBe('suspected')
  })

  it('trims whitespace', () => {
    expect(normalizeHomelessStatus('  confirmed  ')).toBe('confirmed')
  })
})

// ── isHomelessForUi ─────────────────────────────────────────────────────────

describe('isHomelessForUi', () => {
  it('returns true for homeless statuses', () => {
    expect(isHomelessForUi('confirmed')).toBe(true)
    expect(isHomelessForUi('claimed')).toBe(true)
    expect(isHomelessForUi('suspected')).toBe(true)
    expect(isHomelessForUi('declined')).toBe(true)
  })

  it('returns true for "likely" (normalizes to "suspected")', () => {
    expect(isHomelessForUi('likely')).toBe(true)
  })

  it('returns false for freedom_camper statuses', () => {
    expect(isHomelessForUi('not_homeless')).toBe(false)
    expect(isHomelessForUi('none')).toBe(false)
    expect(isHomelessForUi(null)).toBe(false)
    expect(isHomelessForUi(undefined)).toBe(false)
    expect(isHomelessForUi('')).toBe(false)
  })
})

// ── homelessStatusLabel ─────────────────────────────────────────────────────

describe('homelessStatusLabel', () => {
  it('returns correct label for "confirmed"', () => {
    expect(homelessStatusLabel('confirmed')).toBe('Confirmed - FC Act exempt')
  })

  it('returns correct label for "claimed"', () => {
    expect(homelessStatusLabel('claimed')).toBe('Claimed - pending review')
  })

  it('returns correct label for "suspected"', () => {
    expect(homelessStatusLabel('suspected')).toBe('Suspected - pending review')
  })

  it('returns correct label for "likely" (normalizes to "suspected")', () => {
    expect(homelessStatusLabel('likely')).toBe('Suspected - pending review')
  })

  it('returns correct label for "declined"', () => {
    expect(homelessStatusLabel('declined')).toBe('Declined - not exempt')
  })

  it('returns freedom camper label for null', () => {
    expect(homelessStatusLabel(null)).toBe('Freedom camper - not exempt')
  })

  it('returns freedom camper label for unknown values', () => {
    expect(homelessStatusLabel('unknown')).toBe('Freedom camper - not exempt')
  })
})

// ── HOMELESS_UI_STATUSES ────────────────────────────────────────────────────

describe('HOMELESS_UI_STATUSES', () => {
  it('contains exactly 4 statuses', () => {
    expect(HOMELESS_UI_STATUSES).toHaveLength(4)
  })

  it('contains the expected values', () => {
    expect(HOMELESS_UI_STATUSES).toContain('confirmed')
    expect(HOMELESS_UI_STATUSES).toContain('claimed')
    expect(HOMELESS_UI_STATUSES).toContain('suspected')
    expect(HOMELESS_UI_STATUSES).toContain('declined')
  })

  it('does not contain freedom_camper', () => {
    expect(HOMELESS_UI_STATUSES).not.toContain('freedom_camper')
  })
})
