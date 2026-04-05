import { describe, it, expect } from 'vitest'
import {
  calculateDistance,
  formatCoordinates,
  validateCoordinates,
  isInNewZealand,
  getNZRegion,
} from '../geocoding'

// ── calculateDistance (Haversine) ────────────────────────────────────────────

describe('calculateDistance', () => {
  it('returns 0 for the same point', () => {
    expect(calculateDistance(-41.2865, 174.7762, -41.2865, 174.7762)).toBe(0)
  })

  it('calculates known distance correctly', () => {
    const d = calculateDistance(-41.2865, 174.7762, -36.8485, 174.7633)
    expect(d).toBeGreaterThan(490_000)
    expect(d).toBeLessThan(497_000)
  })

  it('is symmetric', () => {
    const d1 = calculateDistance(-41, 174, -36, 174)
    const d2 = calculateDistance(-36, 174, -41, 174)
    expect(Math.abs(d1 - d2)).toBeLessThan(0.01)
  })
})

// ── formatCoordinates ───────────────────────────────────────────────────────

describe('formatCoordinates', () => {
  it('formats positive lat/lng with N and E', () => {
    const result = formatCoordinates(34.5, 170.1)
    expect(result).toContain('N')
    expect(result).toContain('E')
  })

  it('formats negative lat/lng with S and W', () => {
    const result = formatCoordinates(-41.2865, -174.7762)
    expect(result).toContain('S')
    expect(result).toContain('W')
  })

  it('uses specified precision', () => {
    const result = formatCoordinates(-41.123456789, 174.123456789, 3)
    expect(result).toContain('41.123')
    expect(result).toContain('174.123')
  })

  it('defaults to 6 decimal places', () => {
    const result = formatCoordinates(-41.1234567, 174.1234567)
    expect(result).toContain('41.123457')
    expect(result).toContain('174.123457')
  })

  it('formats coordinates at the equator/prime meridian', () => {
    const result = formatCoordinates(0, 0)
    expect(result).toContain('N')
    expect(result).toContain('E')
  })
})

// ── validateCoordinates ─────────────────────────────────────────────────────

describe('validateCoordinates', () => {
  it('returns valid for valid coordinates', () => {
    expect(validateCoordinates(-41.2865, 174.7762)).toEqual({ valid: true })
  })

  it('returns valid for boundary values', () => {
    expect(validateCoordinates(-90, -180)).toEqual({ valid: true })
    expect(validateCoordinates(90, 180)).toEqual({ valid: true })
    expect(validateCoordinates(0, 0)).toEqual({ valid: true })
  })

  it('returns invalid for latitude out of range', () => {
    const result = validateCoordinates(91, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Latitude')
  })

  it('returns invalid for latitude below -90', () => {
    const result = validateCoordinates(-91, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Latitude')
  })

  it('returns invalid for longitude out of range', () => {
    const result = validateCoordinates(0, 181)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Longitude')
  })

  it('returns invalid for longitude below -180', () => {
    const result = validateCoordinates(0, -181)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Longitude')
  })
})

// ── isInNewZealand ──────────────────────────────────────────────────────────

describe('isInNewZealand', () => {
  it('returns true for Wellington', () => {
    expect(isInNewZealand(-41.2865, 174.7762)).toBe(true)
  })

  it('returns true for Auckland', () => {
    expect(isInNewZealand(-36.8485, 174.7633)).toBe(true)
  })

  it('returns true for Christchurch', () => {
    expect(isInNewZealand(-43.5321, 172.6362)).toBe(true)
  })

  it('returns true for Invercargill (southern NZ)', () => {
    expect(isInNewZealand(-46.4132, 168.3538)).toBe(true)
  })

  it('returns false for Sydney, Australia', () => {
    expect(isInNewZealand(-33.8688, 151.2093)).toBe(false)
  })

  it('returns false for London', () => {
    expect(isInNewZealand(51.5074, -0.1278)).toBe(false)
  })

  it('returns false for points north of NZ', () => {
    expect(isInNewZealand(-33, 174)).toBe(false)
  })

  it('returns false for points south of NZ', () => {
    expect(isInNewZealand(-48, 174)).toBe(false)
  })
})

// ── getNZRegion ─────────────────────────────────────────────────────────────

describe('getNZRegion', () => {
  it('returns "North Island" for Auckland', () => {
    expect(getNZRegion(-36.8485, 174.7633)).toBe('North Island')
  })

  it('returns "North Island" for Wellington', () => {
    expect(getNZRegion(-41.2865, 174.7762)).toBe('North Island')
  })

  it('returns "South Island" for Christchurch', () => {
    expect(getNZRegion(-43.5321, 172.6362)).toBe('South Island')
  })

  it('returns "South Island" for Queenstown', () => {
    expect(getNZRegion(-45.0312, 168.6626)).toBe('South Island')
  })

  it('returns "Outside NZ" for coordinates outside NZ', () => {
    expect(getNZRegion(-33.8688, 151.2093)).toBe('Outside NZ')
  })
})
