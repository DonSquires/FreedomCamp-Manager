import { describe, it, expect } from 'vitest'
import {
  EMPTY_SCV_RESULT,
  SCV_BATCH_SIZE,
  mergeScvResults,
  type ScvSyncResult,
} from '../scvUtils'

// ── constants ────────────────────────────────────────────────────────────────

describe('SCV_BATCH_SIZE', () => {
  it('is 50', () => {
    expect(SCV_BATCH_SIZE).toBe(50)
  })
})

describe('EMPTY_SCV_RESULT', () => {
  it('has all numeric fields set to 0', () => {
    expect(EMPTY_SCV_RESULT.total_in_scv_list).toBe(0)
    expect(EMPTY_SCV_RESULT.canonical_vehicles_checked).toBe(0)
    expect(EMPTY_SCV_RESULT.set_to_current).toBe(0)
    expect(EMPTY_SCV_RESULT.set_to_not_current).toBe(0)
    expect(EMPTY_SCV_RESULT.expiry_corrected).toBe(0)
    expect(EMPTY_SCV_RESULT.unchanged).toBe(0)
    expect(EMPTY_SCV_RESULT.observations_updated).toBe(0)
    expect(EMPTY_SCV_RESULT.breach_alerts_resolved).toBe(0)
    expect(EMPTY_SCV_RESULT.canonical_scv_enriched).toBe(0)
  })

  it('has an empty errors array', () => {
    expect(EMPTY_SCV_RESULT.errors).toEqual([])
  })
})

// ── mergeScvResults ──────────────────────────────────────────────────────────

describe('mergeScvResults', () => {
  const base: ScvSyncResult = {
    total_in_scv_list: 100,
    canonical_vehicles_checked: 10,
    set_to_current: 3,
    set_to_not_current: 2,
    expiry_corrected: 1,
    unchanged: 4,
    observations_updated: 5,
    breach_alerts_resolved: 0,
    canonical_scv_enriched: 2,
    errors: ['error-a'],
  }

  it('accumulates additive counters from both results', () => {
    const incoming: ScvSyncResult = {
      total_in_scv_list: 200,
      canonical_vehicles_checked: 20,
      set_to_current: 7,
      set_to_not_current: 3,
      expiry_corrected: 2,
      unchanged: 8,
      observations_updated: 6,
      breach_alerts_resolved: 1,
      canonical_scv_enriched: 4,
      errors: ['error-b'],
    }

    const merged = mergeScvResults(base, incoming)

    expect(merged.canonical_vehicles_checked).toBe(30) // 10 + 20
    expect(merged.set_to_current).toBe(10) // 3 + 7
    expect(merged.set_to_not_current).toBe(5) // 2 + 3
    expect(merged.expiry_corrected).toBe(3) // 1 + 2
    expect(merged.unchanged).toBe(12) // 4 + 8
    expect(merged.observations_updated).toBe(11) // 5 + 6
    expect(merged.breach_alerts_resolved).toBe(1) // 0 + 1
    expect(merged.canonical_scv_enriched).toBe(6) // 2 + 4
  })

  it('uses incoming total_in_scv_list when it is non-zero', () => {
    const incoming: ScvSyncResult = { ...EMPTY_SCV_RESULT, total_in_scv_list: 500 }
    const merged = mergeScvResults(base, incoming)
    expect(merged.total_in_scv_list).toBe(500)
  })

  it('falls back to current total_in_scv_list when incoming value is 0', () => {
    const incoming: ScvSyncResult = { ...EMPTY_SCV_RESULT, total_in_scv_list: 0 }
    const merged = mergeScvResults(base, incoming)
    // incoming is 0 (falsy) → falls back to current (100)
    expect(merged.total_in_scv_list).toBe(100)
  })

  it('concatenates errors from both results', () => {
    const incoming: ScvSyncResult = { ...EMPTY_SCV_RESULT, errors: ['error-b', 'error-c'] }
    const merged = mergeScvResults(base, incoming)
    expect(merged.errors).toEqual(['error-a', 'error-b', 'error-c'])
  })

  it('merging with EMPTY_SCV_RESULT is an identity-like operation for additive fields', () => {
    const merged = mergeScvResults(base, EMPTY_SCV_RESULT)
    expect(merged.canonical_vehicles_checked).toBe(base.canonical_vehicles_checked)
    expect(merged.set_to_current).toBe(base.set_to_current)
    expect(merged.unchanged).toBe(base.unchanged)
    expect(merged.errors).toEqual(base.errors)
  })

  it('does not mutate the input objects', () => {
    const current: ScvSyncResult = { ...EMPTY_SCV_RESULT, set_to_current: 1, errors: ['x'] }
    const incoming: ScvSyncResult = { ...EMPTY_SCV_RESULT, set_to_current: 2, errors: ['y'] }
    mergeScvResults(current, incoming)
    expect(current.set_to_current).toBe(1)
    expect(incoming.set_to_current).toBe(2)
    expect(current.errors).toEqual(['x'])
    expect(incoming.errors).toEqual(['y'])
  })
})
