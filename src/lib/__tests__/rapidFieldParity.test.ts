import { describe, expect, it } from 'vitest'
import { getDispatchParityChecks, summarizeDispatchParity } from '../rapidFieldParity'

describe('getDispatchParityChecks', () => {
  it('requires lifecycle timestamps only after the job reaches each stage', () => {
    const checks = getDispatchParityChecks({
      status: 'en_route',
      title: 'Alarm response',
      priority: 'urgent',
      address: '1 Wharf Road',
      assigned_to: 'officer-1',
      dispatched_at: '2026-05-11T10:00:00Z',
      acknowledged_at: '2026-05-11T10:02:00Z',
    })

    expect(checks.find((check) => check.key === 'en_route_at')).toMatchObject({
      required: true,
      mapped: false,
    })
    expect(checks.find((check) => check.key === 'on_scene_at')).toMatchObject({
      required: false,
      mapped: false,
    })
  })
})

describe('summarizeDispatchParity', () => {
  it('summarises required-field coverage and missing field hot spots', () => {
    const summary = summarizeDispatchParity([
      {
        status: 'dispatched',
        title: 'Noise complaint',
        priority: 'high',
        address: '2 Harbour Street',
        assigned_to: 'officer-2',
        dispatched_at: '2026-05-11T10:00:00Z',
      },
      {
        status: 'on_scene',
        title: 'Alarm response',
        priority: 'urgent',
        zone_id: 'zone-1',
        assigned_to: 'officer-5',
        dispatched_at: '2026-05-11T11:00:00Z',
        acknowledged_at: '2026-05-11T11:02:00Z',
        en_route_at: '2026-05-11T11:04:00Z',
      },
    ])

    expect(summary.coveragePercent).toBe(93)
    expect(summary.readyJobs).toBe(1)
    expect(summary.totalJobs).toBe(2)
    expect(summary.missingByKey).toEqual([
      {
        key: 'on_scene_at',
        label: 'On scene timestamp',
        count: 1,
      },
    ])
  })
})
