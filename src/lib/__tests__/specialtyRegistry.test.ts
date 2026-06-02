import { describe, expect, it } from 'vitest'
import { buildSpecialtyPortalLink, getSpecialtyPortalPath } from '@/lib/officerPortalRouting'
import { resolveCanonicalSpecialty } from '@/lib/specialtyRegistry'

describe('specialty registry compatibility', () => {
  it('normalizes legacy specialty labels', () => {
    expect(resolveCanonicalSpecialty('parking warden')).toBe('parking')
    expect(resolveCanonicalSpecialty('noise-control')).toBe('noise')
    expect(resolveCanonicalSpecialty('smoke complaint ooh')).toBe('smoke')
  })

  it('builds dispatch links with consistent query params', () => {
    expect(buildSpecialtyPortalLink({ specialtyType: 'parking_warden' }, { dispatch: 'abc' })).toBe('/parking-officer?dispatch=abc')
    expect(buildSpecialtyPortalLink({ specialtyType: 'freedom_camping' }, { dispatch: 'abc' })).toBe('/field-officer?service=freedom_camping&dispatch=abc')
  })

  it('resolves canonical path for legacy values', () => {
    expect(getSpecialtyPortalPath('parking warden')).toBe('/parking-officer')
  })
})
