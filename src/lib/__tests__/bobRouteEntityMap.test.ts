import { describe, expect, it } from 'vitest'

import {
  BOB_ROUTE_ENTITY_MAP,
  findBobRouteEntriesForText,
  getBobRouteEntityMapSummary,
} from '@/lib/bobRouteEntityMap'

describe('bobRouteEntityMap getBobRouteEntityMapSummary', () => {
  it('returns a non-empty formatted string', () => {
    const summary = getBobRouteEntityMapSummary()
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain('->')
    expect(summary).toContain('entities:')
    expect(summary).toContain('use:')
  })

  it('respects the limit parameter', () => {
    const twoLines = getBobRouteEntityMapSummary(2)
    expect(twoLines.split('\n')).toHaveLength(2)

    const oneLine = getBobRouteEntityMapSummary(1)
    expect(oneLine.split('\n')).toHaveLength(1)
  })

  it('defaults to 8 entries', () => {
    const summary = getBobRouteEntityMapSummary()
    const lines = summary.split('\n')
    expect(lines).toHaveLength(Math.min(8, BOB_ROUTE_ENTITY_MAP.length))
  })
})

describe('bobRouteEntityMap findBobRouteEntriesForText', () => {
  it('finds entries by route path substring', () => {
    const results = findBobRouteEntriesForText('navigate to /compliance')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/compliance')
  })

  it('finds entries by label alias', () => {
    const results = findBobRouteEntriesForText('open the crm module')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/crm')
  })

  it('includes the current route entry regardless of text', () => {
    const results = findBobRouteEntriesForText('unrelated text here', '/settings')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/settings')
  })

  it('returns empty array when no text or route matches', () => {
    const results = findBobRouteEntriesForText('zzz-no-match-xyz-gibberish')
    expect(results).toHaveLength(0)
  })

  it('finds grandmaster studio by alias', () => {
    const results = findBobRouteEntriesForText('go to grandmaster diagnostics')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/grandmaster-studio')
  })

  it('finds reports by alias', () => {
    const results = findBobRouteEntriesForText('view the dashboard report')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/reports')
  })

  it('finds data management by alias', () => {
    const results = findBobRouteEntriesForText('import data file for cleanup')
    const paths = results.map((r) => r.path)
    expect(paths).toContain('/data-management')
  })

  it('returns deterministic entries with primaryEntities and recommendedMutations', () => {
    const [entry] = findBobRouteEntriesForText('check compliance report')
    expect(entry).toBeDefined()
    expect(Array.isArray(entry.primaryEntities)).toBe(true)
    expect(Array.isArray(entry.recommendedMutations)).toBe(true)
  })
})
