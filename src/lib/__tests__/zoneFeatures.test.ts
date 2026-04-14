import { describe, it, expect } from 'vitest'
import {
  ZONE_FEATURE_KEYS,
  ZONE_FEATURES,
  isFeatureAllowed,
  type ZoneFeatureKey,
} from '../zoneFeatures'

// ── ZONE_FEATURE_KEYS ───────────────────────────────────────────────────────

describe('ZONE_FEATURE_KEYS', () => {
  it('contains all expected keys', () => {
    expect(ZONE_FEATURE_KEYS).toContain('freedom_camping')
    expect(ZONE_FEATURE_KEYS).toContain('guarding')
    expect(ZONE_FEATURE_KEYS).toContain('parking')
    expect(ZONE_FEATURE_KEYS).toContain('noise')
    expect(ZONE_FEATURE_KEYS).toContain('ems')
    expect(ZONE_FEATURE_KEYS).toContain('access_control')
  })

  it('has 6 feature keys', () => {
    expect(ZONE_FEATURE_KEYS).toHaveLength(6)
  })
})

// ── ZONE_FEATURES ───────────────────────────────────────────────────────────

describe('ZONE_FEATURES', () => {
  it('has one entry per feature key', () => {
    expect(ZONE_FEATURES).toHaveLength(ZONE_FEATURE_KEYS.length)
  })

  it('every entry has a key, label and description', () => {
    ZONE_FEATURES.forEach((feature) => {
      expect(feature.key).toBeTruthy()
      expect(feature.label).toBeTruthy()
      expect(feature.description).toBeTruthy()
    })
  })

  it('keys match ZONE_FEATURE_KEYS exactly', () => {
    const keys = ZONE_FEATURES.map((f) => f.key)
    ZONE_FEATURE_KEYS.forEach((k) => expect(keys).toContain(k))
  })

  it('freedom_camping feature has expected label', () => {
    const fc = ZONE_FEATURES.find((f) => f.key === 'freedom_camping')
    expect(fc?.label).toBe('Freedom Camping Patrol')
  })

  it('guarding feature has expected label', () => {
    const g = ZONE_FEATURES.find((f) => f.key === 'guarding')
    expect(g?.label).toBe('Site Guarding')
  })
})

// ── isFeatureAllowed ────────────────────────────────────────────────────────

describe('isFeatureAllowed', () => {
  it('returns true for any feature when allowed list is empty (unconfigured zone)', () => {
    const features: ZoneFeatureKey[] = [
      'freedom_camping', 'guarding', 'parking', 'noise', 'ems', 'access_control',
    ]
    features.forEach((feature) => {
      expect(isFeatureAllowed(feature, [])).toBe(true)
    })
  })

  it('returns true when the feature is in the allowed list', () => {
    expect(isFeatureAllowed('freedom_camping', ['freedom_camping', 'guarding'])).toBe(true)
  })

  it('returns true when the feature is the only item in the allowed list', () => {
    expect(isFeatureAllowed('parking', ['parking'])).toBe(true)
  })

  it('returns false when the feature is NOT in a non-empty allowed list', () => {
    expect(isFeatureAllowed('noise', ['freedom_camping', 'guarding'])).toBe(false)
  })

  it('returns false when allowed list contains other features but not the requested one', () => {
    expect(isFeatureAllowed('ems', ['access_control'])).toBe(false)
  })

  it('is not case-sensitive about list membership — exact string match', () => {
    // The allowed list is strings; 'FREEDOM_CAMPING' is not the same as 'freedom_camping'
    expect(isFeatureAllowed('freedom_camping', ['FREEDOM_CAMPING'])).toBe(false)
  })
})
