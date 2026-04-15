import { describe, it, expect } from 'vitest'
import {
  mergeScvResults,
  EMPTY_SCV_RESULT,
  SCV_BATCH_SIZE,
  type ScvSyncResult,
} from '../scvUtils'

// ── SCV_BATCH_SIZE ──────────────────────────────────────────────────────────

describe('SCV_BATCH_SIZE', () => {
  it('is 50', () => {
    expect(SCV_BATCH_SIZE).toBe(50)
  })
})

// ── EMPTY_SCV_RESULT ────────────────────────────────────────────────────────

describe('EMPTY_SCV_RESULT', () => {
  it('has all numeric fields initialised to 0', () => {
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

// ── mergeScvResults ─────────────────────────────────────────────────────────

describe('mergeScvResults', () => {
  const base: ScvSyncResult = {
    total_in_scv_list: 100,
    canonical_vehicles_checked: 50,
    set_to_current: 10,
    set_to_not_current: 5,
    expiry_corrected: 3,
    unchanged: 32,
    observations_updated: 7,
    breach_alerts_resolved: 2,
    canonical_scv_enriched: 1,
    errors: ['error-1'],
  }

  const incoming: ScvSyncResult = {
    total_in_scv_list: 120,
    canonical_vehicles_checked: 30,
    set_to_current: 8,
    set_to_not_current: 4,
    expiry_corrected: 1,
    unchanged: 17,
    observations_updated: 5,
    breach_alerts_resolved: 0,
    canonical_scv_enriched: 2,
    errors: ['error-2', 'error-3'],
  }

  it('uses the incoming total_in_scv_list when non-zero', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.total_in_scv_list).toBe(120)
  })

  it('falls back to base total_in_scv_list when incoming is 0', () => {
    const result = mergeScvResults(base, { ...incoming, total_in_scv_list: 0 })
    expect(result.total_in_scv_list).toBe(100)
  })

  it('sums canonical_vehicles_checked', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.canonical_vehicles_checked).toBe(80) // 50 + 30
  })

  it('sums set_to_current', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.set_to_current).toBe(18) // 10 + 8
  })

  it('sums set_to_not_current', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.set_to_not_current).toBe(9) // 5 + 4
  })

  it('sums expiry_corrected', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.expiry_corrected).toBe(4) // 3 + 1
  })

  it('sums unchanged', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.unchanged).toBe(49) // 32 + 17
  })

  it('sums observations_updated', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.observations_updated).toBe(12) // 7 + 5
  })

  it('sums breach_alerts_resolved', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.breach_alerts_resolved).toBe(2) // 2 + 0
  })

  it('sums canonical_scv_enriched', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.canonical_scv_enriched).toBe(3) // 1 + 2
  })

  it('concatenates errors arrays', () => {
    const result = mergeScvResults(base, incoming)
    expect(result.errors).toEqual(['error-1', 'error-2', 'error-3'])
  })

  it('merging with EMPTY_SCV_RESULT leaves values unchanged', () => {
    const result = mergeScvResults(EMPTY_SCV_RESULT, incoming)
    expect(result.canonical_vehicles_checked).toBe(incoming.canonical_vehicles_checked)
    expect(result.set_to_current).toBe(incoming.set_to_current)
    expect(result.errors).toEqual(incoming.errors)
  })

  it('merging two EMPTY_SCV_RESULTs produces another empty result', () => {
    const result = mergeScvResults(EMPTY_SCV_RESULT, EMPTY_SCV_RESULT)
    expect(result.canonical_vehicles_checked).toBe(0)
    expect(result.total_in_scv_list).toBe(0)
    expect(result.errors).toEqual([])
  })
})
