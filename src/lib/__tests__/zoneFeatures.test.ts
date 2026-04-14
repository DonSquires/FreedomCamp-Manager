import { describe, it, expect } from 'vitest'
import {
  ZONE_FEATURE_KEYS,
  ZONE_FEATURES,
  isFeatureAllowed,
  type ZoneFeatureKey,
} from '../zoneFeatures'

// ── ZONE_FEATURE_KEYS ────────────────────────────────────────────────────────

describe('ZONE_FEATURE_KEYS', () => {
  it('contains exactly 6 feature keys', () => {
    expect(ZONE_FEATURE_KEYS).toHaveLength(6)
  })

  it('contains all expected feature keys', () => {
    expect(ZONE_FEATURE_KEYS).toContain('freedom_camping')
    expect(ZONE_FEATURE_KEYS).toContain('guarding')
    expect(ZONE_FEATURE_KEYS).toContain('parking')
    expect(ZONE_FEATURE_KEYS).toContain('noise')
    expect(ZONE_FEATURE_KEYS).toContain('ems')
    expect(ZONE_FEATURE_KEYS).toContain('access_control')
  })
})

// ── ZONE_FEATURES ────────────────────────────────────────────────────────────

describe('ZONE_FEATURES', () => {
  it('has one entry per feature key', () => {
    expect(ZONE_FEATURES).toHaveLength(ZONE_FEATURE_KEYS.length)
  })

  it('each entry has key, label, and description', () => {
    for (const feature of ZONE_FEATURES) {
      expect(feature).toHaveProperty('key')
      expect(feature).toHaveProperty('label')
      expect(feature).toHaveProperty('description')
      expect(typeof feature.key).toBe('string')
      expect(typeof feature.label).toBe('string')
      expect(typeof feature.description).toBe('string')
      expect(feature.label.length).toBeGreaterThan(0)
      expect(feature.description.length).toBeGreaterThan(0)
    }
  })

  it('keys in ZONE_FEATURES match ZONE_FEATURE_KEYS', () => {
    const featuresKeys = ZONE_FEATURES.map((f) => f.key)
    expect(featuresKeys).toEqual([...ZONE_FEATURE_KEYS])
  })

  it('has correct label for freedom_camping', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'freedom_camping')
    expect(feat?.label).toBe('Freedom Camping Patrol')
  })

  it('has correct label for guarding', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'guarding')
    expect(feat?.label).toBe('Site Guarding')
  })

  it('has correct label for parking', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'parking')
    expect(feat?.label).toBe('Parking Enforcement')
  })

  it('has correct label for noise', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'noise')
    expect(feat?.label).toBe('Noise Control')
  })

  it('has correct label for ems', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'ems')
    expect(feat?.label).toBe('Electronic Monitoring Services')
  })

  it('has correct label for access_control', () => {
    const feat = ZONE_FEATURES.find((f) => f.key === 'access_control')
    expect(feat?.label).toBe('Access Control')
  })
})

// ── isFeatureAllowed ─────────────────────────────────────────────────────────

describe('isFeatureAllowed', () => {
  it('returns true for any feature when allowed list is empty (legacy zone)', () => {
    const empty: string[] = []
    expect(isFeatureAllowed('freedom_camping', empty)).toBe(true)
    expect(isFeatureAllowed('guarding', empty)).toBe(true)
    expect(isFeatureAllowed('parking', empty)).toBe(true)
    expect(isFeatureAllowed('noise', empty)).toBe(true)
    expect(isFeatureAllowed('ems', empty)).toBe(true)
    expect(isFeatureAllowed('access_control', empty)).toBe(true)
  })

  it('returns true when feature is in the allowed list', () => {
    expect(isFeatureAllowed('freedom_camping', ['freedom_camping', 'guarding'])).toBe(true)
    expect(isFeatureAllowed('guarding', ['freedom_camping', 'guarding'])).toBe(true)
  })

  it('returns false when feature is not in the non-empty allowed list', () => {
    expect(isFeatureAllowed('parking', ['freedom_camping', 'guarding'])).toBe(false)
    expect(isFeatureAllowed('noise', ['freedom_camping'])).toBe(false)
    expect(isFeatureAllowed('ems', ['access_control'])).toBe(false)
  })

  it('returns true when list contains only that single feature', () => {
    expect(isFeatureAllowed('noise', ['noise'])).toBe(true)
  })

  it('returns false when list contains other features but not the requested one', () => {
    expect(isFeatureAllowed('ems', ['noise', 'parking', 'guarding'])).toBe(false)
  })

  it('is case-sensitive', () => {
    // Feature keys are lowercase; upper-case won't match
    expect(isFeatureAllowed('noise', ['NOISE' as ZoneFeatureKey])).toBe(false)
  })
})
